import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { User, UserDocument, UserStatus } from '../schemas/user.schema';
import { LoginEvent, LoginEventDocument } from '../schemas/login-event.schema';
import { Role } from '../common/enums';
import { capabilitiesOf, isStaff } from '../common/permissions';
import { decryptSecret, encryptSecret, randomToken, sha256 } from '../platform/crypto';
import { EmailService, siteUrl } from '../platform/email.service';
import { SettingsService } from '../platform/settings.service';
import { LoginDto, RegisterDto } from './auth.dto';
import { OAuthProfile } from './oauth.service';
import { JwtStrategy, staffTwoFactorRequired, TokenPayload } from './jwt.strategy';
import { generateTotpSecret, otpauthUrl, verifyTotp } from './totp';

const SIGNUP_ROLES = [Role.CUSTOMER, Role.BUSINESS_OWNER, Role.SUPPLIER];
const EMAIL_TOKEN_HOURS = 48;
const RESET_TOKEN_MINUTES = 60;
const CHALLENGE_MINUTES = 10;
const IMPERSONATION_MINUTES = 30;

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

// What a login returns: a session, or the second-factor step staff must complete first.
export type LoginResult =
  | { accessToken: string; user: ReturnType<AuthService['publicUser']> }
  | { twoFactorRequired: true; challengeToken: string }
  | { twoFactorSetupRequired: true; challengeToken: string };

