import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from '../schemas/user.schema';
import { Role } from '../common/enums';
import { LoginDto, RegisterDto } from './auth.dto';
import { OAuthProfile } from './oauth.service';

const SIGNUP_ROLES = [Role.CUSTOMER, Role.BUSINESS_OWNER, Role.SUPPLIER];

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.userModel.findOne({ email: dto.email.toLowerCase() });
    if (existing) throw new ConflictException('An account with this email already exists');

    const role = dto.role && SIGNUP_ROLES.includes(dto.role) ? dto.role : Role.CUSTOMER;
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.userModel.create({
      name: dto.name,
      email: dto.email.toLowerCase(),
      phone: dto.phone,
      postcode: dto.postcode,
      passwordHash,
      role,
    });
    return this.buildAuthResponse(user);
  }

  async login(dto: LoginDto) {
    const user = await this.userModel
      .findOne({ email: dto.email.toLowerCase() })
      .select('+passwordHash');
    if (!user) throw new UnauthorizedException('Invalid email or password');
    if (!user.passwordHash) {
      throw new UnauthorizedException(
        `This account uses ${user.provider} sign-in — use the "${user.provider}" button instead`,
      );
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid email or password');
    return this.buildAuthResponse(user);
  }

  /** Log in (or auto-register) a user verified by Google/Apple. */
  async oauthLogin(profile: OAuthProfile, requestedRole?: Role) {
    const linked = await this.userModel.findOne({ provider: profile.provider, providerId: profile.providerId });
    if (linked) return this.buildAuthResponse(linked);

    // Everything below trusts the email address, so the provider must have confirmed this person owns it:
    // otherwise anyone could sign in to an account by putting its address on an unverified social profile.
    if (!profile.emailVerified) {
      throw new UnauthorizedException(
        `Your ${profile.provider} account's email address is not verified. Verify it with ${profile.provider} first.`,
      );
    }

    let user = await this.userModel.findOne({ email: profile.email }).select('+passwordHash');
    if (user) {
      // Link the social identity to an existing email account on first use
      if (!user.providerId) {
        user.provider = profile.provider;
        user.providerId = profile.providerId;
        // Nobody ever proved they own the address a password account was registered with, and this person
        // just did: a password someone else set up with their address (to wait for them to join) stops working.
        user.passwordHash = undefined;
        await user.save();
      }
    } else {
      const role = requestedRole && SIGNUP_ROLES.includes(requestedRole) ? requestedRole : Role.CUSTOMER;
      user = await this.userModel.create({
        name: profile.name || profile.email.split('@')[0],
        email: profile.email,
        provider: profile.provider,
        providerId: profile.providerId,
        role,
      });
    }
    return this.buildAuthResponse(user);
  }

  async me(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    return this.publicUser(user);
  }

  private buildAuthResponse(user: UserDocument) {
    const payload = { sub: user.id, email: user.email, role: user.role, name: user.name };
    return {
      accessToken: this.jwtService.sign(payload),
      user: this.publicUser(user),
    };
  }

  private publicUser(user: UserDocument) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      postcode: user.postcode,
      favouriteCuisines: user.favouriteCuisines,
      savedOffers: user.savedOffers,
      followedBusinesses: user.followedBusinesses,
    };
  }
}
