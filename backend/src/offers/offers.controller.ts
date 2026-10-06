import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { OffersService } from './offers.service';
import { OffersAdminService } from './offers-admin.service';
import {
  AdminOfferEditDto,
  AdminOfferQuery,
  BulkOfferActionDto,
  CreateOfferDto,
  FeatureOfferDto,
  OfferExpiryDto,
  RedeemOfferDto,
  RejectOfferDto,
  UpdateOfferDto,
} from './offers.dto';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { OfferRejectReason, OfferStatus } from '../common/enums';
import { Capability, RequireCapability } from '../common/permissions';
import { csvResponse, toCsv } from '../common/csv';

@Controller()
export class OffersController {
  constructor(private readonly service: OffersService) {}

  @Public()
  @Get('offers')
  list(@Query('businessId') businessId?: string, @Query('limit') limit?: string) {
    return this.service.listPublic({ businessId, limit: limit ? parseInt(limit, 10) : undefined });
  }

  @Public()
  @Get('offers/:id')
  get(@Param('id') id: string) {
    return this.service.getPublic(id);
  }

  @Public()
  @Post('offers/:id/redeem')
  redeem(@Param('id') id: string, @Body() dto: RedeemOfferDto, @CurrentUser('userId') userId?: string) {
    return this.service.redeem(id, dto, userId);
  }

  // ---- The business's own offers ----

  @Get('businesses/:businessId/offers/manage')
  listForBusiness(@Param('businessId') businessId: string, @CurrentUser() user: AuthUser, @Query('tab') tab?: string) {
    return this.service.listForBusiness(businessId, user, tab);
  }

  @Post('businesses/:businessId/offers')
  create(@Param('businessId') businessId: string, @Body() dto: CreateOfferDto, @CurrentUser() user: AuthUser) {
    return this.service.create(businessId, dto, user);
  }

  @Get('offers/:id/manage')
  getForBusiness(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getForBusiness(id, user);
  }

  @Patch('offers/:id')
  update(@Param('id') id: string, @Body() dto: UpdateOfferDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Post('offers/:id/submit')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.submit(id, user);
  }

  @Post('offers/:id/pause')
  pause(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.pause(id, user);
  }

  @Post('offers/:id/resume')
  resume(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.resume(id, user);
  }

  @Post('offers/:id/duplicate')
  duplicate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.duplicate(id, user);
  }

  // Kept for older clients: pause or resume by status.
  @Patch('offers/:id/status')
  setStatus(@Param('id') id: string, @Body('status') status: OfferStatus, @CurrentUser() user: AuthUser) {
    return status === OfferStatus.PAUSED ? this.service.pause(id, user) : this.service.resume(id, user);
  }

  @Delete('offers/:id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}

@Controller('admin/offers')
@RequireCapability(Capability.OFFERS_MODERATE)
export class AdminOffersController {
  constructor(private readonly admin: OffersAdminService) {}

  @Get()
  async list(@Query() query: AdminOfferQuery, @Res({ passthrough: true }) res: Response) {
    if (query.format === 'csv') {
      const { items } = await this.admin.list({ ...query, page: '1' }, 2000);
      return csvResponse(
        res,
        'offers.csv',
        toCsv(items as unknown as Record<string, unknown>[], [
          { key: 'title', label: 'Offer' },
          { key: 'business', label: 'Business', value: (o) => (o.businessId as { name?: string } | undefined)?.name },
          { key: 'city', label: 'City', value: (o) => (o.businessId as { town?: string } | undefined)?.town },
          { key: 'status', label: 'Status' },
          { key: 'origin', label: 'Source' },
          { key: 'displayLabel', label: 'Label' },
          { key: 'startsAt', label: 'Starts' },
          { key: 'endsAt', label: 'Ends' },
          { key: 'impressions', label: 'Impressions' },
          { key: 'orderClicks', label: 'Order clicks' },
          { key: 'createdAt', label: 'Created' },
        ]),
      );
    }
    return this.admin.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.admin.get(id);
  }

  @Patch(':id')
  edit(@Param('id') id: string, @Body() dto: AdminOfferEditDto, @CurrentUser('userId') userId: string) {
    return this.admin.edit(id, dto, userId);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser('userId') userId: string) {
    return this.admin.approve(id, userId);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectOfferDto) {
    return this.admin.reject(id, dto.reasonCode, dto.note);
  }

  @Post(':id/pause')
  pause(@Param('id') id: string) {
    return this.admin.pause(id);
  }

  @Post(':id/feature')
  feature(@Param('id') id: string, @Body() dto: FeatureOfferDto) {
    return this.admin.feature(id, dto.featured);
  }

  @Post(':id/expiry')
  expiry(@Param('id') id: string, @Body() dto: OfferExpiryDto) {
    return this.admin.setExpiry(id, dto.endsAt);
  }

  @Post('bulk')
  async bulk(@Body() dto: BulkOfferActionDto, @CurrentUser('userId') userId: string) {
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of dto.ids) {
      try {
        if (dto.action === 'approve') await this.admin.approve(id, userId);
        else if (dto.action === 'pause') await this.admin.pause(id);
        else await this.admin.reject(id, dto.reasonCode ?? OfferRejectReason.OTHER, dto.note || 'Rejected by a moderator');
        results.push({ id, ok: true });
      } catch (err) {
        results.push({ id, ok: false, error: (err as Error).message });
      }
    }
    return { results };
  }
}
