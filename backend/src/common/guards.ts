import { ExecutionContext, Injectable, CanActivate, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ROLES_KEY, IS_PUBLIC_KEY } from './decorators';
import { Role } from './enums';
import { CAPABILITIES_KEY, Capability, ROLE_ALIASES, can } from './permissions';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      // Public routes still learn who is calling when a valid token is sent (e.g. reports prefill the email);
      // a missing or bad token simply leaves the request anonymous.
      return Promise.resolve(super.canActivate(context) as Promise<boolean>).catch(() => true).then(() => true);
    }
    return super.canActivate(context);
  }

  // On public routes an invalid token must not fail the request.
  handleRequest<TUser>(err: unknown, user: TUser, info: unknown, context: ExecutionContext): TUser {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return (user || undefined) as TUser;
    return super.handleRequest(err, user, info, context);
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('Not authenticated');
    // Super admin can do everything
    if (user.role === Role.SUPER_ADMIN) return true;
    const roles = [user.role, ...(ROLE_ALIASES[user.role as Role] ?? [])];
    if (!required.some((role) => roles.includes(role))) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}

/** Enforces `@RequireCapability(...)`: every listed capability must belong to the caller's role. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Capability[]>(CAPABILITIES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('Not authenticated');
    const missing = required.filter((capability) => !can(user, capability));
    if (missing.length) throw new ForbiddenException('Insufficient permissions');
    return true;
  }
}

/**
 * "View as business" tokens are read-only: an admin sees exactly what the owner sees and cannot change
 * anything while impersonating.
 */
@Injectable()
export class ImpersonationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest();
    if (!request.user?.impersonatedBy) return true;
    const method = String(request.method).toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
    // Analytics beacons from the pages being viewed are harmless and expected.
    if (/\/api\/events(\/batch)?$/.test(request.path ?? '')) return true;
    throw new ForbiddenException('You are viewing as this business; changes are disabled');
  }
}
