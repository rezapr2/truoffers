import { Body, Controller, Get, Headers, Injectable, Logger, Module, Param, Post, Query, Res } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { SkipThrottle } from '@nestjs/throttler';
import { Model, Types } from 'mongoose';
import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { AnalyticsEvent, AnalyticsEventDocument, AnalyticsEventSchema } from '../schemas/analytics-event.schema';
import { Business, BusinessDocument, BusinessSchema } from '../schemas/business.schema';
import { Offer, OfferDocument, OfferSchema } from '../schemas/offer.schema';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { BusinessAccessService } from '../common/business-access';
import { csvResponse, toCsv } from '../common/csv';
import { BusinessStatus, PLAN_GRANTING_STATUSES } from '../common/enums';
import { sha256 } from '../platform/crypto';
import { siteUrl } from '../platform/email.service';
import { NotificationsService } from '../platform/notifications.service';
import { PlansService } from '../plans/plans.service';
import { Subscription, SubscriptionDocument, SubscriptionSchema } from '../schemas/subscription.schema';

// Taxonomy per blueprint §16.2, plus the MVP's redeem events (spec "events").
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
  'code_copy',
  'qr_scan',
  'claim_start',
  'claim_complete',
  'offer_created',
  'upgrade_click',
  'subscription_start',
  'supplier_lead_submit',
  'save_offer',
  'share_offer',
  'follow',
  'unfollow',
  'report_offer',
  'ai_offer_writer',
] as const;

// Crawlers, link previews and headless browsers don't count (spec T5.4: bot traffic filtered).
const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|quora link|whatsapp|telegram|discord|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|httpclient|java\/|go-http|axios|node-fetch|okhttp|scrapy/i;

export function isBot(userAgent: string | undefined): boolean {
  return !userAgent || userAgent.length < 10 || BOT_UA.test(userAgent);
}

export class TrackEventDto {
  @IsIn(EVENT_NAMES as unknown as string[])
  eventName: string;

