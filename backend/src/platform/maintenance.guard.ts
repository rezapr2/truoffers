import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { isStaff } from '../common/permissions';
import { SettingsService } from './settings.service';

// Paths that keep working in maintenance mode, so staff can sign in and switch it off again.
const ALWAYS_OPEN = [/^\/api\/health/, /^\/api\/site$/, /^\/api\/auth\//, /^\/api\/billing\/webhook$/];

/** Maintenance mode (admin settings): the API answers 503 to everyone but staff. */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(private readonly settings: SettingsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest();
    if (ALWAYS_OPEN.some((pattern) => pattern.test(request.path ?? ''))) return true;
    const settings = await this.settings.get();
    if (!settings.maintenanceMode || isStaff(request.user)) return true;
    throw new ServiceUnavailableException(settings.maintenanceMessage || 'Down for maintenance');
  }
}
