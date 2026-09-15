import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Types } from 'mongoose';
import { CurrentUser, Roles } from '../../common/decorators';
import { Role } from '../../common/enums';
import { AuditAction, AuthorisationSource, CandidateStatus, DomainAuthorisationStatus, OptOutSource } from '../../common/scraper.enums';
import { AuditService } from '../audit/audit.service';
import { RunsService } from '../queue/runs.service';
import { CandidatesService } from '../review/candidates.service';
import { JobMonitoringService } from '../review/job-monitoring.service';
import { OptOutsService } from '../review/opt-outs.service';
import { ProviderPoliciesService } from '../review/provider-policies.service';
import { ScraperSettingsService } from '../review/scraper-settings.service';
import { WebsitesService } from '../review/websites.service';
import { INTAKE_LIMITS } from '../scraper.constants';
import {
  ApproveCandidateDto,
  AttachBusinessDto,
  AuthoriseWebsiteDto,
  BlockSourceDto,
  BranchDecisionDto,
  CrawlConfigDto,
  CreateOptOutDto,
  EditCandidateDto,
  ListCandidatesQuery,
  ListJobsQuery,
  ListOptOutsQuery,
  ListWebsitesQuery,
  MergeCandidateDto,
  PauseDto,
  ProviderClientListDto,
  ProviderPolicyDto,
  ReasonDto,
  SubmitWebsitesDto,
  UpdateSettingsDto,
} from './scraper.dto';

type AuthUser = { userId: string; role: Role; name?: string };
const ADMIN = [Role.SUPER_ADMIN, Role.SUPPORT_ADMIN, Role.SALES_ADMIN] as const;
const csvUpload = FileInterceptor('file', { limits: { fileSize: INTAKE_LIMITS.csvMaxBytes, files: 1 } });

@Roles(...ADMIN)
@Controller('admin/scraper/websites')
export class AdminWebsitesController {
  constructor(private readonly websites: WebsitesService) {}

  @Get()
  list(@Query() query: ListWebsitesQuery) {
    return this.websites.list(query);
  }

  @Post()
  submit(@Body() dto: SubmitWebsitesDto, @CurrentUser('userId') userId: string) {
    return this.websites.submit(dto.urls, { source: AuthorisationSource.ADMIN_MANUAL, submittedBy: userId });
  }

  @Post('csv')
  @UseInterceptors(csvUpload)
  submitCsv(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser('userId') userId: string) {
    if (!file) throw new BadRequestException('Attach a CSV file');
    return this.websites.submit(this.websites.parseCsv(file.buffer), { source: AuthorisationSource.ADMIN_CSV, submittedBy: userId });
  }

  @Post('provider-client-list')
  @UseInterceptors(csvUpload)
  submitProviderList(@UploadedFile() file: Express.Multer.File | undefined, @Body() dto: ProviderClientListDto, @CurrentUser('userId') userId: string) {
    if (!file) throw new BadRequestException('Attach the provider’s client list as CSV');
    return this.websites.submit(this.websites.parseCsv(file.buffer), {
      source: AuthorisationSource.PROVIDER_CLIENT_LIST,
      submittedBy: userId,
      providerPolicyId: dto.providerPolicyId,
    });
  }

  @Get('pending-branches')
  pendingBranches() {
    return this.websites.pendingBranches();
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.websites.detail(id);
  }

  @Post(':id/analyse')
  analyse(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.websites.analyse(id, userId);
  }

  @Patch(':id/authorise')
  authorise(@Param('id') id: string, @Body() dto: AuthoriseWebsiteDto, @CurrentUser('userId') userId: string) {
    return this.websites.authorise(id, dto.decision, userId, dto.note);
  }

  @Patch(':id/pause')
  pause(@Param('id') id: string, @Body() dto: PauseDto, @CurrentUser('userId') userId: string) {
    return this.websites.setPaused(id, dto.paused, userId, dto.reason);
  }

  @Patch(':id/crawl-config')
  crawlConfig(@Param('id') id: string, @Body() dto: CrawlConfigDto) {
    return this.websites.updateCrawlConfig(id, dto);
  }

