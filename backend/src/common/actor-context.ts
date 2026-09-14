import { AsyncLocalStorage } from 'node:async_hooks';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  NestMiddleware,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ADMIN_ROLES, Role } from './enums';
import { ActorKind } from './scraper.enums';

export type Actor =
  | { kind: ActorKind.ADMIN; userId: string; role: Role }
  | { kind: ActorKind.MERCHANT; userId: string; role: Role }
  | { kind: ActorKind.PUBLIC; userId?: string; role?: Role }
  | { kind: ActorKind.SYSTEM; component: string };

interface ActorStore {
  actor?: Actor;
  ip?: string;
}

const storage = new AsyncLocalStorage<ActorStore>();

const MERCHANT_ROLES = [Role.BUSINESS_OWNER, Role.BUSINESS_STAFF];

export function actorFromUser(user?: { userId: string; role: Role }): Actor {
  if (!user) return { kind: ActorKind.PUBLIC };
  if (ADMIN_ROLES.includes(user.role)) return { kind: ActorKind.ADMIN, userId: user.userId, role: user.role };
  if (MERCHANT_ROLES.includes(user.role)) {
    return { kind: ActorKind.MERCHANT, userId: user.userId, role: user.role };
  }
  return { kind: ActorKind.PUBLIC, userId: user.userId, role: user.role };
}

export const ActorContext = {
  // Anything outside an HTTP request (worker, crons, scripts) runs as the system.
  current(): Actor {
    return storage.getStore()?.actor ?? { kind: ActorKind.SYSTEM, component: 'background' };
  },

  ip(): string | undefined {
    return storage.getStore()?.ip;
  },

  run<T>(actor: Actor, fn: () => T): T {
    return storage.run({ actor }, fn);
  },

  isHuman(actor: Actor = ActorContext.current()): actor is Extract<Actor, { userId: string; role: Role }> {
    return actor.kind === ActorKind.ADMIN || actor.kind === ActorKind.MERCHANT;
  },
};

@Injectable()
export class ActorContextMiddleware implements NestMiddleware {
  use(req: { ip?: string }, _res: unknown, next: () => void) {
    storage.run({ ip: req.ip }, next);
  }
}

// Runs after the global auth guards, so request.user is populated by now.
@Injectable()
export class ActorContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const store = storage.getStore();
    if (store && context.getType() === 'http') {
      store.actor = actorFromUser(context.switchToHttp().getRequest().user);
    }
    return next.handle();
  }
}
