import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { SkipThrottle } from '@nestjs/throttler';
import { Model, Types } from 'mongoose';
import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import {
  AnalyticsEvent,
  AnalyticsEventDocument,
  AnalyticsEventSchema,
} from '../schemas/analytics-event.schema';
import { Business, BusinessDocument, BusinessSchema } from '../schemas/business.schema';
import { Offer, OfferDocument, OfferSchema } from '../schemas/offer.schema';
import { CurrentUser, Public } from '../common/decorators';
import { Role } from '../common/enums';

// Taxonomy per blueprint section 16.2
export const EVENT_NAMES = [
  'page_view',
  'postcode_search',
  'filter_apply',
  'offer_impression',
  'offer_flip',
  'offer_detail_view',
  'business_profile_view',
  'order_click',
  'call_click',
  'directions_click',
  'redeem_click',
  'qr_scan',
  'claim_start',
  'claim_complete',
  'offer_created',
  'upgrade_click',
  'subscription_start',
  'supplier_lead_submit',
  'save_offer',
  'share_offer',
] as const;

export class TrackEventDto {
  @IsIn(EVENT_NAMES as unknown as string[])
  eventName: string;

  @IsOptional() @IsString() sessionId?: string;
  @IsOptional() @IsString() businessId?: string;
  @IsOptional() @IsString() offerId?: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() postcodeArea?: string;
  @IsOptional() @IsObject() metadata?: Record<string, any>;
}

// Events that also bump denormalised counters on the offer document
const OFFER_COUNTER: Record<string, string> = {
  offer_impression: 'impressions',
  offer_flip: 'flips',
  offer_detail_view: 'detailViews',
  order_click: 'orderClicks',
};

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(AnalyticsEvent.name) private eventModel: Model<AnalyticsEventDocument>,
    @InjectModel(Business.name) private businessModel: Model<BusinessDocument>,
    @InjectModel(Offer.name) private offerModel: Model<OfferDocument>,
  ) {}

  async track(dto: TrackEventDto, userId?: string) {
    await this.eventModel.create({
      eventName: dto.eventName,
      userId: userId ? new Types.ObjectId(userId) : undefined,
      sessionId: dto.sessionId,
      businessId: dto.businessId ? new Types.ObjectId(dto.businessId) : undefined,
      offerId: dto.offerId ? new Types.ObjectId(dto.offerId) : undefined,
      supplierId: dto.supplierId ? new Types.ObjectId(dto.supplierId) : undefined,
      postcodeArea: dto.postcodeArea?.toUpperCase(),
      metadata: dto.metadata || {},
    });
    const counter = OFFER_COUNTER[dto.eventName];
    if (counter && dto.offerId) {
      await this.offerModel.findByIdAndUpdate(dto.offerId, { $inc: { [counter]: 1 } });
    }
    return { ok: true };
  }

  async trackBatch(events: TrackEventDto[], userId?: string) {
    for (const e of events.slice(0, 50)) {
      await this.track(e, userId);
    }
    return { ok: true, count: Math.min(events.length, 50) };
  }

  // Business performance dashboard (blueprint 16.3)
  async businessMetrics(businessId: string, user: { userId: string; role: Role }, days = 30) {
    const business = await this.businessModel.findById(businessId);
    if (!business) throw new NotFoundException('Business not found');
    const isAdmin = [Role.SUPER_ADMIN, Role.SUPPORT_ADMIN, Role.SALES_ADMIN].includes(user.role);
    if (!isAdmin && String(business.ownerId) !== user.userId) {
      throw new ForbiddenException('You do not manage this business');
    }

    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const bId = new Types.ObjectId(businessId);

    const counts = await this.eventModel.aggregate([
      { $match: { businessId: bId, createdAt: { $gte: since } } },
      { $group: { _id: '$eventName', count: { $sum: 1 } } },
    ]);
    const byEvent: Record<string, number> = {};
    for (const c of counts) byEvent[c._id] = c.count;

    const daily = await this.eventModel.aggregate([
      {
        $match: {
          businessId: bId,
          createdAt: { $gte: since },
          eventName: { $in: ['offer_impression', 'business_profile_view', 'order_click'] },
        },
      },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            event: '$eventName',
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.day': 1 } },
    ]);

    const impressions = byEvent['offer_impression'] || 0;
    const flips = byEvent['offer_flip'] || 0;
    const profileViews = byEvent['business_profile_view'] || 0;
    const orderClicks = byEvent['order_click'] || 0;
    const detailViews = byEvent['offer_detail_view'] || 0;
    const redeems = byEvent['redeem_click'] || 0;

    return {
      periodDays: days,
      totals: {
        impressions,
        flips,
        profileViews,
        orderClicks,
        callClicks: byEvent['call_click'] || 0,
        directionsClicks: byEvent['directions_click'] || 0,
        redeems,
        saves: byEvent['save_offer'] || 0,
      },
      // Key formulas per blueprint 16.4
      rates: {
        flipRate: impressions ? round(flips / impressions) : 0,
        offerToProfileRate: flips ? round(profileViews / flips) : 0,
        profileToOrderRate: profileViews ? round(orderClicks / profileViews) : 0,
        redemptionRate: detailViews ? round(redeems / detailViews) : 0,
      },
      daily: daily.map((d) => ({ day: d._id.day, event: d._id.event, count: d.count })),
    };
  }
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

// High-frequency fire-and-forget events shouldn't consume the API rate budget
@SkipThrottle()
@Controller()
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Public()
  @Post('events')
  track(@Body() dto: TrackEventDto, @CurrentUser('userId') userId?: string) {
    return this.service.track(dto, userId);
  }

  @Public()
  @Post('events/batch')
  trackBatch(@Body('events') events: TrackEventDto[], @CurrentUser('userId') userId?: string) {
    return this.service.trackBatch(events || [], userId);
  }

  @Get('dashboard/businesses/:businessId/metrics')
  businessMetrics(
    @Param('businessId') businessId: string,
    @CurrentUser() user: { userId: string; role: Role },
    @Query('days') days?: string,
  ) {
    return this.service.businessMetrics(businessId, user, days ? parseInt(days, 10) : 30);
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AnalyticsEvent.name, schema: AnalyticsEventSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Offer.name, schema: OfferSchema },
    ]),
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
