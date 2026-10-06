import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { Response } from 'express';
import { AuditService } from '../scraper/audit/audit.service';
import { CurrentUser, Public } from '../common/decorators';
import { csvResponse, toCsv } from '../common/csv';
import { Capability, RequireCapability } from '../common/permissions';
import { EmailService } from './email.service';
import { NotificationsService } from './notifications.service';
import { SECRET_ENV, SecretName, SettingsService } from './settings.service';
import { IMAGE_KINDS, StorageService } from './storage.service';

const MB = 1024 * 1024;

type UploadedBlob = { buffer: Buffer; size: number; originalname: string };

@Controller('files')
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  @Public()
  @Get('public/:year/:month/:name')
  async serve(@Param('year') year: string, @Param('month') month: string, @Param('name') name: string, @Res() res: Response) {
    const { buffer, mime } = await this.storage.read(`public/${year}/${month}/${name}`);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Uploaded files are never rendered as documents on our origin.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(buffer);
  }
}

@Controller('uploads')
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class UploadsController {
  constructor(private readonly storage: StorageService) {}

  // Logos, cover photos, gallery photos and offer images. Public once uploaded.
  @Post('image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * MB } }))
  async image(@UploadedFile() file: UploadedBlob | undefined) {
    if (!file) throw new BadRequestException('Choose an image to upload');
    const saved = await this.storage.save('public', file.buffer, IMAGE_KINDS, 5 * MB);
    return { url: saved.url, size: saved.size };
  }

  // PDF menus.
  @Post('menu')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * MB } }))
  async menu(@UploadedFile() file: UploadedBlob | undefined) {
    if (!file) throw new BadRequestException('Choose a PDF to upload');
    const saved = await this.storage.save('public', file.buffer, ['pdf'], 10 * MB);
    return { url: saved.url, size: saved.size };
  }
}

@Controller('site')
export class SiteController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @Get()
  site() {
    return this.settings.publicSettings();
  }
}

class MarkReadDto {
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) ids?: string[];
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser('userId') userId: string, @Query('businessId') businessId?: string, @Query('unread') unread?: string) {
    return this.notifications.list(userId, { businessId, unreadOnly: unread === 'true' });
  }

  @Get('unread-count')
  async unread(@CurrentUser('userId') userId: string) {
    return { count: await this.notifications.unreadCount(userId) };
  }

  @Post('read')
  read(@CurrentUser('userId') userId: string, @Body() dto: MarkReadDto) {
    return this.notifications.markRead(userId, dto.ids);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Admin: site settings, email templates, audit log
// ---------------------------------------------------------------------------------------------------------

class ReportRulesDto {
  @IsOptional() @IsInt() @Min(1) @Max(50) autoHideThreshold?: number;
  @IsOptional() @IsInt() @Min(1) @Max(90) windowDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(50) strikeThreshold?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) strikeWindowDays?: number;
}

export class ModerationRulesDto {
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) @MaxLength(60, { each: true }) bannedWords?: string[];
  @IsOptional() @IsNumber() @Min(1) @Max(100) maxDiscountPercent?: number;
  @IsOptional() @IsBoolean() checkLinkDomain?: boolean;
}

class UpdateSettingsDto {
  @IsOptional() @IsString() @MaxLength(80) siteName?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @IsString() @MaxLength(40) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(300) contactAddress?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(50) vatRatePercent?: number;
  @IsOptional() @IsBoolean() pricesIncludeVat?: boolean;
  @IsOptional() @IsBoolean() maintenanceMode?: boolean;
  @IsOptional() @IsString() @MaxLength(500) maintenanceMessage?: string;
  @IsOptional() @ValidateNested() @Type(() => ReportRulesDto) reports?: ReportRulesDto;
  @IsOptional() @ValidateNested() @Type(() => ModerationRulesDto) moderation?: ModerationRulesDto;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) knownOrderingDomains?: string[];
  @IsOptional() @IsString() @MaxLength(120) emailFrom?: string;
  @IsOptional() @IsString() @MaxLength(100) recaptchaSiteKey?: string;
  // Each value replaces the stored secret; "" clears it.
  @IsOptional() @IsObject() secrets?: Partial<Record<SecretName, string>>;
}

function changedFields(before: Record<string, unknown>, after: Record<string, unknown>, keys: string[]) {
  const diff: { before: Record<string, unknown>; after: Record<string, unknown> } = { before: {}, after: {} };
  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      diff.before[key] = before[key];
      diff.after[key] = after[key];
    }
  }
  return diff;
}

