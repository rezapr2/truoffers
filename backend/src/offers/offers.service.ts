import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Offer, OfferDocument } from '../schemas/offer.schema';
import { Business, BusinessDocument } from '../schemas/business.schema';
import { Redemption, RedemptionDocument } from '../schemas/redemption.schema';
import { BusinessStatus, DiscountType, OfferStatus, PUBLIC_OFFER_STATUSES, RedemptionType } from '../common/enums';
import { AuthUser } from '../common/decorators';
import { ActorContext } from '../common/actor-context';
import { BusinessAccessService } from '../common/business-access';
import { recountActiveOffers } from '../common/offer-counts';
import { offerSlug, PUBLIC_OFFER_PROJECTION, withImportNotice } from '../common/public-offer';
import { normaliseUrl } from '../common/order-link';
import { OfferOrigin } from '../common/scraper.enums';
import { isIsoDate, londonEndOfDay, londonStartOfDay } from '../scraper/extraction/london-time';
import { fingerprintOfPublishedOffer } from '../scraper/lifecycle/offer-mapping';
import { removeAsMerchant, takeOverAsMerchant } from '../scraper/lifecycle/merchant-management';
import { AuditService } from '../scraper/audit/audit.service';
import { PlanLean, PlansService } from '../plans/plans.service';
import { CreateOfferDto, RedeemOfferDto, UpdateOfferDto } from './offers.dto';
import { OfferPublishingService } from './offer-publishing.service';

