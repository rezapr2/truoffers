import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BusinessStatus, OfferRejectReason, OfferStatus, PLAN_GRANTING_STATUSES } from '../common/enums';
import { escapeRegex } from '../businesses/businesses.service';
import { offerSlug, withImportNotice } from '../common/public-offer';
import { OfferOrigin } from '../common/scraper.enums';
import { fingerprintOfPublishedOffer } from '../scraper/lifecycle/offer-mapping';
import { AuditService } from '../scraper/audit/audit.service';
import { siteUrl } from '../platform/email.service';
import { NotificationsService } from '../platform/notifications.service';
import { Business, BusinessDocument } from '../schemas/business.schema';
import { Offer, OfferDocument } from '../schemas/offer.schema';
import { Subscription, SubscriptionDocument } from '../schemas/subscription.schema';
import { AdminOfferEditDto, AdminOfferQuery } from './offers.dto';
import { MODERATION_FLAG_LABELS, OfferPublishingService } from './offer-publishing.service';
import { DUPLICATE_OFFER_MESSAGE, defaultLabel, isDuplicateOffer, offerEnd, offerStart } from './offers.service';

export const OFFER_REJECT_LABELS: Record<OfferRejectReason, string> = {
  misleading: 'The offer is misleading or unclear',
  banned_content: 'The offer contains content we do not allow',
  link_mismatch: "The link does not go to the business's own ordering page",
  discount_too_high: 'The discount looks too high to be genuine',
  duplicate: 'The same offer is already listed',
  other: 'It does not meet our offer rules',
};

const PAGE_SIZE = 50;

/** Spec "Offer moderation": every offer, filters, edit before approve, reject with reason, pause, feature, expiry. */
@Injectable()
export class OffersAdminService {
  constructor(
    @InjectModel(Offer.name) private readonly offers: Model<OfferDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Subscription.name) private readonly subscriptions: Model<SubscriptionDocument>,
    private readonly publishing: OfferPublishingService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  private async filter(query: AdminOfferQuery) {
    const filter: Record<string, unknown> = {};
    if (query.status === 'queue' || !query.status) filter.status = OfferStatus.PENDING;
    else if (query.status !== 'all') filter.status = { $in: query.status.split(',') };
    if (query.source) filter.origin = query.source === 'scraper' ? OfferOrigin.SCRAPER : { $ne: OfferOrigin.SCRAPER };
    if (query.q) filter.title = new RegExp(escapeRegex(query.q), 'i');
    const businessFilter: Record<string, unknown> = {};
    if (query.businessId && Types.ObjectId.isValid(query.businessId)) businessFilter._id = new Types.ObjectId(query.businessId);
    if (query.city) businessFilter.town = new RegExp(`^${escapeRegex(query.city)}$`, 'i');
    if (query.plan) {
      const subs = await this.subscriptions.find({ planKey: query.plan, status: { $in: PLAN_GRANTING_STATUSES } }).select('businessId').lean();
      const ids = subs.map((s) => s.businessId).filter(Boolean);
      if (query.plan === 'free') {
        const paid = await this.subscriptions.find({ status: { $in: PLAN_GRANTING_STATUSES } }).distinct('businessId');
        businessFilter._id = { ...(businessFilter._id ? { $eq: businessFilter._id } : {}), $nin: paid };
      } else businessFilter._id = { ...(businessFilter._id ? { $eq: businessFilter._id } : {}), $in: ids };
    }
    if (Object.keys(businessFilter).length) {
      filter.businessId = { $in: await this.businesses.find(businessFilter).distinct('_id') };
    }
    return filter;
  }