const notInProduction = () => process.env.NODE_ENV !== 'production';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(LoginEvent.name) private loginEvents: Model<LoginEventDocument>,
    private jwtService: JwtService,
    private email: EmailService,
    private settings: SettingsService,
    private strategy: JwtStrategy,
  ) {}

  async register(dto: RegisterDto, meta: RequestMeta = {}) {
    const email = dto.email.toLowerCase();
    const existing = await this.userModel.findOne({ email });
    if (existing) throw new ConflictException('An account with this email already exists');

    const role = dto.role && SIGNUP_ROLES.includes(dto.role) ? dto.role : Role.CUSTOMER;
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.userModel.create({
      name: dto.name,
      email,
      phone: dto.phone,
      postcode: dto.postcode,
      passwordHash,
      role,
      ...(dto.marketingEmails ? { marketingEmails: true, marketingConsentAt: new Date() } : {}),
    });
    const devVerifyUrl = await this.sendVerification(user);
    await this.recordLogin({ user, success: true, method: 'register', meta });
    return { ...this.session(user), ...(devVerifyUrl && notInProduction() ? { devVerifyUrl } : {}) };
  }

  async login(dto: LoginDto, meta: RequestMeta = {}): Promise<LoginResult> {
    const email = dto.email.toLowerCase();
    const user = await this.userModel.findOne({ email }).select('+passwordHash');
    if (!user || user.status === UserStatus.DELETED) {
      await this.recordLogin({ email, success: false, method: 'password', reason: 'unknown_email', meta });
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.passwordHash) {
      throw new UnauthorizedException(
        `This account uses ${user.provider} sign-in — use the "${user.provider}" button instead`,
      );
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      await this.recordLogin({ user, success: false, method: 'password', reason: 'bad_password', meta });
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.completeFirstFactor(user, 'password', meta);
  }

  /** Log in (or auto-register) a user verified by Google/Apple. */
  async oauthLogin(profile: OAuthProfile, requestedRole?: Role, meta: RequestMeta = {}): Promise<LoginResult> {
    let user = await this.userModel.findOne({
      $or: [{ provider: profile.provider, providerId: profile.providerId }, { email: profile.email }],
    });
    if (user) {
      // Link the social identity to an existing email account on first use
      if (!user.providerId) {
        user.provider = profile.provider;
        user.providerId = profile.providerId;
      }
      if (!user.emailVerifiedAt && profile.emailVerified) user.emailVerifiedAt = new Date();
      await user.save();
    } else {
      const role = requestedRole && SIGNUP_ROLES.includes(requestedRole) ? requestedRole : Role.CUSTOMER;
      user = await this.userModel.create({
        name: profile.name || profile.email.split('@')[0],
        email: profile.email,
        provider: profile.provider,
        providerId: profile.providerId,
        role,
        emailVerifiedAt: profile.emailVerified ? new Date() : undefined,
      });
    }
    return this.completeFirstFactor(user, profile.provider, meta);
  }

  private async completeFirstFactor(user: UserDocument, method: string, meta: RequestMeta): Promise<LoginResult> {
    if (user.status === UserStatus.BANNED) {
      await this.recordLogin({ user, success: false, method, reason: 'banned', meta });
      throw new ForbiddenException('This account has been suspended. Contact us if you think this is a mistake.');
    }
    if (user.status === UserStatus.DELETED) throw new UnauthorizedException('Invalid email or password');
    if (isStaff(user) && staffTwoFactorRequired()) {
      const enrolled = !!user.twoFactor?.enabled;
      const challengeToken = this.jwtService.sign(
        { sub: user.id, purpose: enrolled ? '2fa' : '2fa-setup', email: user.email, role: user.role, name: user.name },
        { expiresIn: `${CHALLENGE_MINUTES}m` },
      );
      return enrolled ? { twoFactorRequired: true, challengeToken } : { twoFactorSetupRequired: true, challengeToken };
    }
    await this.recordLogin({ user, success: true, method, meta });
    return this.session(user);
  }

  // ---- Staff two-factor sign-in ----

  private async challengeUser(challengeToken: string, purpose: '2fa' | '2fa-setup') {
    let payload: TokenPayload;
    try {
      payload = this.jwtService.verify<TokenPayload>(challengeToken);
    } catch {
      throw new UnauthorizedException('Your sign-in has timed out. Please log in again.');
    }
    if (payload.purpose !== purpose) throw new UnauthorizedException('Please log in again.');
    const user = await this.userModel.findById(payload.sub).select('+twoFactor.secretEnc +twoFactor.pendingSecretEnc +twoFactor.lastStep');
    if (!user || user.status !== UserStatus.ACTIVE) throw new UnauthorizedException('Please log in again.');
    return user;
  }

  async twoFactorSetup(challengeToken: string) {
    const user = await this.challengeUser(challengeToken, '2fa-setup');
    if (user.twoFactor?.enabled) throw new BadRequestException('Two-factor sign-in is already set up');
    const secret = generateTotpSecret();
    user.set('twoFactor.pendingSecretEnc', encryptSecret(secret));
    await user.save();
    const settings = await this.settings.get();
    const url = otpauthUrl(secret, user.email, settings.siteName || 'TruOffers');
    return { secret, otpauthUrl: url, qrCode: await QRCode.toDataURL(url, { width: 240, margin: 1 }) };
  }

  async twoFactorEnable(challengeToken: string, code: string, meta: RequestMeta = {}) {
    const user = await this.challengeUser(challengeToken, '2fa-setup');
    const secret = decryptSecret(user.twoFactor?.pendingSecretEnc);
    if (!secret) throw new BadRequestException('Start the set-up again');
    const step = verifyTotp(secret, code.trim());
    if (step === null) {
      await this.recordLogin({ user, success: false, method: '2fa', reason: 'bad_2fa_code', meta });
      throw new BadRequestException('That code is not right. Check the time on your phone and try again.');
    }
    user.set('twoFactor', { enabled: true, secretEnc: encryptSecret(secret), enrolledAt: new Date(), lastStep: step });
    await user.save();
    await this.recordLogin({ user, success: true, method: '2fa', meta });
    return this.session(user, { mfa: true });
  }

  async twoFactorVerify(challengeToken: string, code: string, meta: RequestMeta = {}) {
    const user = await this.challengeUser(challengeToken, '2fa');
    const secret = decryptSecret(user.twoFactor?.secretEnc);
    if (!user.twoFactor?.enabled || !secret) throw new BadRequestException('Two-factor sign-in is not set up');
    const step = verifyTotp(secret, code.trim(), Date.now(), user.twoFactor.lastStep ?? -1);
    if (step === null) {
      await this.recordLogin({ user, success: false, method: '2fa', reason: 'bad_2fa_code', meta });
      throw new UnauthorizedException('That code is not right');
    }
    user.set('twoFactor.lastStep', step);
    await user.save();
    await this.recordLogin({ user, success: true, method: '2fa', meta });
    return this.session(user, { mfa: true });
  }

  /** A super admin clears someone's authenticator; they enrol again at their next login. */
  async resetTwoFactor(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    user.set('twoFactor', { enabled: false });
    user.sessionsValidAfter = new Date();
    await user.save();
    this.strategy.forget(userId);
  }

  // ---- Email verification ----

  /** Sends the verification email; returns the link outside production so the flow can be tested. */
  async sendVerification(user: UserDocument): Promise<string | undefined> {
    if (user.emailVerifiedAt) return undefined;
    const token = randomToken();
    user.set({ emailVerifyTokenHash: sha256(token), emailVerifyExpires: new Date(Date.now() + EMAIL_TOKEN_HOURS * 3600_000) });
    await user.save();
    const link = siteUrl(`/verify-email?token=${token}`);
    await this.email.send({ to: user.email, template: 'email_verification', vars: { name: user.name.split(' ')[0], link } });
    return link;
  }

  async resendVerification(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (user.emailVerifiedAt) return { alreadyVerified: true };
    const link = await this.sendVerification(user);
    return { sent: true, ...(link && notInProduction() ? { devVerifyUrl: link } : {}) };
  }

  async verifyEmail(token: string) {
    const user = await this.userModel
      .findOne({ emailVerifyTokenHash: sha256(token), emailVerifyExpires: { $gt: new Date() } })
      .select('+emailVerifyTokenHash');
    if (!user) throw new BadRequestException('This link has expired or was already used. Request a new one from your account.');
    user.set({ emailVerifiedAt: new Date(), emailVerifyTokenHash: undefined, emailVerifyExpires: undefined });
    await user.save();
    return { verified: true, email: user.email };
  }

  // ---- Password reset ----

  /** Always answers the same way, so it can't be used to find out who has an account. */
  async forgotPassword(email: string) {
    const user = await this.userModel.findOne({ email: email.toLowerCase(), status: UserStatus.ACTIVE });
    let devResetUrl: string | undefined;
    if (user) devResetUrl = await this.createResetLink(user, true);
    return { sent: true, ...(devResetUrl && notInProduction() ? { devResetUrl } : {}) };
  }

  /** A reset link (emailed unless `send` is false, e.g. when an admin copies it for the user). */
  async createResetLink(user: UserDocument, send: boolean): Promise<string> {
    const token = randomToken();
    user.set({ passwordResetTokenHash: sha256(token), passwordResetExpires: new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000) });
    await user.save();
    const link = siteUrl(`/reset-password?token=${token}`);
    if (send) await this.email.send({ to: user.email, template: 'password_reset', vars: { name: user.name.split(' ')[0], link } });
    return link;
  }

  async resetPassword(token: string, password: string, meta: RequestMeta = {}) {
    const user = await this.userModel
      .findOne({ passwordResetTokenHash: sha256(token), passwordResetExpires: { $gt: new Date() } })
      .select('+passwordResetTokenHash');
    if (!user) throw new BadRequestException('This link has expired or was already used. Ask for a new one.');
    if (user.status !== UserStatus.ACTIVE) throw new ForbiddenException('This account is not active');
    user.set({
      passwordHash: await bcrypt.hash(password, 10),
      passwordResetTokenHash: undefined,
      passwordResetExpires: undefined,
      // Following the link proves the user can read the mailbox
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      // Every other session ends
      sessionsValidAfter: new Date(),
    });
    await user.save();
    this.strategy.forget(user.id);
    return this.completeFirstFactor(user, 'password_reset', meta);
  }

  // ---- Sessions ----

  async me(userId: string, impersonatedBy?: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    return { ...this.publicUser(user), ...(impersonatedBy ? { impersonatedBy } : {}) };
  }

  /** Spec: "impersonate (view as business, logged)". A short, read-only session as the business's owner. */
  async impersonationToken(adminId: string, targetUserId: string) {
    const target = await this.userModel.findById(targetUserId);
    if (!target || target.status !== UserStatus.ACTIVE) throw new NotFoundException('That owner account is not active');
    if (isStaff(target)) throw new ForbiddenException('Staff accounts cannot be viewed as');
    const accessToken = this.jwtService.sign(
      { sub: target.id, email: target.email, role: target.role, name: target.name, imp: adminId },
      { expiresIn: `${IMPERSONATION_MINUTES}m` },
    );
    return { accessToken, user: { ...this.publicUser(target), impersonatedBy: adminId }, expiresInMinutes: IMPERSONATION_MINUTES };
  }

  session(user: UserDocument, extra: { mfa?: boolean } = {}) {
    const payload: TokenPayload = { sub: user.id, email: user.email, role: user.role, name: user.name, ...extra };
    void this.userModel.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } }).exec();
    return { accessToken: this.jwtService.sign(payload), user: this.publicUser(user) };
  }

  publicUser(user: UserDocument) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      postcode: user.postcode,
      emailVerified: !!user.emailVerifiedAt,
      twoFactorEnabled: !!user.twoFactor?.enabled,
      capabilities: capabilitiesOf(user.role),
      favouriteCuisines: user.favouriteCuisines,
      savedOffers: user.savedOffers,
      followedBusinesses: user.followedBusinesses,
      offerAlerts: user.offerAlerts,
      marketingEmails: !!user.marketingEmails,
      marketingSms: !!user.marketingSms,
    };
  }

  async recordLogin(input: { user?: UserDocument; email?: string; success: boolean; method: string; reason?: string; meta: RequestMeta }) {
    await this.loginEvents
      .create({
        userId: input.user?._id,
        email: input.user?.email ?? input.email,
        success: input.success,
        method: input.method,
        reason: input.reason,
        ip: input.meta.ip,
        userAgent: input.meta.userAgent?.slice(0, 300),
      })
      .catch(() => undefined);
  }

  loginHistory(userId: string, limit = 50) {
    return this.loginEvents
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }
}