// An identical offer (same business and content fingerprint) can only be live once.
export function isDuplicateOffer(err: unknown): boolean {
  return (err as { code?: number; keyPattern?: Record<string, unknown> }).code === 11000 &&
    'dedupeKey' in ((err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {});
}

export const DUPLICATE_OFFER_MESSAGE = 'An identical offer is already live for this business';

// A bare calendar day means the whole day in the UK: starts at 00:00 and ends at 23:59:59 London time.
export function offerStart(value?: string): Date | undefined {
  if (!value) return undefined;
  return isIsoDate(value) ? londonStartOfDay(value) : new Date(value);
}
export function offerEnd(value?: string): Date | undefined {
  if (!value) return undefined;
  return isIsoDate(value) ? londonEndOfDay(value) : new Date(value);
}

export function defaultLabel(dto: Pick<CreateOfferDto, 'discountType' | 'value'>): string {
  switch (dto.discountType) {
    case DiscountType.PERCENT:
      return `${dto.value ?? 0}% off`;
    case DiscountType.FIXED:
      return `£${dto.value ?? 0} off`;
    case DiscountType.BOGOF:
      return '2 for 1';
    case DiscountType.FREE_ITEM:
      return 'Freebie';
    case DiscountType.MEAL_DEAL:
      return dto.value ? `Deal £${dto.value}` : 'Meal deal';
    case DiscountType.FREE_DELIVERY:
      return 'Free delivery';
    default:
      return 'Special offer';
  }
}

// The business fields public offer cards show.
export const OFFER_CARD_BUSINESS_FIELDS =
  'name slug town postcode postcodeArea verificationLevel isFoodbellClient reviews logoUrl orderUrl phone website status categories';

// Owners edit content; statuses move only through the actions below.
const CONTENT_FIELDS = [
  'title', 'description', 'discountType', 'value', 'displayLabel', 'minOrder', 'redemptionType', 'code', 'redemptionUrl',
  'terms', 'imageUrl', 'collection', 'delivery', 'newCustomersOnly', 'eligibleWeekdays', 'dailyStartTime', 'dailyEndTime',
  'maxRedemptions',
] as const;

const TAB_STATUSES: Record<string, OfferStatus[]> = {
  live: [OfferStatus.ACTIVE, OfferStatus.REVISION_PENDING],
  scheduled: [OfferStatus.SCHEDULED],
  pending: [OfferStatus.PENDING],
  paused: [OfferStatus.PAUSED],
  expired: [OfferStatus.EXPIRED],
  rejected: [OfferStatus.REJECTED],
  draft: [OfferStatus.DRAFT],
  hidden: [OfferStatus.HIDDEN_BY_REPORTS, OfferStatus.REMOVED, OfferStatus.POSSIBLY_REMOVED, OfferStatus.EXPIRY_REVIEW],
};

@Injectable()
export class OffersService {
  constructor(
    @InjectModel(Offer.name) private offerModel: Model<OfferDocument>,
    @InjectModel(Business.name) private businessModel: Model<BusinessDocument>,
    @InjectModel(Redemption.name) private redemptionModel: Model<RedemptionDocument>,
    private readonly access: BusinessAccessService,
    private readonly plans: PlansService,
    private readonly publishing: OfferPublishingService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------------------------------
  // Public
  // -------------------------------------------------------------------------------------------------

  async listPublic(params: { businessId?: string; limit?: number }) {
    const now = new Date();
    const activeBusinesses = await this.businessModel.distinct('_id', { status: BusinessStatus.ACTIVE });
    const filter: Record<string, unknown> = {
      status: { $in: PUBLIC_OFFER_STATUSES },
      businessId: { $in: activeBusinesses },
      $or: [{ endsAt: null }, { endsAt: { $gte: now } }],
    };
    if (params.businessId) {
      if (!Types.ObjectId.isValid(params.businessId)) return [];
      filter.businessId = new Types.ObjectId(params.businessId);
    }
    const offers = await this.offerModel
      .find(filter)
      .select(PUBLIC_OFFER_PROJECTION)
      .sort({ featured: -1, createdAt: -1 })
      .limit(Math.min(100, params.limit || 24))
      .populate({ path: 'businessId', select: OFFER_CARD_BUSINESS_FIELDS, populate: { path: 'categories', select: 'name slug emoji' } })
      .lean();
    return offers.map((o) => this.publicShape(o));
  }

  publicShape<T extends { _id: Types.ObjectId; title: string; businessId?: unknown }>(offer: T) {
    const business = offer.businessId as { name?: string } | undefined;
    return { ...offer, slug: offerSlug(offer.title, business?.name) };
  }

  /** Accepts "{id}" or the shareable "{id}-{slug}". Unpublished offers and hidden listings don't load. */
  async getPublic(idOrSlug: string) {
    const id = idOrSlug.slice(0, 24);
    const offer = Types.ObjectId.isValid(id)
      ? await this.offerModel
          .findOne({ _id: id, status: { $in: PUBLIC_OFFER_STATUSES } })
          .select(PUBLIC_OFFER_PROJECTION)
          .populate({ path: 'businessId', select: `${OFFER_CARD_BUSINESS_FIELDS} address`, populate: { path: 'categories', select: 'name slug emoji' } })
          .lean()
      : null;
    const business = offer?.businessId as unknown as { status?: BusinessStatus } | null | undefined;
    if (!offer || business?.status !== BusinessStatus.ACTIVE) return this.checkingAvailability(id);
    return this.publicShape(offer);
  }

  /**
   * Spec §9: an imported offer a recheck could not find is hidden at once, and its link says it is being
   * checked rather than 404ing. Nothing of the offer itself is shown while that is going on.
   */
  private async checkingAvailability(id: string): Promise<{ _id: Types.ObjectId; availability: 'checking'; business: unknown }> {
    const offer = Types.ObjectId.isValid(id)
      ? await this.offerModel
          .findOne({ _id: id, status: OfferStatus.POSSIBLY_REMOVED, origin: OfferOrigin.SCRAPER })
          .select('_id businessId')
          .populate('businessId', 'name slug town status')
          .lean()
      : null;
    const business = offer?.businessId as unknown as { status?: BusinessStatus } | undefined;
    if (!offer || business?.status !== BusinessStatus.ACTIVE) throw new NotFoundException('Offer not found');
    return { _id: offer._id, availability: 'checking', business: offer.businessId };
  }

  // Redemption per blueprint section 9
  async redeem(offerId: string, dto: RedeemOfferDto, userId?: string) {
    const offer = Types.ObjectId.isValid(offerId) ? await this.offerModel.findById(offerId) : null;
    if (!offer || !PUBLIC_OFFER_STATUSES.includes(offer.status)) {
      throw new NotFoundException('Offer not available');
    }
    if (offer.endsAt && offer.endsAt < new Date()) {
      throw new BadRequestException('Offer has expired');
    }
    if (offer.maxRedemptions > 0 && offer.redemptionCount >= offer.maxRedemptions) {
      throw new BadRequestException('Offer fully redeemed');
    }
    // Fraud control: one redemption per user/session per offer
    const dupFilter: Record<string, unknown> = { offerId: offer._id };
    if (userId) dupFilter.customerId = new Types.ObjectId(userId);
    else if (dto.sessionId) dupFilter.sessionId = dto.sessionId;
    if (userId || dto.sessionId) {
      const dup = await this.redemptionModel.findOne(dupFilter);
      if (dup) return this.redemptionResponse(offer, true);
    }

    await this.redemptionModel.create({
      offerId: offer._id,
      businessId: offer.businessId,
      customerId: userId ? new Types.ObjectId(userId) : undefined,
      sessionId: dto.sessionId,
      code: offer.code,
      channel: dto.channel || 'code_copy',
    });
    offer.redemptionCount += 1;
    if (offer.maxRedemptions > 0 && offer.redemptionCount >= offer.maxRedemptions) {
      offer.status = OfferStatus.EXPIRED; // usage cap reached
      offer.expiredAt = new Date();
    }
    await offer.save();
    if (offer.status === OfferStatus.EXPIRED) await recountActiveOffers(this.offerModel, this.businessModel, offer.businessId);
    return this.redemptionResponse(offer, false);
  }

  private redemptionResponse(offer: OfferDocument, alreadyRedeemed: boolean) {
    return {
      offerId: offer.id,
      redemptionType: offer.redemptionType,
      code: offer.code,
      redemptionUrl: offer.redemptionUrl,
      terms: offer.terms,
      alreadyRedeemed,
    };
  }

  // -------------------------------------------------------------------------------------------------
  // The business's offers (spec "My offers")
  // -------------------------------------------------------------------------------------------------

  async listForBusiness(businessId: string, user: AuthUser, tab?: string) {
    const business = await this.access.load(businessId, user, 'staff');
    const base = { businessId: business._id, status: { $ne: OfferStatus.REMOVED } } as Record<string, unknown>;
    const counts = await this.offerModel.aggregate([
      { $match: { businessId: business._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const byStatus = new Map(counts.map((c) => [c._id as string, c.count as number]));
    const tabCounts = Object.fromEntries(
      Object.entries(TAB_STATUSES).map(([name, statuses]) => [name, statuses.reduce((sum, s) => sum + (byStatus.get(s) ?? 0), 0)]),
    );
    const filter = tab && TAB_STATUSES[tab] ? { businessId: business._id, status: { $in: TAB_STATUSES[tab] } } : base;
    const offers = await this.offerModel
      .find(filter)
      .select('-evidence -dedupeKey -contentFingerprint -adapterId -adapterVersion -offerTypeRaw -sources')
      .sort({ updatedAt: -1 })
      .lean();
    return { offers: offers.map(withImportNotice), counts: tabCounts };
  }

  async getForBusiness(offerId: string, user: AuthUser) {
    const offer = Types.ObjectId.isValid(offerId)
      ? await this.offerModel.findById(offerId).select('-evidence -dedupeKey -contentFingerprint -adapterId -adapterVersion -offerTypeRaw').lean()
      : null;
    if (!offer) throw new NotFoundException('Offer not found');
    await this.access.load(String(offer.businessId), user, 'staff');
    return withImportNotice(offer);
  }

  /** Plan gates in the offer editor (spec plan table: scheduled offers and coupon codes are Standard and up). */
  private assertPlanFeatures(plan: PlanLean, dto: Partial<CreateOfferDto>, startsAt?: Date) {
    if (startsAt && startsAt.getTime() > Date.now() + 60_000 && !plan.flags?.scheduledOffers) {
      throw new ForbiddenException({ message: `Scheduling an offer for later is not on the ${plan.name} plan. Upgrade, or start it today.`, code: 'plan_feature', feature: 'scheduledOffers' });
    }
    if (dto.redemptionType === RedemptionType.CODE && !plan.flags?.couponCodes) {
      throw new ForbiddenException({ message: `Coupon codes are not on the ${plan.name} plan. Upgrade, or choose another way to redeem.`, code: 'plan_feature', feature: 'couponCodes' });
    }
  }

  private contentFrom(dto: Partial<CreateOfferDto>) {
    const fields: Record<string, unknown> = {};
    for (const field of CONTENT_FIELDS) {
      if (dto[field] !== undefined) fields[field] = dto[field];
    }
    if (dto.redemptionType && dto.redemptionType !== RedemptionType.CODE) fields.code = undefined;
    if (typeof fields.code === 'string') fields.code = (fields.code as string).trim().toUpperCase() || undefined;
    if (typeof fields.redemptionUrl === 'string') {
      const raw = (fields.redemptionUrl as string).trim();
      if (raw) {
        const url = normaliseUrl(raw);
        if (!url) throw new BadRequestException('The offer link is not a valid web address');
        fields.redemptionUrl = url;
      } else fields.redemptionUrl = undefined;
    }
    if (fields.imageUrl === '') fields.imageUrl = undefined;
    if (fields.eligibleWeekdays && (fields.eligibleWeekdays as string[]).length === 0) fields.eligibleWeekdays = undefined;
    return fields;
  }

  private validateSchedule(startsAt?: Date, endsAt?: Date, dto?: Partial<CreateOfferDto>) {
    if (startsAt && endsAt && endsAt <= startsAt) throw new BadRequestException('The end date must be after the start date');
    if (endsAt && endsAt.getTime() < Date.now()) throw new BadRequestException('The end date is in the past');
    if (dto?.redemptionType === RedemptionType.CODE && !dto.code?.trim()) throw new BadRequestException('Enter the coupon code customers should use');
    if (dto?.redemptionType === RedemptionType.DIRECT_LINK && !dto.redemptionUrl?.trim()) {
      // The business's own order link is used when the offer has none.
    }
    if ((dto?.dailyStartTime && !dto.dailyEndTime) || (!dto?.dailyStartTime && dto?.dailyEndTime)) {
      throw new BadRequestException('Set both the start and end of the time window');
    }
  }

  async create(businessId: string, dto: CreateOfferDto, user: AuthUser) {
    const business = await this.access.load(businessId, user, 'staff', { write: true });
    const plan = await this.plans.planFor(business._id);
    const startsAt = offerStart(dto.startsAt);
    const endsAt = offerEnd(dto.endsAt);
    this.validateSchedule(startsAt, endsAt, dto);
    this.assertPlanFeatures(plan, dto, startsAt);
    const content = this.contentFrom(dto);
    content.displayLabel = (dto.displayLabel?.trim() || defaultLabel(dto)).slice(0, 20);

    let status = OfferStatus.DRAFT;
    let flags: string[] = [];
    let submitWhenVerified = false;
    if (dto.submit) {
      await this.publishing.assertWithinLimit(business, plan);
      const decision = await this.publishing.decide(business, { ...(content as unknown as Offer), startsAt }, plan);
      status = decision.status;
      flags = decision.flags;
      submitWhenVerified = decision.status === OfferStatus.DRAFT;
    }

    const offer = await this.offerModel
      .create({
        ...content,
        businessId: business._id,
        startsAt,
        endsAt,
        status,
        moderationFlags: flags.length ? flags : undefined,
        submitWhenVerified,
        // Fingerprinted like imported offers, so a later scrape of the same offer is never duplicated.
        contentFingerprint: fingerprintOfPublishedOffer({
          title: dto.title,
          discountType: dto.discountType,
          value: dto.value ?? 0,
          code: content.code as string | undefined,
          minOrder: dto.minOrder ?? 0,
          endsAt,
        }),
      })
      .catch((err) => {
        throw isDuplicateOffer(err) ? new ConflictException(DUPLICATE_OFFER_MESSAGE) : err;
      });
    await this.publishing.afterStatusChange(offer, undefined);
    await this.audit.record({ action: 'offer.created', targetType: 'Offer', targetId: offer._id, after: { title: offer.title, status, business: String(business._id), flags } });
    return { offer, decision: { status, flags, submitWhenVerified } };
  }

  private async loadManaged(offerId: string, user: AuthUser) {
    const offer = Types.ObjectId.isValid(offerId) ? await this.offerModel.findById(offerId) : null;
    if (!offer) throw new NotFoundException('Offer not found');
    const business = await this.access.load(String(offer.businessId), user, 'staff', { write: true });
    if (offer.status === OfferStatus.REMOVED) throw new BadRequestException('This offer was removed');
    return { offer, business };
  }

  /**
   * Edits. A live or scheduled offer is checked again: if it still passes it stays published, otherwise it waits
   * for a moderator. A rejected offer becomes a draft until it is resubmitted.
   */
  async update(offerId: string, dto: UpdateOfferDto, user: AuthUser) {
    const { offer, business } = await this.loadManaged(offerId, user);
    if (offer.status === OfferStatus.EXPIRED) throw new BadRequestException('This offer has ended. Re-post it as a new draft instead.');
    const plan = await this.plans.planFor(business._id);
    const startsAt = dto.startsAt !== undefined ? offerStart(dto.startsAt) : offer.startsAt;
    const endsAt = dto.endsAt !== undefined ? offerEnd(dto.endsAt) : offer.endsAt;
    // Validation DTOs carry every declared field, absent ones as undefined: only what was sent overrides.
    const sent = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Partial<CreateOfferDto>;
    const merged = { ...offer.toObject(), ...sent } as Partial<CreateOfferDto>;
    this.validateSchedule(startsAt, endsAt, merged);
    this.assertPlanFeatures(
      plan,
      // An offer that already redeems with a code (e.g. imported from the business's website) keeps it on any plan.
      { ...merged, redemptionType: offer.redemptionType === RedemptionType.CODE ? undefined : merged.redemptionType },
      startsAt && startsAt.getTime() !== offer.startsAt?.getTime() ? startsAt : undefined,
    );

    const before = { status: offer.status, ...Object.fromEntries(CONTENT_FIELDS.map((f) => [f, (offer as unknown as Record<string, unknown>)[f]])), startsAt: offer.startsAt, endsAt: offer.endsAt };
    const content = this.contentFrom(dto);
    if (dto.displayLabel !== undefined || dto.discountType || dto.value !== undefined) {
      content.displayLabel = (dto.displayLabel?.trim() || defaultLabel({ discountType: (dto.discountType ?? offer.discountType) as DiscountType, value: dto.value ?? offer.value })).slice(0, 20);
    }
    offer.set({ ...content, startsAt, endsAt });
    // Editing an imported offer makes it the merchant's: future scrapes only flag source changes.
    takeOverAsMerchant(offer, ActorContext.current());
    offer.contentFingerprint = fingerprintOfPublishedOffer(offer);

    const previous = offer.status;
    const published = [OfferStatus.ACTIVE, OfferStatus.SCHEDULED, OfferStatus.PENDING, OfferStatus.REVISION_PENDING].includes(previous);
    if (dto.submit || published) {
      if (!published) await this.publishing.assertWithinLimit(business, plan, offer._id);
      const decision = await this.publishing.decide(business, offer, plan);
      offer.set({ status: decision.status, moderationFlags: decision.flags.length ? decision.flags : undefined, submitWhenVerified: decision.status === OfferStatus.DRAFT });
      if (decision.status !== OfferStatus.REJECTED) offer.set({ moderationNote: undefined, rejectReasonCode: undefined });
    } else if (previous === OfferStatus.REJECTED) {
      offer.status = OfferStatus.DRAFT;
    }
    await offer.save().catch((err) => {
      throw isDuplicateOffer(err) ? new ConflictException(DUPLICATE_OFFER_MESSAGE) : err;
    });
    await this.publishing.afterStatusChange(offer, previous);
    await this.audit.record({
      action: 'offer.updated',
      targetType: 'Offer',
      targetId: offer._id,
      before,
      after: { status: offer.status, ...content, startsAt, endsAt },
    });
    return { offer, decision: { status: offer.status, flags: offer.moderationFlags ?? [] } };
  }

  async submit(offerId: string, user: AuthUser) {
    const { offer, business } = await this.loadManaged(offerId, user);
    if (![OfferStatus.DRAFT, OfferStatus.REJECTED].includes(offer.status)) throw new BadRequestException(`This offer is already ${offer.status}`);
    if (offer.endsAt && offer.endsAt < new Date()) throw new BadRequestException('This offer has already ended. Change the end date first.');
    const plan = await this.plans.planFor(business._id);
    await this.publishing.assertWithinLimit(business, plan, offer._id);
    const decision = await this.publishing.decide(business, offer, plan);
    const previous = offer.status;
    offer.set({
      status: decision.status,
      moderationFlags: decision.flags.length ? decision.flags : undefined,
      submitWhenVerified: decision.status === OfferStatus.DRAFT,
      moderationNote: undefined,
      rejectReasonCode: undefined,
    });
    await offer.save().catch((err) => {
      throw isDuplicateOffer(err) ? new ConflictException(DUPLICATE_OFFER_MESSAGE) : err;
    });
    await this.publishing.afterStatusChange(offer, previous);
    await this.audit.record({ action: 'offer.submitted', targetType: 'Offer', targetId: offer._id, before: { status: previous }, after: { status: offer.status, flags: decision.flags } });
    return { offer, decision };
  }

  async pause(offerId: string, user: AuthUser) {
    const { offer } = await this.loadManaged(offerId, user);
    if (![OfferStatus.ACTIVE, OfferStatus.SCHEDULED].includes(offer.status)) throw new BadRequestException('Only live or scheduled offers can be paused');
    const previous = offer.status;
    offer.status = OfferStatus.PAUSED;
    takeOverAsMerchant(offer, ActorContext.current());
    await offer.save();
    await this.publishing.afterStatusChange(offer, previous);
    await this.audit.record({ action: 'offer.paused', targetType: 'Offer', targetId: offer._id, before: { status: previous }, after: { status: offer.status } });
    return offer;
  }

  async resume(offerId: string, user: AuthUser) {
    const { offer, business } = await this.loadManaged(offerId, user);
    if (offer.status !== OfferStatus.PAUSED) throw new BadRequestException('Only paused offers can be resumed');
    if (offer.endsAt && offer.endsAt < new Date()) throw new BadRequestException('This offer has ended. Re-post it as a new draft.');
    const plan = await this.plans.planFor(business._id);
    await this.publishing.assertWithinLimit(business, plan, offer._id);
    offer.status = this.publishing.liveStatus(offer);
    takeOverAsMerchant(offer, ActorContext.current());
    await offer.save().catch((err) => {
      throw isDuplicateOffer(err) ? new ConflictException(DUPLICATE_OFFER_MESSAGE) : err;
    });
    await this.publishing.afterStatusChange(offer, OfferStatus.PAUSED);
    await this.audit.record({ action: 'offer.resumed', targetType: 'Offer', targetId: offer._id, before: { status: OfferStatus.PAUSED }, after: { status: offer.status } });
    return offer;
  }

  /** Duplicate, or re-post an expired offer: a new draft with the same content. */
  async duplicate(offerId: string, user: AuthUser) {
    const offer = Types.ObjectId.isValid(offerId) ? await this.offerModel.findById(offerId).lean() : null;
    if (!offer) throw new NotFoundException('Offer not found');
    const business = await this.access.load(String(offer.businessId), user, 'staff', { write: true });
    const content = Object.fromEntries(CONTENT_FIELDS.map((f) => [f, (offer as unknown as Record<string, unknown>)[f]]).filter(([, v]) => v !== undefined));
    // A live original keeps its dedupe slot, so the copy needs different content until it is edited.
    const stillLive = ![OfferStatus.EXPIRED, OfferStatus.REMOVED, OfferStatus.REJECTED].includes(offer.status);
    const title = stillLive ? `${offer.title} (copy)`.slice(0, 120) : offer.title;
    const now = Date.now();
    const copy = await this.offerModel
      .create({
        ...content,
        title,
        businessId: business._id,
        status: OfferStatus.DRAFT,
        startsAt: offer.startsAt && offer.startsAt.getTime() > now ? offer.startsAt : undefined,
        endsAt: offer.endsAt && offer.endsAt.getTime() > now ? offer.endsAt : undefined,
        contentFingerprint: fingerprintOfPublishedOffer({ ...(offer as unknown as Offer), title }),
      })
      .catch((err) => {
        throw isDuplicateOffer(err) ? new ConflictException('An identical offer already exists. Edit it instead.') : err;
      });
    await this.audit.record({ action: 'offer.duplicated', targetType: 'Offer', targetId: copy._id, after: { from: String(offer._id), title } });
    return copy;
  }

  async remove(offerId: string, user: AuthUser) {
    const offer = Types.ObjectId.isValid(offerId) ? await this.offerModel.findById(offerId) : null;
    if (!offer) throw new NotFoundException('Offer not found');
    await this.access.load(String(offer.businessId), user, 'staff', { write: true });
    const before = { title: offer.title, status: offer.status };
    if (offer.origin === OfferOrigin.SCRAPER) {
      // Imported offers are kept as removed so the next scrape of the website doesn't bring them back.
      removeAsMerchant(offer, ActorContext.current());
      await offer.save();
    } else {
      await offer.deleteOne();
    }
    await recountActiveOffers(this.offerModel, this.businessModel, offer.businessId);
    await this.audit.record({ action: 'offer.deleted', targetType: 'Offer', targetId: offer._id, before });
    return { deleted: true };
  }
}