  @Patch(':id/branches')
  decideBranch(@Param('id') id: string, @Query('path') branchPath: string, @Body() dto: BranchDecisionDto, @CurrentUser('userId') userId: string) {
    if (!branchPath) throw new BadRequestException('Pass the branch path as ?path=');
    if ((dto.action === 'confirm' || dto.action === 'attach') && !dto.businessId) throw new BadRequestException('businessId is required');
    if (dto.action === 'create' && !dto.business) throw new BadRequestException('business details are required');
    const decision =
      dto.action === 'create'
        ? { action: 'create' as const, business: dto.business! }
        : dto.action === 'reject'
          ? { action: 'reject' as const, note: dto.note }
          : { action: dto.action, businessId: dto.businessId! };
    return this.websites.decideBranch(id, branchPath, decision, userId);
  }
}

@Roles(...ADMIN)
@Controller('admin/scraper/candidates')
export class AdminCandidatesController {
  constructor(private readonly candidates: CandidatesService) {}

  @Get()
  list(@Query() query: ListCandidatesQuery) {
    return this.candidates.list(query);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.candidates.detail(id);
  }

  @Patch(':id')
  edit(@Param('id') id: string, @Body() dto: EditCandidateDto, @CurrentUser() user: AuthUser) {
    return this.candidates.edit(id, dto, user);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Body() dto: ApproveCandidateDto, @CurrentUser('userId') userId: string) {
    return this.candidates.approve(id, dto.verification, userId, { branchPaths: dto.branchPaths, note: dto.note });
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser('userId') userId: string) {
    return this.candidates.reject(id, userId, dto.reason);
  }

  @Post(':id/merge')
  merge(@Param('id') id: string, @Body() dto: MergeCandidateDto, @CurrentUser('userId') userId: string) {
    return this.candidates.merge(id, userId, dto);
  }

  @Post(':id/attach-business')
  attach(@Param('id') id: string, @Body() dto: AttachBusinessDto, @CurrentUser('userId') userId: string) {
    return this.candidates.attachBusiness(id, dto.branchPath, dto.businessId, userId);
  }

  @Post(':id/request-merchant-confirmation')
  requestMerchantConfirmation(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.candidates.requestMerchantConfirmation(id, userId);
  }

  @Post(':id/block-source')
  blockSource(@Param('id') id: string, @Body() dto: BlockSourceDto, @CurrentUser('userId') userId: string) {
    return this.candidates.blockSource(id, dto.scope, userId, dto.reason);
  }

  @Post(':id/reextract')
  reextract(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.candidates.reextract(id, userId);
  }
}

@Roles(...ADMIN)
@Controller('admin/scraper/provider-policies')
export class AdminProviderPoliciesController {
  constructor(private readonly policies: ProviderPoliciesService) {}

  @Get()
  list() {
    return this.policies.list();
  }

  @Post()
  create(@Body() dto: ProviderPolicyDto, @CurrentUser('userId') userId: string) {
    return this.policies.create(dto, userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: ProviderPolicyDto, @CurrentUser('userId') userId: string) {
    return this.policies.update(id, dto, userId);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.policies.remove(id);
  }
}

@Roles(...ADMIN)
@Controller('admin/scraper/opt-outs')
export class AdminOptOutsController {
  constructor(private readonly optOuts: OptOutsService) {}

  @Get()
  list(@Query() query: ListOptOutsQuery) {
    return this.optOuts.list(query);
  }

  @Post()
  create(@Body() dto: CreateOptOutDto, @CurrentUser('userId') userId: string) {
    return this.optOuts.create({ domain: dto.domain, reason: dto.reason, source: OptOutSource.ADMIN, createdBy: userId });
  }

  @Patch(':id/acknowledge')
  acknowledge(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.optOuts.acknowledge(id, userId);
  }

  @Delete(':id')
  lift(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.optOuts.lift(id, userId);
  }
}

@Roles(...ADMIN)
@Controller('admin/scraper/jobs')
export class AdminJobsController {
  constructor(
    private readonly monitoring: JobMonitoringService,
    private readonly runs: RunsService,
  ) {}

