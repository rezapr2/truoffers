import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../common/decorators';
import { csvResponse, toCsv } from '../common/csv';
import { Capability, RequireCapability } from '../common/permissions';
import {
  ApproveClaimDto,
  AssignDto,
  ChecklistDto,
  ClaimListQuery,
  CodeDto,
  DecideChangeDto,
  DocumentStatusDto,
  DomainEmailDto,
  FhrsPickDto,
  MessageDto,
  NewBusinessClaimDto,
  RejectClaimDto,
  RequestInfoDto,
  ReverifyDto,
  SendCodeDto,
  SiteCheckDto,
  StartClaimDto,
  UploadDocumentDto,
} from './claims.dto';
import { ClaimsAdminService } from './claims-admin.service';
import { ClaimsService } from './claims.service';

const MB = 1024 * 1024;

function sendFile(res: Response, file: { buffer: Buffer; mime: string; name: string }) {
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Disposition', `inline; filename="${file.name.replace(/[^\w.\- ]/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'");
  res.send(file.buffer);
}

@Controller('claims')
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.claims.mine(user);
  }

  @Post()
  start(@Body() dto: StartClaimDto, @CurrentUser() user: AuthUser) {
    return this.claims.start(dto.businessId, user);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('new-business')
  newBusiness(@Body() dto: NewBusinessClaimDto, @CurrentUser() user: AuthUser) {
    return this.claims.startNewBusiness(dto.business, !!dto.confirmNotDuplicate, user);
  }

  @Post('reverify')
  reverify(@Body() dto: ReverifyDto, @CurrentUser() user: AuthUser) {
    return this.claims.startReverification(dto.businessId, user);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.claims.get(id, user);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':id/phone/send')
  sendCode(@Param('id') id: string, @Body() dto: SendCodeDto, @CurrentUser() user: AuthUser) {
    return this.claims.sendCode(id, dto.channel, user);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/phone/verify')
  verifyCode(@Param('id') id: string, @Body() dto: CodeDto, @CurrentUser() user: AuthUser) {
    return this.claims.verifyCode(id, dto.code, user);
  }

  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * MB } }))
  upload(
    @Param('id') id: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: { buffer: Buffer; size: number; originalname: string; mimetype: string } | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.claims.uploadDocument(id, dto.type, file, user);
  }

  @Get(':id/documents/:documentId')
  async document(@Param('id') id: string, @Param('documentId') documentId: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    sendFile(res, await this.claims.readDocument(id, documentId, user));
  }

  @Delete(':id/documents/:documentId')
  removeDocument(@Param('id') id: string, @Param('documentId') documentId: string, @CurrentUser() user: AuthUser) {
    return this.claims.removeDocument(id, documentId, user);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':id/domain/email')
  domainEmail(@Param('id') id: string, @Body() dto: DomainEmailDto, @CurrentUser() user: AuthUser) {
    return this.claims.domainEmail(id, dto.email, user);
  }

  @Post(':id/domain/email/verify')
  domainEmailVerify(@Param('id') id: string, @Body() dto: CodeDto, @CurrentUser() user: AuthUser) {
    return this.claims.domainEmailVerify(id, dto.code, user);
  }

  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post(':id/domain/site')
  siteCheck(@Param('id') id: string, @Body() dto: SiteCheckDto, @CurrentUser() user: AuthUser) {
    return this.claims.siteCheck(id, dto.method, user);
  }

  @Get(':id/fhrs/search')
  fhrsSearch(@Param('id') id: string, @CurrentUser() user: AuthUser, @Query('name') name?: string, @Query('postcode') postcode?: string) {
    return this.claims.fhrsSearch(id, user, name, postcode);
  }

  @Post(':id/fhrs')
  fhrsPick(@Param('id') id: string, @Body() dto: FhrsPickDto, @CurrentUser() user: AuthUser) {
    return this.claims.fhrsPick(id, dto.fhrsId, user);
  }

  @Post(':id/submit')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.claims.submit(id, user);
  }

  @Post(':id/messages')
  message(@Param('id') id: string, @Body() dto: MessageDto, @CurrentUser() user: AuthUser) {
    return this.claims.message(id, dto.body, user);
  }

  @Post(':id/withdraw')
  withdraw(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.claims.withdraw(id, user);
  }
}