  @IsOptional() @IsString() @MaxLength(100) sessionId?: string;
  @IsOptional() @IsString() @MaxLength(30) businessId?: string;
  @IsOptional() @IsString() @MaxLength(30) offerId?: string;
  @IsOptional() @IsString() @MaxLength(30) supplierId?: string;
  @IsOptional() @IsString() @MaxLength(10) postcodeArea?: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

// Events that also bump denormalised counters on the offer document
const OFFER_COUNTER: Record<string, string> = {
  offer_impression: 'impressions',
  offer_flip: 'flips',
  offer_detail_view: 'detailViews',
  order_click: 'orderClicks',
};

// The Insights metrics (spec dashboard: impressions, profile views, redeem taps, order clicks, calls, code
// copies, followers).
export const INSIGHT_METRICS: { key: string; label: string; events: string[]; basic: boolean }[] = [
  { key: 'impressions', label: 'Impressions', events: ['offer_impression'], basic: true },
  { key: 'profileViews', label: 'Profile views', events: ['business_profile_view'], basic: true },
  { key: 'offerViews', label: 'Offer page views', events: ['offer_detail_view'], basic: false },
  { key: 'redeemTaps', label: 'Redeem taps', events: ['offer_flip', 'redeem_click'], basic: false },
  { key: 'orderClicks', label: 'Order clicks', events: ['order_click'], basic: false },
  { key: 'calls', label: 'Calls', events: ['call_click'], basic: false },
  { key: 'codeCopies', label: 'Code copies', events: ['code_copy'], basic: false },
  { key: 'directions', label: 'Directions', events: ['directions_click'], basic: false },
  { key: 'newFollowers', label: 'New followers', events: ['follow'], basic: false },
  // Orders the business's Foodbell site reported as done after a visitor came from TruOffers (src/foodbell).
  // Recorded by the server only: browsers can't send this event.
  { key: 'foodbellOrders', label: 'Foodbell orders', events: ['partner_order'], basic: false },
];

const EVENT_TO_METRIC = new Map<string, string>();
for (const metric of INSIGHT_METRICS) for (const event of metric.events) EVENT_TO_METRIC.set(event, metric.key);

const objectId = (value?: string) => (value && Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : undefined);

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectModel(AnalyticsEvent.name) private eventModel: Model<AnalyticsEventDocument>,
    @InjectModel(Business.name) private businessModel: Model<BusinessDocument>,
    @InjectModel(Offer.name) private offerModel: Model<OfferDocument>,
    @InjectModel(Subscription.name) private subscriptions: Model<SubscriptionDocument>,
    private readonly access: BusinessAccessService,
    private readonly plans: PlansService,
    private readonly notifications: NotificationsService,
  ) {}

  /** No personal data: no account, no IP; the session id is stored hashed. */
  async track(dto: TrackEventDto, userAgent?: string) {
    if (isBot(userAgent)) return { ok: true, ignored: 'bot' };
    const offerId = objectId(dto.offerId);
    let businessId = objectId(dto.businessId);
    if (offerId && !businessId) {
      const offer = await this.offerModel.findById(offerId).select('businessId').lean();
      businessId = offer?.businessId;
    }
    await this.eventModel.create({
      eventName: dto.eventName,
      sessionId: dto.sessionId ? sha256(`session:${dto.sessionId}`).slice(0, 24) : undefined,
      businessId,
      offerId,
      supplierId: objectId(dto.supplierId),
      postcodeArea: dto.postcodeArea?.toUpperCase().slice(0, 8),
      metadata: dto.metadata || {},
    });
    const counter = OFFER_COUNTER[dto.eventName];
    if (counter && offerId) await this.offerModel.updateOne({ _id: offerId }, { $inc: { [counter]: 1 } });
    return { ok: true };
  }

  async trackBatch(events: TrackEventDto[], userAgent?: string) {
    if (isBot(userAgent)) return { ok: true, count: 0 };
    for (const e of (events || []).slice(0, 50)) {
      if (EVENT_NAMES.includes(e?.eventName as (typeof EVENT_NAMES)[number])) await this.track(e, userAgent);
    }
    return { ok: true, count: Math.min(events?.length ?? 0, 50) };
  }

  /** Server-side events (follows), recorded without any client involvement. */
  async record(eventName: (typeof EVENT_NAMES)[number], fields: { businessId?: Types.ObjectId | string; offerId?: Types.ObjectId | string }) {
    await this.eventModel.create({
      eventName,
      businessId: fields.businessId ? new Types.ObjectId(String(fields.businessId)) : undefined,
      offerId: fields.offerId ? new Types.ObjectId(String(fields.offerId)) : undefined,
      metadata: {},
    });
  }

  /**
   * Spec T5.5: per offer and per day. "views" plans (Free) see impressions and profile views only; "full" plans see
   * every metric, per offer, with CSV export.
   */
  async insights(businessId: string, user: AuthUser, options: { days?: number; offerId?: string }) {
    const business = await this.access.load(businessId, user, 'staff');
    const plan = await this.plans.planFor(business._id);
    const level = plan.flags?.analytics ?? 'views';
    const full = level !== 'views';
    const days = Math.min(365, Math.max(7, options.days ?? 30));
    const since = new Date(Date.now() - days * 24 * 3600_000);
    // Foodbell orders only mean something to businesses that have connected their Foodbell site
    const offered = INSIGHT_METRICS.filter((m) => m.key !== 'foodbellOrders' || business.foodbell);
    const metrics = offered.filter((m) => full || m.basic);
    const events = metrics.flatMap((m) => m.events);
    const match: Record<string, unknown> = { businessId: business._id, createdAt: { $gte: since }, eventName: { $in: events } };
    const offerId = full ? objectId(options.offerId) : undefined;
    if (offerId) match.offerId = offerId;

    const [daily, perOffer, offers, revenue] = await Promise.all([
      this.eventModel.aggregate([
        { $match: match },
        { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Europe/London' } }, event: '$eventName' }, count: { $sum: 1 } } },
      ]),
      full
        ? this.eventModel.aggregate([
            { $match: { ...match, offerId: offerId ?? { $ne: null } } },
            { $group: { _id: { offer: '$offerId', event: '$eventName' }, count: { $sum: 1 } } },
          ])
        : Promise.resolve([]),
      full ? this.offerModel.find({ businessId: business._id }).select('title status displayLabel').lean() : Promise.resolve([]),
      full && business.foodbell
        ? this.eventModel.aggregate([
            { $match: { businessId: business._id, eventName: 'partner_order', createdAt: { $gte: since }, ...(offerId ? { offerId } : {}) } },
            { $group: { _id: null, total: { $sum: '$metadata.total' } } },
          ])
        : Promise.resolve([]),
    ]);

    const dayKeys = Array.from({ length: days }, (_, i) =>
      new Date(Date.now() - (days - 1 - i) * 24 * 3600_000).toLocaleDateString('en-CA', { timeZone: 'Europe/London' }),
    );
    const series = dayKeys.map((day) => {
      const row: Record<string, number | string> = { day };
      for (const m of metrics) row[m.key] = 0;
      return row;
    });
    const rowByDay = new Map(series.map((r) => [r.day as string, r]));
    const totals: Record<string, number> = Object.fromEntries(metrics.map((m) => [m.key, 0]));
    for (const d of daily) {
      const metric = EVENT_TO_METRIC.get(d._id.event);
      if (!metric || !(metric in totals)) continue;
      totals[metric] += d.count;
      const row = rowByDay.get(d._id.day);
      if (row) row[metric] = (row[metric] as number) + d.count;
    }
    const byOffer = new Map<string, Record<string, number>>();
    for (const p of perOffer as { _id: { offer: Types.ObjectId; event: string }; count: number }[]) {
      const metric = EVENT_TO_METRIC.get(p._id.event);
      if (!metric) continue;
      const row = byOffer.get(String(p._id.offer)) ?? Object.fromEntries(metrics.map((m) => [m.key, 0]));
      row[metric] += p.count;
      byOffer.set(String(p._id.offer), row);
    }
    return {
      level,
      planName: plan.name,
      days,
      metrics: metrics.map((m) => ({ key: m.key, label: m.label })),
      lockedMetrics: offered.filter((m) => !metrics.includes(m)).map((m) => ({ key: m.key, label: m.label })),
      totals: { ...totals, followers: business.followerCount ?? 0 },
      // Value of the Foodbell orders above, when the business is connected to Foodbell
      foodbellRevenue: Math.round(((revenue as { total: number }[])[0]?.total ?? 0) * 100) / 100,
      foodbellConnected: business.foodbell?.status === 'connected',
      series,
      offers: (offers as { _id: Types.ObjectId; title: string; status: string; displayLabel: string }[])
        .map((o) => ({ _id: o._id, title: o.title, status: o.status, displayLabel: o.displayLabel, ...(byOffer.get(String(o._id)) ?? Object.fromEntries(metrics.map((m) => [m.key, 0]))) }))
        .sort((a, b) => ((b as unknown as Record<string, number>).impressions ?? 0) - ((a as unknown as Record<string, number>).impressions ?? 0)),
      canExport: full,
    };
  }

  /** "This week" figures for the dashboard home: views, redeem taps, order clicks, calls. */
  async week(businessId: string, user: AuthUser) {
    const business = await this.access.load(businessId, user, 'staff');
    const since = new Date(Date.now() - 7 * 24 * 3600_000);
    const previous = new Date(Date.now() - 14 * 24 * 3600_000);
    const counts = await this.eventModel.aggregate([
      { $match: { businessId: business._id, createdAt: { $gte: previous } } },
      { $group: { _id: { event: '$eventName', thisWeek: { $gte: ['$createdAt', since] } }, count: { $sum: 1 } } },
    ]);
    const sum = (events: string[], thisWeek: boolean) =>
      counts.filter((c) => events.includes(c._id.event) && c._id.thisWeek === thisWeek).reduce((s, c) => s + c.count, 0);
    const figure = (events: string[]) => ({ value: sum(events, true), previous: sum(events, false) });
    return {
      views: figure(['offer_impression', 'business_profile_view', 'offer_detail_view']),
      redeemTaps: figure(['offer_flip', 'redeem_click']),
      orderClicks: figure(['order_click']),
      calls: figure(['call_click']),
    };
  }

  /** Professional: a monthly email report (spec plan table: "Full + monthly email report"). */
  @Cron('0 9 1 * *', { timeZone: 'Europe/London' })
  async monthlyReports() {
    const subs = await this.subscriptions.find({ status: { $in: PLAN_GRANTING_STATUSES }, businessId: { $exists: true } }).select('businessId planKey').lean();
    const end = new Date();
    end.setUTCDate(1);
    end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setUTCMonth(start.getUTCMonth() - 1);
    const month = start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    let sent = 0;
    for (const sub of subs) {
      const plan = await this.plans.byKey(sub.planKey);
      if (plan?.flags?.analytics !== 'full_report') continue;
      const business = await this.businessModel.findOne({ _id: sub.businessId, status: BusinessStatus.ACTIVE }).select('name').lean();
      if (!business) continue;
      const counts = await this.eventModel.aggregate([
        { $match: { businessId: sub.businessId, createdAt: { $gte: start, $lt: end } } },
        { $group: { _id: '$eventName', count: { $sum: 1 } } },
      ]);
      const of = (...events: string[]) => counts.filter((c) => events.includes(c._id)).reduce((s, c) => s + c.count, 0);
      await this.notifications.notifyBusiness(sub.businessId!, {
        type: 'monthly_report',
        title: `Your ${month} report`,
        link: '/dashboard/insights',
        email: {
          template: 'monthly_report',
          vars: {
            businessName: business.name,
            month,
            impressions: of('offer_impression'),
            profileViews: of('business_profile_view'),
            redeemTaps: of('offer_flip', 'redeem_click'),
            orderClicks: of('order_click'),
            calls: of('call_click'),
            link: siteUrl('/dashboard/insights'),
          },
        },
      }, 'owners');
      sent++;
    }
    if (sent) this.logger.log(`Sent ${sent} monthly report(s)`);
    return sent;
  }
}