  @Get()
  list(@Query() query: ListJobsQuery) {
    return this.monitoring.list(query);
  }

  @Get('status')
  status() {
    return this.monitoring.status();
  }

  @Get('runs/:runId')
  run(@Param('runId') runId: string) {
    return this.monitoring.run(runId);
  }

  @Post('runs/:runId/cancel')
  cancelRun(@Param('runId') runId: string, @CurrentUser('userId') userId: string) {
    return this.runs.cancelRun(runId, userId);
  }

  @Post('emergency-stop')
  async emergencyStop() {
    await this.runs.emergencyStop();
    return this.monitoring.status();
  }

  @Post('resume')
  async resume() {
    await this.runs.resume();
    return this.monitoring.status();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.monitoring.get(id);
  }

  @Post(':id/retry')
  retry(@Param('id') id: string) {
    return this.runs.retry(id);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    const job = await this.monitoring.get(id);
    return this.runs.cancelRun(String(job.runId), userId);
  }
}

@Roles(...ADMIN)
@Controller('admin/scraper')
export class AdminScraperController {
  constructor(
    private readonly settings: ScraperSettingsService,
    private readonly audit: AuditService,
    private readonly websites: WebsitesService,
    private readonly candidates: CandidatesService,
    private readonly optOuts: OptOutsService,
    private readonly monitoring: JobMonitoringService,
  ) {}

  // Counters for the admin dashboard and navigation badges.
  @Get('overview')
  async overview() {
    const [candidates, pendingDomains, providerReview, branches, removalRequests, status] = await Promise.all([
      this.candidates.list({ status: CandidateStatus.PENDING_REVIEW, limit: 1 }),
      this.websites.list({ status: DomainAuthorisationStatus.PENDING_AUTHORISATION, limit: 1 }),
      this.websites.list({ status: DomainAuthorisationStatus.AWAITING_PROVIDER_REVIEW, limit: 1 }),
      this.websites.pendingBranches(200),
      this.optOuts.unacknowledgedCount(),
      this.monitoring.status(),
    ]);
    return {
      candidatesAwaitingReview: candidates.total,
      openCandidatesByBand: candidates.openByBand,
      domainsPendingAuthorisation: pendingDomains.total,
      websitesAwaitingProviderReview: providerReview.total,
      branchesAwaitingMatch: branches.length,
      unacknowledgedRemovalRequests: removalRequests,
      halted: status.halted,
      workers: status.workers.length,
    };
  }

  // aiAvailable: whether this deployment has an API key, so the setting can actually take effect.
  @Get('settings')
  async getSettings() {
    return { ...(await this.settings.get()), aiAvailable: !!process.env.ANTHROPIC_API_KEY };
  }

  @Patch('settings')
  async updateSettings(@Body() dto: UpdateSettingsDto, @CurrentUser('userId') userId: string) {
    const patch = {
      ...dto,
      extraNeverCrawlDomains: dto.extraNeverCrawlDomains?.map((d) => d.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean),
    };
    const { before, after } = await this.settings.update({ ...patch, updatedBy: new Types.ObjectId(userId) });
    await this.audit.record({
      action: AuditAction.SETTINGS_UPDATED,
      targetType: 'ScraperSettings',
      before: { aiExtractionEnabled: before.aiExtractionEnabled, defaultRateLimitMs: before.defaultRateLimitMs, defaultPageCap: before.defaultPageCap, extraNeverCrawlDomains: before.extraNeverCrawlDomains },
      after: { aiExtractionEnabled: after.aiExtractionEnabled, defaultRateLimitMs: after.defaultRateLimitMs, defaultPageCap: after.defaultPageCap, extraNeverCrawlDomains: after.extraNeverCrawlDomains },
    });
    return { ...after, aiAvailable: !!process.env.ANTHROPIC_API_KEY };
  }

  @Get('audit-log')
  auditLog(@Query('action') action?: AuditAction, @Query('targetType') targetType?: string, @Query('targetId') targetId?: string, @Query('before') before?: string) {
    return this.audit.list({ action, targetType, targetId, before: before ? new Date(before) : undefined });
  }

}
