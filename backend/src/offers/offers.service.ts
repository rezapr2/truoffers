import {
  BadRequestException,
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
  OfferStatus,
  PlanKey,
  Role,
  SubscriptionStatus,
  VerificationStatus,
} from '../common/enums';
import { CreateOfferDto, RedeemOfferDto, UpdateOfferDto } from './offers.dto';

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
    if (params.businessId) filter.businessId = new Types.ObjectId(params.businessId);
    return this.offerModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(100, params.limit || 24))
      .populate('businessId', 'name slug town postcodeArea verificationStatus reviews logoUrl orderUrl phone');
  }

  async getPublic(id: string) {
    const offer = await this.offerModel
      .findById(id)
      .populate(
        'businessId',
        'name slug town postcode postcodeArea verificationStatus reviews logoUrl orderUrl phone website',
      );
    if (!offer) throw new NotFoundException('Offer not found');
    return offer;
  }

  async listForBusiness(businessId: string, user: { userId: string; role: Role }) {
    await this.assertCanManage(businessId, user);
    return this.offerModel.find({ businessId: new Types.ObjectId(businessId) }).sort({ createdAt: -1 });
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

    const offer = await this.offerModel.create({
      ...dto,
      businessId: business._id,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
      endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
      status: autoApprove ? OfferStatus.ACTIVE : OfferStatus.PENDING,
    });
    await this.refreshActiveOfferCount(business._id);
    return offer;
  }

  async update(offerId: string, dto: UpdateOfferDto, user: { userId: string; role: Role }) {
    const offer = await this.offerModel.findById(offerId);
    if (!offer) throw new NotFoundException('Offer not found');
    await this.assertCanManage(String(offer.businessId), user);
    Object.assign(offer, {
      ...dto,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : offer.startsAt,
      endsAt: dto.endsAt ? new Date(dto.endsAt) : offer.endsAt,
    });
    await offer.save();
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
    offer.status = status;
    await offer.save();
    await this.refreshActiveOfferCount(offer.businessId);
    return offer;
  }

  async remove(offerId: string, user: { userId: string; role: Role }) {
    const offer = await this.offerModel.findById(offerId);
    if (!offer) throw new NotFoundException('Offer not found');
    await this.assertCanManage(String(offer.businessId), user);
    await offer.deleteOne();
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
    const liveCount = await this.offerModel.countDocuments({
      businessId: business._id,
      status: { $in: [OfferStatus.ACTIVE, OfferStatus.PENDING] },
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

  private async refreshActiveOfferCount(businessId: Types.ObjectId) {
    const count = await this.offerModel.countDocuments({
      businessId,
      status: OfferStatus.ACTIVE,
    });
    await this.businessModel.findByIdAndUpdate(businessId, { activeOfferCount: count });
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