  async list(query: AdminOfferQuery, limit = PAGE_SIZE) {
    const filter = await this.filter(query);
    const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
    const [items, total, statusCounts] = await Promise.all([
      this.offers
        .find(filter)
        .select('-evidence -dedupeKey -contentFingerprint')
        // The queue is oldest first (SLA); everything else newest first.
        .sort(filter.status === OfferStatus.PENDING ? { updatedAt: 1 } : { updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('businessId', 'name slug town postcode verificationLevel website orderUrl status')
        .populate('approvedBy', 'name email')
        .lean(),
      this.offers.countDocuments(filter),
      this.offers.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);
    return {
      items: items.map((o) => ({
        ...withImportNotice(o),
        flagLabels: (o.moderationFlags ?? []).map((f) => MODERATION_FLAG_LABELS[f.split(':')[0]] + (f.includes(':') ? ` (“${f.split(':')[1]}”)` : '')),
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
      statusCounts: Object.fromEntries(statusCounts.map((c) => [c._id, c.count])),
    };
  }

  async get(id: string) {
    const offer = Types.ObjectId.isValid(id)
      ? await this.offers.findById(id).populate('businessId', 'name slug town postcode verificationLevel website orderUrl phone status').lean()
      : null;
    if (!offer) throw new NotFoundException('Offer not found');
    const history = await this.audit.trail('Offer', id, 30);
    return { offer: withImportNotice(offer), history };
  }

  private async load(id: string) {
    const offer = Types.ObjectId.isValid(id) ? await this.offers.findById(id) : null;
    if (!offer) throw new NotFoundException('Offer not found');
    return offer;
  }

  private async businessOf(offer: OfferDocument) {
    const business = await this.businesses.findById(offer.businessId);
    if (!business) throw new NotFoundException('Business not found');
    return business;
  }

  /** Approve: live, or scheduled when it starts later. Admins can edit in the same step. */
  async approve(id: string, reviewerId: string, edits?: AdminOfferEditDto) {
    const offer = await this.load(id);
    if (edits) this.applyEdits(offer, edits);
    if ([OfferStatus.REMOVED].includes(offer.status)) throw new BadRequestException('This offer was removed');
    if (offer.endsAt && offer.endsAt < new Date()) throw new BadRequestException('This offer has already ended. Change its end date first.');
    const business = await this.businessOf(offer);
    if (business.status !== BusinessStatus.ACTIVE) throw new BadRequestException(`The business is ${business.status}; offers can't go live`);
    const previous = offer.status;
    offer.set({
      status: this.publishing.liveStatus(offer),
      approvedBy: new Types.ObjectId(reviewerId),
      approvedAt: new Date(),
      moderationNote: undefined,
      rejectReasonCode: undefined,
      submitWhenVerified: false,
    });
    await offer.save().catch((err) => {
      throw isDuplicateOffer(err) ? new ConflictException(DUPLICATE_OFFER_MESSAGE) : err;
    });
    await this.publishing.afterStatusChange(offer, previous);
    await this.audit.record({ action: 'offer.approved', targetType: 'Offer', targetId: offer._id, before: { status: previous }, after: { status: offer.status, edited: !!edits } });
    if (offer.origin !== OfferOrigin.SCRAPER) {
      await this.notifications.notifyBusiness(business._id, {
        type: 'offer_approved',
        title: `“${offer.title}” is approved`,
        body: offer.status === OfferStatus.SCHEDULED ? 'It goes live at its start time.' : 'It is live now.',
        link: '/dashboard/offers',
        email: { template: 'offer_approved', vars: { businessName: business.name, offerTitle: offer.title, link: siteUrl(`/offer/${offer._id}-${offerSlug(offer.title, business.name)}`) } },
      });
    }
    return offer;
  }

  async reject(id: string, reasonCode: OfferRejectReason, note: string) {
    const offer = await this.load(id);
    if (offer.origin === OfferOrigin.SCRAPER) throw new BadRequestException('Imported offers are reviewed in the import robot');
    if ([OfferStatus.REMOVED, OfferStatus.EXPIRED].includes(offer.status)) throw new BadRequestException(`This offer is ${offer.status}`);
    const previous = offer.status;
    offer.set({ status: OfferStatus.REJECTED, rejectReasonCode: reasonCode, moderationNote: note, submitWhenVerified: false });
    await offer.save();
    await this.publishing.afterStatusChange(offer, previous);
    await this.audit.record({ action: 'offer.rejected', targetType: 'Offer', targetId: offer._id, before: { status: previous }, after: { status: offer.status, reasonCode, note } });
    const business = await this.businessOf(offer);
    await this.notifications.notifyBusiness(business._id, {
      type: 'offer_rejected',
      title: `“${offer.title}” needs changes`,
      body: `${OFFER_REJECT_LABELS[reasonCode]}. ${note}`,
      link: '/dashboard/offers?tab=rejected',
      email: { template: 'offer_rejected', vars: { businessName: business.name, offerTitle: offer.title, reason: `${OFFER_REJECT_LABELS[reasonCode]}. ${note}` } },
    });
    return offer;
  }

  async pause(id: string) {
    const offer = await this.load(id);
    if (![OfferStatus.ACTIVE, OfferStatus.SCHEDULED, OfferStatus.REVISION_PENDING].includes(offer.status)) {
      throw new BadRequestException('Only live or scheduled offers can be paused');
    }
    const previous = offer.status;
    offer.status = OfferStatus.PAUSED;
    await offer.save();
    await this.publishing.afterStatusChange(offer, previous);
    await this.audit.record({ action: 'offer.paused_by_admin', targetType: 'Offer', targetId: offer._id, before: { status: previous }, after: { status: offer.status } });
    return offer;
  }

  async feature(id: string, featured: boolean) {
    const offer = await this.load(id);
    const before = offer.featured;
    offer.featured = featured;
    await offer.save();
    await this.audit.record({ action: 'offer.featured', targetType: 'Offer', targetId: offer._id, before: { featured: before }, after: { featured } });
    return offer;
  }

  async setExpiry(id: string, endsAt?: string) {
    const offer = await this.load(id);
    const before = offer.endsAt;
    const next = endsAt ? offerEnd(endsAt) : undefined;
    if (next && Number.isNaN(next.getTime())) throw new BadRequestException('That is not a date');
    offer.set({ endsAt: next, expiryWarnedAt: undefined });
    if (next && next < new Date() && [OfferStatus.ACTIVE, OfferStatus.SCHEDULED, OfferStatus.PAUSED].includes(offer.status)) {
      offer.set({ status: OfferStatus.EXPIRED, expiredAt: new Date() });
    }
    offer.contentFingerprint = fingerprintOfPublishedOffer(offer);
    await offer.save();
    await this.publishing.afterStatusChange(offer, undefined);
    await this.audit.record({ action: 'offer.expiry_set', targetType: 'Offer', targetId: offer._id, before: { endsAt: before }, after: { endsAt: next } });
    return offer;
  }

  /** "Edit before approve", or an admin correcting any offer. The status doesn't change. */
  async edit(id: string, dto: AdminOfferEditDto, reviewerId: string) {
    if (dto.approve) return this.approve(id, reviewerId, dto);
    const offer = await this.load(id);
    const before = offer.toObject();
    this.applyEdits(offer, dto);
    await offer.save().catch((err) => {
      throw isDuplicateOffer(err) ? new ConflictException(DUPLICATE_OFFER_MESSAGE) : err;
    });
    await this.audit.record({
      action: 'offer.edited_by_admin',
      targetType: 'Offer',
      targetId: offer._id,
      before: { title: before.title, terms: before.terms, displayLabel: before.displayLabel, redemptionUrl: before.redemptionUrl },
      after: { title: offer.title, terms: offer.terms, displayLabel: offer.displayLabel, redemptionUrl: offer.redemptionUrl },
    });
    return offer;
  }

  private applyEdits(offer: OfferDocument, dto: AdminOfferEditDto) {
    const { approve: _approve, submit: _submit, startsAt, endsAt, ...fields } = dto;
    const content = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    offer.set(content);
    if (startsAt !== undefined) offer.startsAt = offerStart(startsAt);
    if (endsAt !== undefined) offer.endsAt = offerEnd(endsAt);
    if (!offer.displayLabel) offer.displayLabel = defaultLabel(offer);
    offer.contentFingerprint = fingerprintOfPublishedOffer(offer);
  }
}
