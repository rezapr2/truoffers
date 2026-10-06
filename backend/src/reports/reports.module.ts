import { Body, Controller, Get, Module, Param, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MongooseModule } from '@nestjs/mongoose';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { csvResponse, toCsv } from '../common/csv';
import { ReportReason } from '../common/enums';
import { Capability, RequireCapability } from '../common/permissions';
import { Business, BusinessSchema } from '../schemas/business.schema';
import { Offer, OfferSchema } from '../schemas/offer.schema';
import {
  BusinessStrike,
  BusinessStrikeSchema,
  Report,
  ReportBlock,
  ReportBlockSchema,
  ReportCase,
  ReportCaseSchema,
  ReportSchema,
} from '../schemas/report.schema';
import { REPORT_REASON_LABELS, ReportsService } from './reports.service';

// Multipart forms send everything as strings; an empty optional field arrives as "".
const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' ? undefined : value);

class ReportDto {
  @IsEnum(ReportReason) reason: ReportReason;
  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(500) note?: string;
  @IsOptional() @Transform(emptyToUndefined) @IsEmail() email?: string;
  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(100) deviceId?: string;
  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(4000) recaptchaToken?: string;
}

class DecisionDto {
  @IsOptional() @IsEnum(ReportReason) reason?: ReportReason;
  @IsString() @MinLength(3) @MaxLength(1000) note: string;
}

class MessageDto {
  @IsString() @MinLength(3) @MaxLength(1000) message: string;
}

class BulkDto {
  @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) ids: string[];
  @IsString() @MinLength(3) @MaxLength(1000) note: string;
}

class QueueQuery {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsIn(['json', 'csv']) format?: string;
}

class AppealDecisionDto {
  @IsBoolean() accept: boolean;
  @IsString() @MinLength(3) @MaxLength(1000) response: string;
}

@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Public()
  @Get('reports/reasons')
  reasons() {
    return Object.entries(REPORT_REASON_LABELS).map(([value, label]) => ({ value, label }));
  }

  // "Report this offer", for guests and signed-in people alike
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('offers/:id/reports')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 5 * 1024 * 1024 } }))
  create(
    @Param('id') id: string,
    @Body() dto: ReportDto,
    @UploadedFile() photo: { buffer: Buffer } | undefined,
    @CurrentUser() user: AuthUser | undefined,
    @Req() req: Request,
  ) {
    return this.reports.create(id, dto, photo, user, req.ip);
  }

  @Get('businesses/:businessId/reports')
  forBusiness(@Param('businessId') businessId: string, @CurrentUser() user: AuthUser) {
    return this.reports.forBusiness(businessId, user);
  }

  @Post('businesses/:businessId/reports/:caseId/reply')
  reply(@Param('businessId') businessId: string, @Param('caseId') caseId: string, @Body() dto: MessageDto, @CurrentUser() user: AuthUser) {
    return this.reports.reply(businessId, caseId, dto.message, user);
  }

  @Post('businesses/:businessId/reports/:caseId/appeal')
  appeal(@Param('businessId') businessId: string, @Param('caseId') caseId: string, @Body() dto: MessageDto, @CurrentUser() user: AuthUser) {
    return this.reports.appeal(businessId, caseId, dto.message, user);
  }
}

@Controller('admin/reports')
@RequireCapability(Capability.REPORTS_REVIEW)
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  async queue(@Query() query: QueueQuery, @Res({ passthrough: true }) res: Response) {
    if (query.format === 'csv') {
      const { items } = await this.reports.queue({ ...query, page: '1' }, 2000);
      return csvResponse(
        res,
        'reports.csv',
        toCsv(items as unknown as Record<string, unknown>[], [
          { key: 'offer', label: 'Offer', value: (c) => (c.offerId as { title?: string } | undefined)?.title },
          { key: 'business', label: 'Business', value: (c) => (c.businessId as { name?: string } | undefined)?.name },
          { key: 'reportCount', label: 'Reports' },
          { key: 'reasons', label: 'Reasons', value: (c) => (c.reasons as { label: string; count: number }[]).map((r) => `${r.label} (${r.count})`).join('; ') },
          { key: 'status', label: 'Status' },
          { key: 'autoHidden', label: 'Auto-hidden' },
          { key: 'firstReportAt', label: 'First report' },
          { key: 'latestReportAt', label: 'Latest report' },
          { key: 'decisionNote', label: 'Decision note' },
        ]),
      );
    }
    return this.reports.queue(query);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.reports.detail(id);
  }

  @Get('photos/:reportId')
  async photo(@Param('reportId') reportId: string, @Res() res: Response) {
    const file = await this.reports.photo(reportId);
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.buffer);
  }

  @Post(':id/uphold')
  uphold(@Param('id') id: string, @Body() dto: DecisionDto, @CurrentUser('userId') userId: string) {
    return this.reports.uphold(id, dto.reason ?? ReportReason.OTHER, dto.note, userId);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: DecisionDto, @CurrentUser('userId') userId: string) {
    return this.reports.reject(id, dto.note, userId);
  }

  @Post(':id/ask-business')
  ask(@Param('id') id: string, @Body() dto: MessageDto, @CurrentUser('userId') userId: string) {
    return this.reports.askBusiness(id, dto.message, userId);
  }

  @Post(':id/appeal')
  appeal(@Param('id') id: string, @Body() dto: AppealDecisionDto, @CurrentUser('userId') userId: string) {
    return this.reports.decideAppeal(id, dto.accept, dto.response, userId);
  }

  @Post('bulk-reject')
  bulkReject(@Body() dto: BulkDto, @CurrentUser('userId') userId: string) {
    return this.reports.bulkReject(dto.ids, dto.note, userId);
  }

  @Post('reports/:reportId/block')
  block(@Param('reportId') reportId: string, @Body() dto: MessageDto, @CurrentUser('userId') userId: string) {
    return this.reports.blockReporter(reportId, dto.message, userId);
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Report.name, schema: ReportSchema },
      { name: ReportCase.name, schema: ReportCaseSchema },
      { name: BusinessStrike.name, schema: BusinessStrikeSchema },
      { name: ReportBlock.name, schema: ReportBlockSchema },
      { name: Offer.name, schema: OfferSchema },
      { name: Business.name, schema: BusinessSchema },
    ]),
  ],
  controllers: [ReportsController, AdminReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
