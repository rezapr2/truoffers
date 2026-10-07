import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { Model, Types } from 'mongoose';
import { AuthUser } from '../common/decorators';
import { BusinessMemberRole, Role, STAFF_ROLES, VerificationLevel } from '../common/enums';
import { Capability, can, isStaff } from '../common/permissions';
import { escapeRegex } from '../businesses/businesses.service';
import { AuthService } from '../auth/auth.service';
import { JwtStrategy } from '../auth/jwt.strategy';
import { randomToken } from '../platform/crypto';
import { EmailService } from '../platform/email.service';
import { AuditService } from '../scraper/audit/audit.service';
import { Business, BusinessDocument } from '../schemas/business.schema';
import { Claim, ClaimDocument } from '../schemas/claim.schema';
import { Report, ReportDocument } from '../schemas/report.schema';
import { User, UserDocument, UserStatus } from '../schemas/user.schema';

const PAGE_SIZE = 30;
const CUSTOMER_ROLES = [Role.CUSTOMER, Role.BUSINESS_OWNER, Role.BUSINESS_STAFF, Role.SUPPLIER];

/** Spec T6.2 "Users" and the admin team (/admin/team). */
@Injectable()
export class AdminUsersService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Claim.name) private readonly claims: Model<ClaimDocument>,
    @InjectModel(Report.name) private readonly reports: Model<ReportDocument>,
    private readonly auth: AuthService,
    private readonly strategy: JwtStrategy,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  async list(query: { q?: string; role?: string; status?: string; page?: string }, limit = PAGE_SIZE) {
    const filter: Record<string, unknown> = {};
    if (query.q) {
      const regex = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ name: regex }, { email: regex }, { phone: regex }];
    }
    if (query.role) filter.role = { $in: query.role.split(',') };
    filter.status = query.status ? query.status : { $ne: UserStatus.DELETED };
    const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
    const [items, total] = await Promise.all([
      this.users
        .find(filter)
        .select('name email phone role status emailVerifiedAt lastLoginAt createdAt provider twoFactor.enabled bannedAt')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.users.countDocuments(filter),
    ]);
    const memberships = await this.businesses.aggregate([
      { $match: { 'members.userId': { $in: items.map((u) => u._id) } } },
      { $unwind: '$members' },
      { $match: { 'members.userId': { $in: items.map((u) => u._id) } } },
      { $group: { _id: '$members.userId', count: { $sum: 1 } } },
    ]);
    const counts = new Map(memberships.map((m) => [String(m._id), m.count]));
    return { items: items.map((u) => ({ ...u, businessCount: counts.get(String(u._id)) ?? 0 })), total, page, pages: Math.ceil(total / limit) };
  }

  async detail(id: string) {
    const user = Types.ObjectId.isValid(id)
      ? await this.users.findById(id).select('-savedOffers').lean()
      : null;
    if (!user) throw new NotFoundException('User not found');
    const [businesses, claims, logins, reports] = await Promise.all([
      this.businesses.find({ 'members.userId': user._id }).select('name slug town verificationLevel status members').lean(),
      this.claims.find({ userId: user._id }).sort({ createdAt: -1 }).limit(20).populate('businessId', 'name slug').select('status kind businessId createdAt decidedAt').lean(),
      this.auth.loginHistory(id, 50),
      this.reports.countDocuments({ reporterId: user._id }),
    ]);
    return {
      user: { ...user, twoFactorEnabled: !!user.twoFactor?.enabled, twoFactor: undefined },
      businesses: businesses.map((b) => ({ _id: b._id, name: b.name, slug: b.slug, town: b.town, verificationLevel: b.verificationLevel, status: b.status, role: b.members.find((m) => String(m.userId) === id)?.role })),
      claims,
      logins,
      reportsFiled: reports,
    };
  }

  private async load(id: string) {
    const user = Types.ObjectId.isValid(id) ? await this.users.findById(id) : null;
    if (!user || user.status === UserStatus.DELETED) throw new NotFoundException('User not found');
    return user;
  }

  /** Staff accounts are managed from the admin team page by super admins only. */
  private assertCanManage(target: UserDocument, admin: AuthUser) {
    if (target.id === admin.userId) throw new BadRequestException('Use your own account settings for this');
    if (isStaff(target) && !can(admin, Capability.TEAM_MANAGE)) throw new ForbiddenException('Only a super admin can change staff accounts');
  }

  async update(id: string, dto: { name?: string; email?: string; phone?: string; role?: Role; offerAlerts?: boolean }, admin: AuthUser) {
    const user = await this.load(id);
    this.assertCanManage(user, admin);
    if (dto.role && !CUSTOMER_ROLES.includes(dto.role)) throw new BadRequestException('Staff roles are set on the admin team page');
    if (dto.email && dto.email.toLowerCase() !== user.email) {
      if (await this.users.exists({ email: dto.email.toLowerCase() })) throw new ConflictException('Another account uses that email');
    }
    const before = { name: user.name, email: user.email, phone: user.phone, role: user.role };
    if (dto.name) user.name = dto.name;
    if (dto.email && dto.email.toLowerCase() !== user.email) {
      user.email = dto.email.toLowerCase();
      // A changed address has to be confirmed again.
      user.emailVerifiedAt = undefined;
    }
    if (dto.phone !== undefined) user.phone = dto.phone || undefined;
    if (dto.role) user.role = dto.role;
    if (dto.offerAlerts !== undefined) user.offerAlerts = dto.offerAlerts;
    await user.save();
    this.strategy.forget(user.id);
    await this.audit.record({ action: 'user.updated', targetType: 'User', targetId: user._id, before, after: { name: user.name, email: user.email, phone: user.phone, role: user.role } });
    return user;
  }

  async resetPasswordLink(id: string, admin: AuthUser, send = true) {
    const user = await this.load(id);
    this.assertCanManage(user, admin);
    const link = await this.auth.createResetLink(user, send);
    await this.audit.record({ action: 'user.password_reset_link', targetType: 'User', targetId: user._id, after: { emailed: send } });
    return { link, emailed: send };
  }

  async verifyEmail(id: string) {
    const user = await this.load(id);
    if (user.emailVerifiedAt) return user;
    user.emailVerifiedAt = new Date();
    await user.save();
    await this.audit.record({ action: 'user.email_verified_by_admin', targetType: 'User', targetId: user._id });
    return user;
  }

  async ban(id: string, reason: string, admin: AuthUser) {
    const user = await this.load(id);
    this.assertCanManage(user, admin);
    user.set({ status: UserStatus.BANNED, bannedAt: new Date(), banReason: reason, sessionsValidAfter: new Date() });
    await user.save();
    this.strategy.forget(user.id);
    await this.audit.record({ action: 'user.banned', targetType: 'User', targetId: user._id, after: { reason } });
    return user;
  }

  async unban(id: string, admin: AuthUser) {
    const user = await this.load(id);
    this.assertCanManage(user, admin);
    if (user.status !== UserStatus.BANNED) throw new BadRequestException('This account is not banned');
    user.set({ status: UserStatus.ACTIVE, bannedAt: undefined, banReason: undefined });
    await user.save();
    this.strategy.forget(user.id);
    await this.audit.record({ action: 'user.unbanned', targetType: 'User', targetId: user._id });
    return user;
  }

  /**
   * GDPR erasure. The account is anonymised rather than removed, so audit trails stay intact: no name, email,
   * phone or password remains; follows and saved offers go; the person leaves every business team. A business
   * left without an owner goes back to unclaimed.
   */
  async erase(id: string, admin: AuthUser) {
    const user = await this.load(id);
    this.assertCanManage(user, admin);
    return this.eraseAccount(user, 'user.erased');
  }

  /** "Delete my account" from the account page. Staff accounts are removed by a super admin instead. */
  async eraseSelf(id: string) {
    const user = await this.load(id);
    if (isStaff(user)) throw new BadRequestException('Ask a super admin to remove a staff account');
    return this.eraseAccount(user, 'user.erased_self');
  }

  private async eraseAccount(user: UserDocument, action: string) {
    const id = user.id as string;
    const businesses = await this.businesses.find({ 'members.userId': user._id });
    for (const business of businesses) {
      business.members = business.members.filter((m) => String(m.userId) !== id);
      if (String(business.ownerId) === id) business.ownerId = business.members.find((m) => m.role === BusinessMemberRole.OWNER)?.userId;
      if (!business.members.some((m) => m.role === BusinessMemberRole.OWNER) && business.verificationLevel < VerificationLevel.VERIFIED) {
        business.verificationLevel = VerificationLevel.UNCLAIMED;
      }
      await business.save();
    }
    await this.reports.updateMany({ reporterId: user._id }, { $unset: { reporterEmail: 1, reporterId: 1 } });
    const followed = user.followedBusinesses.filter((b) => Types.ObjectId.isValid(b));
    if (followed.length) await this.businesses.updateMany({ _id: { $in: followed } }, { $inc: { followerCount: -1 } });
    user.set({
      name: 'Deleted user',
      email: `deleted-${user.id}@deleted.invalid`,
      phone: undefined,
      postcode: undefined,
      passwordHash: await bcrypt.hash(randomToken(), 10),
      provider: 'local',
      providerId: undefined,
      status: UserStatus.DELETED,
      deletedAt: new Date(),
      savedOffers: [],
      followedBusinesses: [],
      favouriteCuisines: [],
      twoFactor: { enabled: false },
      role: Role.CUSTOMER,
      sessionsValidAfter: new Date(),
      marketingEmails: false,
      marketingSms: false,
    });
    await user.save();
    this.strategy.forget(user.id);
    await this.audit.record({ action, targetType: 'User', targetId: user._id, after: { businessesLeft: businesses.length } });
    return { erased: true };
  }

  // ---- Admin team ----

  team() {
    return this.users
      .find({ role: { $in: STAFF_ROLES }, status: { $ne: UserStatus.DELETED } })
      .select('name email role status lastLoginAt twoFactor.enabled twoFactor.enrolledAt createdAt')
      .sort({ role: 1, name: 1 })
      .lean();
  }

  /** Adds a moderator or admin. An existing account is promoted; a new one gets a set-password link. */
  async addStaff(input: { email: string; name?: string; role: Role }) {
    if (![Role.MODERATOR, Role.ADMIN, Role.SUPER_ADMIN].includes(input.role)) throw new BadRequestException('Choose moderator, admin or super admin');
    const email = input.email.toLowerCase().trim();
    let user = await this.users.findOne({ email });
    let link: string | undefined;
    if (user) {
      if (user.status !== UserStatus.ACTIVE) throw new BadRequestException('That account is not active');
      const before = user.role;
      user.role = input.role;
      await user.save();
      this.strategy.forget(user.id);
      await this.audit.record({ action: 'team.staff_role_set', targetType: 'User', targetId: user._id, before: { role: before }, after: { role: input.role } });
    } else {
      user = await this.users.create({
        name: input.name?.trim() || email.split('@')[0],
        email,
        role: input.role,
        passwordHash: await bcrypt.hash(randomToken(), 10),
        emailVerifiedAt: new Date(),
      });
      link = await this.auth.createResetLink(user, false);
      await this.email.send({ to: email, template: 'staff_invite', vars: { name: user.name, role: input.role.replace('_', ' '), link } });
      await this.audit.record({ action: 'team.staff_added', targetType: 'User', targetId: user._id, after: { email, role: input.role } });
    }
    return { user: { _id: user._id, name: user.name, email: user.email, role: user.role }, ...(link && process.env.NODE_ENV !== 'production' ? { devSetPasswordUrl: link } : {}) };
  }

  async setStaffRole(id: string, role: Role, admin: AuthUser) {
    const user = await this.load(id);
    if (user.id === admin.userId) throw new BadRequestException('You cannot change your own role');
    if (!isStaff(user)) throw new BadRequestException('That account is not on the admin team');
    if (![Role.MODERATOR, Role.ADMIN, Role.SUPER_ADMIN].includes(role)) throw new BadRequestException('Choose moderator, admin or super admin');
    await this.assertNotLastSuperAdmin(user, role);
    const before = user.role;
    user.role = role;
    await user.save();
    this.strategy.forget(user.id);
    await this.audit.record({ action: 'team.staff_role_set', targetType: 'User', targetId: user._id, before: { role: before }, after: { role } });
    return user;
  }

  async removeStaff(id: string, admin: AuthUser) {
    const user = await this.load(id);
    if (user.id === admin.userId) throw new BadRequestException('You cannot remove yourself');
    if (!isStaff(user)) throw new BadRequestException('That account is not on the admin team');
    await this.assertNotLastSuperAdmin(user, Role.CUSTOMER);
    const before = user.role;
    user.set({ role: Role.CUSTOMER, twoFactor: { enabled: false }, sessionsValidAfter: new Date() });
    await user.save();
    this.strategy.forget(user.id);
    await this.audit.record({ action: 'team.staff_removed', targetType: 'User', targetId: user._id, before: { role: before }, after: { role: Role.CUSTOMER } });
    return { removed: true };
  }

  async resetTwoFactor(id: string, admin: AuthUser) {
    const user = await this.load(id);
    if (user.id === admin.userId) throw new BadRequestException('Ask another super admin to reset your two-factor sign-in');
    await this.auth.resetTwoFactor(id);
    await this.audit.record({ action: 'team.two_factor_reset', targetType: 'User', targetId: user._id });
    return { reset: true };
  }

  private async assertNotLastSuperAdmin(user: UserDocument, nextRole: Role) {
    if (user.role !== Role.SUPER_ADMIN || nextRole === Role.SUPER_ADMIN) return;
    const others = await this.users.countDocuments({ _id: { $ne: user._id }, role: Role.SUPER_ADMIN, status: UserStatus.ACTIVE });
    if (others === 0) throw new BadRequestException('There must always be at least one super admin');
  }
}