@Controller('admin/claims')
@RequireCapability(Capability.CLAIMS_REVIEW)
export class AdminClaimsController {
  constructor(private readonly admin: ClaimsAdminService) {}

  @Get()
  async list(@Query() query: ClaimListQuery, @CurrentUser('userId') userId: string, @Res({ passthrough: true }) res: Response) {
    if (query.format === 'csv') {
      const { items } = await this.admin.list({ ...query, page: '1' }, userId, 2000);
      return csvResponse(
        res,
        'claims.csv',
        toCsv(items as unknown as Record<string, unknown>[], [
          { key: 'business', label: 'Business', value: (c) => (c.businessId as { name?: string } | undefined)?.name },
          { key: 'postcode', label: 'Postcode', value: (c) => (c.businessId as { postcode?: string } | undefined)?.postcode },
          { key: 'claimant', label: 'Claimant', value: (c) => (c.userId as { email?: string } | undefined)?.email },
          { key: 'kind', label: 'Kind' },
          { key: 'status', label: 'Status' },
          { key: 'submittedAt', label: 'Submitted' },
          { key: 'ageHours', label: 'Age (hours)' },
          { key: 'phoneOtpPassed', label: 'Phone check' },
          { key: 'domainCheckPassed', label: 'Domain check' },
          { key: 'fhrsMatch', label: 'FHRS match' },
          { key: 'reasonCode', label: 'Reject reason' },
        ]),
      );
    }
    return this.admin.list(query, userId);
  }

  @Get('stats')
  stats() {
    return this.admin.queueStats();
  }

  @Get('change-requests')
  changeRequests(@Query('status') status?: string) {
    return this.admin.changeRequests(status);
  }

  @Post('change-requests/:id/approve')
  approveChange(@Param('id') id: string, @Body() dto: DecideChangeDto, @CurrentUser('userId') userId: string) {
    return this.admin.decideChange(id, true, userId, dto.note);
  }

  @Post('change-requests/:id/reject')
  rejectChange(@Param('id') id: string, @Body() dto: DecideChangeDto, @CurrentUser('userId') userId: string) {
    return this.admin.decideChange(id, false, userId, dto.note);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.admin.detail(id);
  }

  @Patch(':id/assign')
  assign(@Param('id') id: string, @Body() dto: AssignDto) {
    return this.admin.assign(id, dto.userId);
  }

  @Patch(':id/checklist')
  checklist(@Param('id') id: string, @Body() dto: ChecklistDto) {
    return this.admin.checklist(id, dto);
  }

  @Get(':id/documents/:documentId')
  async document(@Param('id') id: string, @Param('documentId') documentId: string, @Res() res: Response) {
    sendFile(res, await this.admin.readDocument(id, documentId));
  }

  @Patch(':id/documents/:documentId')
  documentStatus(@Param('id') id: string, @Param('documentId') documentId: string, @Body() dto: DocumentStatusDto) {
    return this.admin.documentStatus(id, documentId, dto.status);
  }

  @Post(':id/messages')
  message(@Param('id') id: string, @Body() dto: MessageDto, @CurrentUser('userId') userId: string) {
    return this.admin.message(id, dto.body, userId);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Body() dto: ApproveClaimDto, @CurrentUser('userId') userId: string) {
    return this.admin.approve(id, userId, dto.note);
  }

  @Post(':id/request-info')
  requestInfo(@Param('id') id: string, @Body() dto: RequestInfoDto, @CurrentUser('userId') userId: string) {
    return this.admin.requestInfo(id, dto.message, userId);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectClaimDto, @CurrentUser('userId') userId: string) {
    return this.admin.reject(id, dto.reasonCode, dto.note, userId);
  }
}
