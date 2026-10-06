import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { PassportStrategy } from '@nestjs/passport';
import { Model, Types } from 'mongoose';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser } from '../common/decorators';
import { Role } from '../common/enums';
import { isStaff } from '../common/permissions';
import { User, UserDocument, UserStatus } from '../schemas/user.schema';

export interface TokenPayload {
  sub: string;
  email: string;
  role: Role;
  name: string;
  // Staff tokens carry this once the second factor was checked
  mfa?: boolean;
  // "View as business": the admin who asked for the token
  imp?: string;
  // 2FA challenge tokens can't be used as sessions
  purpose?: string;
  iat?: number;
}

// Staff must sign in with a second factor unless it is switched off for local development and tests. The switch
// is ignored in production, so a stray environment variable can't turn off the spec's "2FA required for admins".
export function staffTwoFactorRequired(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.ADMIN_2FA_DISABLED !== 'true';
}

const CACHE_MS = 15_000;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  // Bans, deletions and role changes take effect within seconds without a database read on every request.
  private readonly cache = new Map<string, { at: number; user: Pick<User, 'role' | 'status' | 'name' | 'email' | 'sessionsValidAfter'> | null }>();

  constructor(
    config: ConfigService,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') || 'dev-secret',
    });
  }

  private async lookup(id: string) {
    const hit = this.cache.get(id);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.user;
    const user = Types.ObjectId.isValid(id) ? await this.users.findById(id).select('role status name email sessionsValidAfter').lean() : null;
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(id, { at: Date.now(), user });
    return user;
  }

  forget(id: string) {
    this.cache.delete(id);
  }

  async validate(payload: TokenPayload): Promise<AuthUser> {
    if (payload.purpose) throw new UnauthorizedException('This token cannot be used to sign in');
    const user = await this.lookup(payload.sub);
    if (!user || user.status !== UserStatus.ACTIVE) throw new UnauthorizedException('Your session has ended. Please log in again.');
    // Token times are whole seconds, so one issued in the same second as the cut-off (the fresh session handed
    // out with a password reset) stays valid.
    if (user.sessionsValidAfter && (payload.iat ?? 0) * 1000 < Math.floor(user.sessionsValidAfter.getTime() / 1000) * 1000) {
      throw new UnauthorizedException('Your session has ended. Please log in again.');
    }
    // The role comes from the database, so a demoted admin loses access straight away.
    const role = user.role;
    if (!payload.imp && isStaff({ role }) && staffTwoFactorRequired() && !payload.mfa) {
      throw new UnauthorizedException('Two-factor sign-in is required. Please log in again.');
    }
    return {
      userId: payload.sub,
      email: user.email,
      role,
      name: user.name,
      ...(payload.imp ? { impersonatedBy: payload.imp } : {}),
    };
  }
}
