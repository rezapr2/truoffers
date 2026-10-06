import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BusinessAccessService } from '../common/business-access';
import { AdminAuditLog, AdminAuditLogSchema } from '../schemas/admin-audit-log.schema';
import { Business, BusinessSchema } from '../schemas/business.schema';
import { EmailLog, EmailLogSchema, EmailTemplate, EmailTemplateSchema } from '../schemas/email.schema';
import { LoginEvent, LoginEventSchema } from '../schemas/login-event.schema';
import { Notification, NotificationSchema } from '../schemas/notification.schema';
import { SiteSettings, SiteSettingsSchema } from '../schemas/site-settings.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { AuditService } from '../scraper/audit/audit.service';
import { EmailService } from './email.service';
import { NotificationsService } from './notifications.service';
import { PhoneVerificationService } from './phone-verification.service';
import {
  AdminAuditController,
  AdminEmailTemplatesController,
  AdminSettingsController,
  FilesController,
  NotificationsController,
  SiteController,
  UploadsController,
} from './platform.controllers';
import { RecaptchaService } from './recaptcha.service';
import { SettingsService } from './settings.service';
import { StorageService } from './storage.service';

export const PLATFORM_MODELS = MongooseModule.forFeature([
  { name: SiteSettings.name, schema: SiteSettingsSchema },
  { name: EmailTemplate.name, schema: EmailTemplateSchema },
  { name: EmailLog.name, schema: EmailLogSchema },
  { name: Notification.name, schema: NotificationSchema },
  { name: User.name, schema: UserSchema },
  { name: Business.name, schema: BusinessSchema },
  { name: AdminAuditLog.name, schema: AdminAuditLogSchema },
  { name: LoginEvent.name, schema: LoginEventSchema },
]);

const SERVICES = [
  SettingsService,
  EmailService,
  NotificationsService,
  PhoneVerificationService,
  RecaptchaService,
  StorageService,
  AuditService,
  BusinessAccessService,
];

/** Settings, email, notifications, phone checks, file storage, audit log and business access, for every module. */
@Global()
@Module({
  imports: [PLATFORM_MODELS],
  controllers: [
    FilesController,
    UploadsController,
    SiteController,
    NotificationsController,
    AdminSettingsController,
    AdminEmailTemplatesController,
    AdminAuditController,
  ],
  providers: SERVICES,
  exports: [PLATFORM_MODELS, ...SERVICES],
})
export class PlatformModule {}
