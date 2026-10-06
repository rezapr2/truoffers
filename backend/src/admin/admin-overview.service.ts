import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  BusinessStatus,
  OfferStatus,
  PaymentStatus,
  PromotionStatus,
  PUBLIC_OFFER_STATUSES,
  ReportStatus,
  STAFF_ROLES,
  SubscriptionStatus,
  VerificationLevel,
} from '../common/enums';
import { ClaimsAdminService } from '../claims/claims-admin.service';
import { AnalyticsEvent, AnalyticsEventDocument } from '../schemas/analytics-event.schema';
import { Business, BusinessDocument } from '../schemas/business.schema';
import { Offer, OfferDocument } from '../schemas/offer.schema';
import { Payment, PaymentDocument } from '../schemas/payment.schema';
import { Promotion, PromotionDocument } from '../schemas/promotion.schema';
import { ReportCase, ReportCaseDocument } from '../schemas/report.schema';
import { Subscription, SubscriptionDocument } from '../schemas/subscription.schema';
import { User, UserDocument } from '../schemas/user.schema';

const DAY = 24 * 3600_000;

/** The admin overview (spec: existing KPIs plus queue ages, sign-ups, MRR, failed payments, live promotions). */
@Injectable()
export class AdminOverviewService {
  constructor(
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Offer.name) private readonly offers: Model<OfferDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Subscription.name) private readonly subscriptions: Model<SubscriptionDocument>,
    @InjectModel(Payment.name) private readonly payments: Model<PaymentDocument>,
    @InjectModel(Promotion.name) private readonly promotions: Model<PromotionDocument>,
    @InjectModel(ReportCase.name) private readonly reportCases: Model<ReportCaseDocument>,
    @InjectModel(AnalyticsEvent.name) private readonly events: Model<AnalyticsEventDocument>,
    private readonly claims: ClaimsAdminService,
  ) {}

  async overview() {
    const now = Date.now();
    const since30 = new Date(now - 30 * DAY);
    const since7 = new Date(now - 7 * DAY);
    const [
      listed,
      claimed,
      verified,
      liveOffers,
      offersWaiting,
      oldestOffer,
      users,
      signups7d,
      activeSubs,
      pastDue,
      failedPayments30d,
      promotionsLive,
      reportsOpen,
      suspensionReviews,
      searches30d,
      orderClicks30d,
      claimStats,
      topSearchAreas,
      signupsByDay,
    ] = await Promise.all([
      this.businesses.countDocuments({ status: BusinessStatus.ACTIVE }),
      this.businesses.countDocuments({ status: BusinessStatus.ACTIVE, verificationLevel: { $gte: VerificationLevel.CLAIM_PENDING } }),
      this.businesses.countDocuments({ status: BusinessStatus.ACTIVE, verificationLevel: { $gte: VerificationLevel.VERIFIED } }),
      this.offers.countDocuments({ status: { $in: PUBLIC_OFFER_STATUSES } }),
      this.offers.countDocuments({ status: OfferStatus.PENDING }),
      this.offers.findOne({ status: OfferStatus.PENDING }).sort({ updatedAt: 1 }).select('updatedAt').lean(),
      this.users.countDocuments({ status: { $ne: 'deleted' }, role: { $nin: STAFF_ROLES } }),
      this.users.countDocuments({ createdAt: { $gte: since7 }, role: { $nin: STAFF_ROLES } }),
      this.subscriptions.find({ status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] }, comp: { $ne: true }, price: { $gt: 0 } }).select('price interval status').lean(),
      this.subscriptions.countDocuments({ status: SubscriptionStatus.PAST_DUE }),
      this.payments.countDocuments({ status: PaymentStatus.FAILED, createdAt: { $gte: since30 } }),
      this.promotions.countDocuments({ status: PromotionStatus.ACTIVE, productKey: { $exists: true } }),
      this.reportCases.countDocuments({ status: { $in: [ReportStatus.OPEN, ReportStatus.INFO_REQUESTED] } }),
      this.businesses.countDocuments({ 'suspensionReview.flaggedAt': { $exists: true }, 'suspensionReview.resolvedAt': { $exists: false } }),
      this.events.countDocuments({ eventName: 'postcode_search', createdAt: { $gte: since30 } }),
      this.events.countDocuments({ eventName: 'order_click', createdAt: { $gte: since30 } }),
      this.claims.queueStats(),
      this.events.aggregate([
        { $match: { eventName: 'postcode_search', createdAt: { $gte: since30 } } },
        { $group: { _id: '$postcodeArea', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      this.users.aggregate([
        { $match: { createdAt: { $gte: since30 }, role: { $nin: STAFF_ROLES } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);
    const paying = activeSubs.filter((s) => s.status === SubscriptionStatus.ACTIVE);
    const mrr = paying.reduce((sum, s) => sum + (s.interval === 'annual' ? s.price / 12 : s.price), 0);
    return {
      supply: { listed, claimed, verified, liveOffers, claimedRate: listed ? Math.round((claimed / listed) * 100) : 0 },
      queues: {
        claimsWaiting: claimStats.waiting,
        oldestClaimAgeHours: claimStats.oldestAgeHours,
        claimsInfoRequested: claimStats.infoRequested,
        pendingProfileChanges: claimStats.pendingChanges,
        offersWaiting,
        oldestOfferAgeHours: oldestOffer ? Math.round((now - new Date((oldestOffer as unknown as { updatedAt: Date }).updatedAt).getTime()) / 3600_000) : null,
        reportsOpen,
        suspensionReviews,
      },
      demand: { users, signups7d, searches30d, orderClicks30d, topSearchAreas, signupsByDay },
      revenue: {
        paidAccounts: paying.length,
        mrr: Math.round(mrr * 100) / 100,
        arpa: paying.length ? Math.round((mrr / paying.length) * 100) / 100 : 0,
        pastDue,
        failedPayments30d,
        promotionsLive,
      },
    };
  }
}
