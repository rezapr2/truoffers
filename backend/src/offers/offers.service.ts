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
import { Subscription, SubscriptionDocument } from '../schemas/subscription.schema';
import { Plan, PlanDocument } from '../schemas/plan.schema';
import {
  BusinessStatus,
  OfferStatus,
  PlanKey,
  PUBLIC_OFFER_STATUSES,
  Role,
  SubscriptionStatus,
  VerificationStatus,
} from '../common/enums';
import { ActorContext } from '../common/actor-context';
import { recountActiveOffers } from '../common/offer-counts';
import { PUBLIC_OFFER_PROJECTION, withImportNotice } from '../common/public-offer';
import { OfferOrigin } from '../common/scraper.enums';
import { isIsoDate, londonEndOfDay, londonStartOfDay } from '../scraper/extraction/london-time';
import { fingerprintOfPublishedOffer } from '../scraper/lifecycle/offer-mapping';
import { removeAsMerchant, takeOverAsMerchant } from '../scraper/lifecycle/merchant-management';
import { CreateOfferDto, RedeemOfferDto, UpdateOfferDto } from './offers.dto';

// An identical offer (same business and content fingerprint) can only be live once.
function isDuplicateOffer(err: unknown): boolean {
  return (err as { code?: number; keyPattern?: Record<string, unknown> }).code === 11000 &&
    'dedupeKey' in ((err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {});
}

const DUPLICATE_OFFER_MESSAGE = 'An identical offer is already live for this business';

// A bare calendar day means the whole day in the UK: starts at 00:00 and ends at 23:59:59 London time.
function offerStart(value?: string): Date | undefined {
  if (!value) return undefined;
  return isIsoDate(value) ? londonStartOfDay(value) : new Date(value);
}
function offerEnd(value?: string): Date | undefined {
  if (!value) return undefined;
  return isIsoDate(value) ? londonEndOfDay(value) : new Date(value);
}

@Injectable()
export class OffersService {
  constructor(
    @InjectModel(Offer.name) private offerModel: Model<OfferDocument>,
    @InjectModel(Business.name) private businessModel: Model<BusinessDocument>,
    @InjectModel(Redemption.name) private redemptionModel: Model<RedemptionDocument>,
    @InjectModel(Subscription.name) private subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(Plan.name) private planModel: Model<PlanDocument>,
  ) {}

  async listPublic(params: { businessId?: string; limit?: number }) {
    const now = new Date();
    const filter: any = {
      status: OfferStatus.ACTIVE,
      $or: [{ endsAt: null }, { endsAt: { $gte: now } }],
    };
    if (params.businessId) {
      if (!Types.ObjectId.isValid(params.businessId)) return [];
      filter.businessId = new Types.ObjectId(params.businessId);
    }
    const offers = await this.offerModel
      .find(filter)
      .select(PUBLIC_OFFER_PROJECTION)
      .sort({ createdAt: -1 })
      .limit(Math.min(100, params.limit || 24))
      .populate('businessId', 'name slug town postcodeArea verificationStatus reviews logoUrl orderUrl phone')
      .lean();
    return offers.map(withImportNotice);
  }

  // Unpublished offers (pending, paused, removed, ...) and offers of hidden listings don't load from direct links either.
  async getPublic(id: string) {
    const offer = Types.ObjectId.isValid(id)
      ? await this.offerModel
          .findOne({ _id: id, status: { $in: PUBLIC_OFFER_STATUSES } })
          .select(PUBLIC_OFFER_PROJECTION)
          .populate(
            'businessId',
            'name slug town postcode postcodeArea verificationStatus reviews logoUrl orderUrl phone website status',
          )
          .lean()
      : null;
    const business = offer?.businessId as unknown as { status?: BusinessStatus } | null | undefined;
    if (!offer || business?.status !== BusinessStatus.ACTIVE) throw new NotFoundException('Offer not found');
    return withImportNotice(offer);
  }

  async listForBusiness(businessId: string, user: { userId: string; role: Role }) {
    await this.assertCanManage(businessId, user);
    const offers = await this.offerModel
      .find({ businessId: new Types.ObjectId(businessId), status: { $ne: OfferStatus.REMOVED } })
      .select('-evidence -dedupeKey -contentFingerprint -adapterId -adapterVersion -offerTypeRaw')
      .sort({ createdAt: -1 })
      .lean();
    return offers.map(withImportNotice);
  }

  async create(businessId: string, dto: CreateOfferDto, user: { userId: string; role: Role }) {
    const business = await this.assertCanManage(businessId, user);
    await this.enforceOfferLimit(business);

    // Auto-moderation (blueprint moderation flow): verified businesses are
    // low-risk and go live immediately; unverified go to the admin queue.
    const autoApprove = [
      VerificationStatus.VERIFIED,
      VerificationStatus.FOODBELL_VERIFIED,
      VerificationStatus.TRUSTED_PARTNER,
      VerificationStatus.FRANCHISE_VERIFIED,
    ].includes(business.verificationStatus);

    const endsAt = offerEnd(dto.endsAt);
    const offer = await this.offerModel
      .create({
        ...dto,
        businessId: business._id,
        startsAt: offerStart(dto.startsAt),
        endsAt,
        status: autoApprove ? OfferStatus.ACTIVE : OfferStatus.PENDING,
        // Fingerprinted like imported offers, so a later scrape of the same offer is never duplicated.
        contentFingerprint: fingerprintOfPublishedOffer({
          title: dto.title,
          discountType: dto.discountType,
          value: dto.value ?? 0,
          code: dto.code,
          minOrder: dto.minOrder ?? 0,
          endsAt,
        }),
      })
      .catch((err) => {
        throw isDuplicateOffer(err) ? new ConflictException(DUPLICATE_OFFER_MESSAGE) : err;
      });
    await this.refreshActiveOfferCount(business._id);
    return offer;
  }

  async update(offerId: string, dto: UpdateOfferDto, user: { userId: string; role: Role }) {
    const offer = await this.offerModel.findById(offerId);
    if (!offer) throw new NotFoundException('Offer not found');
    await this.assertCanManage(String(offer.businessId), user);
    if (offer.status === OfferStatus.REMOVED) throw new BadRequestException('This offer was removed');
    Object.assign(offer, {
      ...dto,
      startsAt: offerStart(dto.startsAt) ?? offer.startsAt,
      endsAt: offerEnd(dto.endsAt) ?? offer.endsAt,
    });
    // Editing an imported offer makes it the merchant's: future scrapes only flag source changes.
    takeOverAsMerchant(offer, ActorContext.current());
    offer.contentFingerprint = fingerprintOfPublishedOffer(offer);
    await offer.save().catch((err) => {
      throw isDuplicateOffer(err) ? new ConflictException(DUPLICATE_OFFER_MESSAGE) : err;
    });
    await this.refreshActiveOfferCount(offer.businessId);
    return offer;
  }

  async setStatus(
    offerId: string,
    status: OfferStatus,
    user: { userId: string; role: Role },
  ) {
    const offer = await this.offerModel.findById(offerId);
    if (!offer) throw new NotFoundException('Offer not found');
    await this.assertCanManage(String(offer.businessId), user);
    // Owners can only pause/reactivate/expire their own offers — approval is admin-only
    if (![OfferStatus.PAUSED, OfferStatus.ACTIVE, OfferStatus.EXPIRED].includes(status)) {
      throw new BadRequestException('Invalid status change');
    }
    if (offer.status === OfferStatus.PENDING || offer.status === OfferStatus.REJECTED) {
      throw new BadRequestException('Offer is awaiting moderation');
    }
    if (offer.status === OfferStatus.REMOVED) throw new BadRequestException('This offer was removed');
    offer.status = status;
    takeOverAsMerchant(offer, ActorContext.current());
    await offer.save().catch((err) => {
      throw isDuplicateOffer(err) ? new ConflictException(DUPLICATE_OFFER_MESSAGE) : err;
    });
    await this.refreshActiveOfferCount(offer.businessId);
    return offer;
  }

  async remove(offerId: string, user: { userId: string; role: Role }) {
    const offer = await this.offerModel.findById(offerId);
    if (!offer) throw new NotFoundException('Offer not found');
    await this.assertCanManage(String(offer.businessId), user);
    if (offer.origin === OfferOrigin.SCRAPER) {
      // Imported offers are kept as removed so the next scrape of the website doesn't bring them back.
      removeAsMerchant(offer, ActorContext.current());
      await offer.save();
    } else {
      await offer.deleteOne();
    }
    await this.refreshActiveOfferCount(offer.businessId);
    return { deleted: true };
  }

  // Redemption per blueprint section 9
  async redeem(offerId: string, dto: RedeemOfferDto, userId?: string) {
    const offer = await this.offerModel.findById(offerId);
    if (!offer || offer.status !== OfferStatus.ACTIVE) {
      throw new NotFoundException('Offer not available');
    }
    if (offer.endsAt && offer.endsAt < new Date()) {
      throw new BadRequestException('Offer has expired');
    }
    if (offer.maxRedemptions > 0 && offer.redemptionCount >= offer.maxRedemptions) {
      throw new BadRequestException('Offer fully redeemed');
    }
    // Fraud control: one redemption per user/session per offer
    const dupFilter: any = { offerId: offer._id };
    if (userId) dupFilter.customerId = new Types.ObjectId(userId);
    else if (dto.sessionId) dupFilter.sessionId = dto.sessionId;
    if (userId || dto.sessionId) {
      const dup = await this.redemptionModel.findOne(dupFilter);
      if (dup) {
        return this.redemptionResponse(offer, true);
      }
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
      offer.status = OfferStatus.EXPIRED; // auto-expire at cap
    }
    await offer.save();
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

  private async enforceOfferLimit(business: BusinessDocument) {
    const plan = await this.getActivePlan(business);
    const max = plan?.limits?.maxLiveOffers ?? 2; // Free plan: 2 live offers
    if (max === -1) return;
    // Offers imported from the business's website don't use up its plan allowance.
    const liveCount = await this.offerModel.countDocuments({
      businessId: business._id,
      status: { $in: [OfferStatus.ACTIVE, OfferStatus.PENDING] },
      origin: { $ne: OfferOrigin.SCRAPER },
    });
    if (liveCount >= max) {
      throw new ForbiddenException(
        `Your plan allows ${max} live offer${max === 1 ? '' : 's'}. Upgrade to add more.`,
      );
    }
  }

  private async getActivePlan(business: BusinessDocument) {
    const sub = await this.subscriptionModel.findOne({
      businessId: business._id,
      status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
    });
    const key = sub?.planKey || PlanKey.FREE;
    return this.planModel.findOne({ key });
  }

  refreshActiveOfferCount(businessId: Types.ObjectId) {
    return recountActiveOffers(this.offerModel, this.businessModel, businessId);
  }

  private async assertCanManage(businessId: string, user: { userId: string; role: Role }) {
    const business = await this.businessModel.findById(businessId);
    if (!business) throw new NotFoundException('Business not found');
    const isAdmin = [Role.SUPER_ADMIN, Role.SUPPORT_ADMIN, Role.SALES_ADMIN].includes(user.role);
    if (!isAdmin && String(business.ownerId) !== user.userId) {
      throw new ForbiddenException('You do not manage this business');
    }
    return business;
  }
}