@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService, private readonly audit: AuditService) {}

  @RequireCapability(Capability.SETTINGS_MANAGE)
  @Get()
  get() {
    return this.settings.view();
  }

  @RequireCapability(Capability.SETTINGS_MANAGE)
  @Patch()
  async update(@Body() dto: UpdateSettingsDto) {
    const unknownSecret = Object.keys(dto.secrets ?? {}).find((name) => !(name in SECRET_ENV));
    if (unknownSecret) throw new BadRequestException(`Unknown secret ${unknownSecret}`);
    if (dto.knownOrderingDomains) {
      dto.knownOrderingDomains = [...new Set(dto.knownOrderingDomains.map((d) => d.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean))];
    }
    const before = (await this.settings.view()) as unknown as Record<string, unknown>;
    const after = (await this.settings.update(dto as never)) as unknown as Record<string, unknown>;
    const fields = Object.keys(dto).filter((k) => k !== 'secrets');
    const diff = changedFields(before, after, fields);
    await this.audit.record({
      action: 'settings.updated',
      targetType: 'SiteSettings',
      targetId: 'site',
      // Secret values never go into the audit log, only which ones changed.
      before: diff.before,
      after: { ...diff.after, ...(dto.secrets ? { secretsChanged: Object.keys(dto.secrets) } : {}) },
    });
    return after;
  }

  // The offer moderation rules are edited from the offer moderation page.
  @RequireCapability(Capability.OFFERS_MODERATE)
  @Get('moderation')
  async moderation() {
    const settings = await this.settings.get();
    return { moderation: settings.moderation, knownOrderingDomains: settings.knownOrderingDomains };
  }

  @RequireCapability(Capability.BUSINESS_MANAGE)
  @Put('moderation')
  async updateModeration(@Body() dto: ModerationRulesDto) {
    const before = (await this.settings.get()).moderation;
    if (dto.bannedWords) dto.bannedWords = [...new Set(dto.bannedWords.map((w) => w.trim().toLowerCase()).filter(Boolean))];
    await this.settings.update({ moderation: dto as never });
    const after = (await this.settings.get()).moderation;
    await this.audit.record({ action: 'moderation_rules.updated', targetType: 'SiteSettings', targetId: 'moderation', before: { ...before }, after: { ...after } });
    return { moderation: after };
  }
}

class SaveTemplateDto {
  @IsString() @MaxLength(200) subject: string;
  @IsString() @MaxLength(5000) body: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

class TestEmailDto {
  @IsEmail() to: string;
}

@Controller('admin/email-templates')
@RequireCapability(Capability.TEMPLATES_MANAGE)
export class AdminEmailTemplatesController {
  constructor(private readonly email: EmailService, private readonly audit: AuditService) {}

  @Get()
  list() {
    return this.email.listTemplates();
  }

  @Get('log')
  log(@Query('to') to?: string, @Query('template') template?: string) {
    return this.email.recentLog({ to, template, limit: 100 });
  }

  @Get(':key/preview')
  preview(@Param('key') key: string) {
    return this.email.preview(key);
  }

  @Put(':key')
  async save(@Param('key') key: string, @Body() dto: SaveTemplateDto, @CurrentUser('userId') userId: string) {
    const { before, after } = await this.email.saveTemplate(key, dto, userId);
    await this.audit.record({
      action: 'email_template.updated',
      targetType: 'EmailTemplate',
      targetId: key,
      before: before ? { subject: before.subject, body: before.body, enabled: before.enabled } : undefined,
      after: { subject: after.subject, body: after.body, enabled: after.enabled },
    });
    return after;
  }

  @Delete(':key')
  async reset(@Param('key') key: string) {
    await this.email.resetTemplate(key);
    await this.audit.record({ action: 'email_template.reset', targetType: 'EmailTemplate', targetId: key });
    return { reset: true };
  }

  @Post(':key/test')
  async test(@Param('key') key: string, @Body() dto: TestEmailDto) {
    const preview = await this.email.preview(key);
    const definition = (await this.email.listTemplates()).find((t) => t.key === key)!;
    const vars = Object.fromEntries(definition.variables.map((v) => [v, `[${v}]`]));
    const result = await this.email.send({ to: dto.to, template: key, vars });
    return { ...result, subject: preview.subject };
  }
}

class AuditQueryDto {
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsString() targetType?: string;
  @IsOptional() @IsString() targetId?: string;
  @IsOptional() @IsString() actorId?: string;
  @IsOptional() @IsIn(['admin', 'merchant', 'system', 'public']) actorKind?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @IsIn(['json', 'csv']) format?: string;
}

@Controller('admin/audit')
@RequireCapability(Capability.AUDIT_VIEW)
export class AdminAuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list(@Query() query: AuditQueryDto, @Res({ passthrough: true }) res: Response) {
    const filter = {
      action: query.action,
      targetType: query.targetType,
      targetId: query.targetId,
      actorId: query.actorId,
      actorKind: query.actorKind,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined,
    };
    if (query.format === 'csv') {
      const rows = (await this.audit.list({ ...filter, limit: 500 })) as unknown as Record<string, unknown>[];
      return csvResponse(
        res,
        'audit-log.csv',
        toCsv(rows, [
          { key: 'createdAt', label: 'When' },
          { key: 'actor', label: 'Who', value: (r) => {
            const actor = r.actor as { kind: string; userId?: { email?: string }; component?: string };
            return actor.userId?.email ?? actor.component ?? actor.kind;
          } },
          { key: 'action', label: 'Action' },
          { key: 'targetType', label: 'Entity' },
          { key: 'targetId', label: 'Entity ID' },
          { key: 'before', label: 'Before' },
          { key: 'after', label: 'After' },
          { key: 'note', label: 'Note' },
        ]),
      );
    }
    return this.audit.page({ ...filter, page: query.page ?? 1, limit: 50 });
  }
}
