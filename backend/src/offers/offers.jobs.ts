import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ActorContext } from '../common/actor-context';
import { OfferStatus, PUBLIC_OFFER_STATUSES } from '../common/enums';
import { ActorKind } from '../common/scraper.enums';
import { SCHEDULER_COMPONENT } from '../schemas/offer-lifecycle.guard';
import { Business, BusinessDocument } from '../schemas/business.schema';
import { Offer, OfferDocument } from '../schemas/offer.schema';
import { NotificationsService } from '../platform/notifications.service';
import { siteUrl } from '../platform/email.service';
import { OfferPublishingService } from './offer-publishing.service';

const WARN_DAYS = 2;

/** Spec T3.4: scheduled → live and live → expired every 5 minutes; owners warned 2 days before an offer ends. */
@Injectable()
export class OffersJobs {
  private readonly logger = new Logger(OffersJobs.name);

  constructor(
    @InjectModel(Offer.name) private readonly offers: Model<OfferDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    private readonly publishing: OfferPublishingService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run() {
    await this.publishScheduled();
    await this.expireEnded();
  }

  async publishScheduled() {
    const now = new Date();
    const due = await this.offers
      .find({ status: OfferStatus.SCHEDULED, startsAt: { $lte: now } })
      .select('_id businessId title publishedAt endsAt')
      .lean();
    let published = 0;
    for (const offer of due) {
      if (offer.endsAt && offer.endsAt < now) continue; // expireEnded handles it
      const result = await ActorContext.run({ kind: ActorKind.SYSTEM, component: SCHEDULER_COMPONENT }, () =>
        this.offers.updateOne({ _id: offer._id, status: OfferStatus.SCHEDULED }, { $set: { status: OfferStatus.ACTIVE } }),
      );
      if (result.modifiedCount) {
        published++;
        const doc = await this.offers.findById(offer._id);
        if (doc) await ActorContext.run({ kind: ActorKind.SYSTEM, component: SCHEDULER_COMPONENT }, () => this.publishing.afterStatusChange(doc, OfferStatus.SCHEDULED));
      }
    }
    if (published) this.logger.log(`Published ${published} scheduled offer(s)`);
    return published;
  }

  async expireEnded() {
    const now = new Date();
    const ending = await this.offers
      .find({
        // Published offers, scheduled and paused ones past their end, and imported ones hidden while a recheck runs.
        status: { $in: [...PUBLIC_OFFER_STATUSES, OfferStatus.SCHEDULED, OfferStatus.PAUSED, OfferStatus.POSSIBLY_REMOVED] },
        endsAt: { $ne: null, $lt: now },
      })
      .distinct('businessId');
    if (!ending.length) return 0;
    const result = await this.offers.updateMany(
      {
        status: { $in: [...PUBLIC_OFFER_STATUSES, OfferStatus.SCHEDULED, OfferStatus.PAUSED, OfferStatus.POSSIBLY_REMOVED] },
        endsAt: { $ne: null, $lt: now },
      },
      // expiredAt starts the retention clock for imported offers' stored excerpts.
      { $set: { status: OfferStatus.EXPIRED, expiredAt: now } },
    );
    if (result.modifiedCount > 0) {
      this.logger.log(`Expired ${result.modifiedCount} offer(s)`);
      for (const businessId of ending) {
        const count = await this.offers.countDocuments({ businessId, status: { $in: PUBLIC_OFFER_STATUSES } });
        await this.businesses.updateOne({ _id: businessId }, { $set: { activeOfferCount: count } });
      }
    }
    return result.modifiedCount;
  }

  @Cron('0 9 * * *', { timeZone: 'Europe/London' })
  async warnExpiring() {
    const now = new Date();
    const soon = new Date(now.getTime() + WARN_DAYS * 24 * 3600_000);
    const offers = await this.offers
      .find({ status: { $in: [OfferStatus.ACTIVE, OfferStatus.SCHEDULED] }, endsAt: { $gt: now, $lte: soon }, expiryWarnedAt: { $exists: false } })
      .select('_id businessId title endsAt')
      .lean();
    for (const offer of offers) {
      const business = await this.businesses.findById(offer.businessId).select('name').lean();
      if (!business) continue;
      const endsOn = offer.endsAt!.toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long' });
      await this.notifications.notifyBusiness(offer.businessId, {
        type: 'offer_expiring',
        title: `“${offer.title}” ends ${endsOn}`,
        body: 'Extend it or post a new offer to stay visible.',
        link: '/dashboard/offers',
        email: { template: 'offer_expiring', vars: { businessName: business.name, offerTitle: offer.title, endsOn, link: siteUrl('/dashboard/offers') } },
      });
      await this.offers.updateOne({ _id: offer._id }, { $set: { expiryWarnedAt: now } });
    }
    if (offers.length) this.logger.log(`Sent ${offers.length} expiry warning(s)`);
    return offers.length;
  }
}