// High-frequency fire-and-forget events shouldn't consume the API rate budget
@SkipThrottle()
@Controller()
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Public()
  @Post('events')
  track(@Body() dto: TrackEventDto, @Headers('user-agent') userAgent?: string) {
    return this.service.track(dto, userAgent);
  }

  @Public()
  @Post('events/batch')
  trackBatch(@Body('events') events: TrackEventDto[], @Headers('user-agent') userAgent?: string) {
    return this.service.trackBatch(events || [], userAgent);
  }

  @Get('businesses/:businessId/insights')
  async insights(
    @Param('businessId') businessId: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
    @Query('days') days?: string,
    @Query('offerId') offerId?: string,
    @Query('format') format?: string,
  ) {
    const data = await this.service.insights(businessId, user, { days: days ? parseInt(days, 10) : undefined, offerId });
    if (format === 'csv' && data.canExport) {
      const columns = [{ key: 'day', label: 'Day' }, ...data.metrics.map((m) => ({ key: m.key, label: m.label }))];
      return csvResponse(res, `insights-${data.days}d.csv`, toCsv(data.series, columns));
    }
    if (format === 'csv-offers' && data.canExport) {
      const columns = [{ key: 'title', label: 'Offer' }, { key: 'status', label: 'Status' }, ...data.metrics.map((m) => ({ key: m.key, label: m.label }))];
      return csvResponse(res, `offers-${data.days}d.csv`, toCsv(data.offers as unknown as Record<string, unknown>[], columns));
    }
    return data;
  }

  @Get('businesses/:businessId/insights/week')
  week(@Param('businessId') businessId: string, @CurrentUser() user: AuthUser) {
    return this.service.week(businessId, user);
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AnalyticsEvent.name, schema: AnalyticsEventSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Offer.name, schema: OfferSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
    ]),
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
