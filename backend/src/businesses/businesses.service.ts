import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import slugify from 'slugify';
import { Business, BusinessDocument } from '../schemas/business.schema';
import { Claim, ClaimDocument } from '../schemas/claim.schema';
import { MerchantClaimInvitation, MerchantClaimInvitationDocument } from '../schemas/merchant-claim-invitation.schema';
import { MenuItem, MenuItemDocument } from '../schemas/menu.schema';
import { Offer, OfferDocument } from '../schemas/offer.schema';
import { Category, CategoryDocument } from '../schemas/category.schema';
import {
  BusinessStatus,
  ClaimMethod,
  ClaimStatus,
  OfferStatus,
  PUBLIC_OFFER_STATUSES,
  Role,
  VerificationStatus,
} from '../common/enums';
import { PUBLIC_OFFER_PROJECTION, withImportNotice } from '../common/public-offer';
import { geocodePostcode, normalisePostcode, outwardCode } from '../common/postcode.util';
import { deriveBusinessIdentity } from '../common/business-identity';
import {
  CreateBusinessDto,
  CreateMenuItemDto,
  StartClaimDto,
  UpdateBusinessDto,
} from './businesses.dto';

const AUTO_APPROVE_METHODS = [ClaimMethod.PHONE_OTP, ClaimMethod.FOODBELL_AUTO];

// Phone-code claims: a code works for 15 minutes and for 5 tries, and a business accepts at most 5 such
// claims a day from all accounts together, so at most 25 of the 900,000 possible codes can be tried a day.
const DAY_MS = 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 15 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_CLAIMS_PER_BUSINESS_PER_DAY = 5;

function isExpiredOtpClaim(claim: ClaimDocument): boolean {
  if (claim.method !== ClaimMethod.PHONE_OTP) return false;
  return !claim.otpExpiresAt || claim.otpExpiresAt.getTime() < Date.now();
}

function otpMatches(expected: string | undefined, given: string): boolean {
  if (!expected || typeof given !== 'string' || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

// Listings are unique by canonical postcode and normalised name.
function duplicateListing(err: unknown): unknown {
  const { code, keyPattern } = err as { code?: number; keyPattern?: Record<string, unknown> };
  return code === 11000 && keyPattern && 'nameNormalized' in keyPattern
    ? new ConflictException('A listing with this name already exists at this postcode')
    : err;
}

@Injectable()
export class BusinessesService {
  constructor(
    @InjectModel(Business.name) private businessModel: Model<BusinessDocument>,
    @InjectModel(Claim.name) private claimModel: Model<ClaimDocument>,
    @InjectModel(MerchantClaimInvitation.name) private invitationModel: Model<MerchantClaimInvitationDocument>,
    @InjectModel(MenuItem.name) private menuModel: Model<MenuItemDocument>,
    @InjectModel(Offer.name) private offerModel: Model<OfferDocument>,
    @InjectModel(Category.name) private categoryModel: Model<CategoryDocument>,
  ) {}

  async list(params: {
    town?: string;
    category?: string;
    verified?: boolean;
    featured?: boolean;
    q?: string;
    page?: number;
    limit?: number;
  }) {
    const filter: any = { status: 'active' };
    if (params.town) filter.town = new RegExp(`^${escapeRegex(params.town)}$`, 'i');
    if (params.verified) {
      filter.verificationStatus = { $ne: VerificationStatus.UNCLAIMED };
    }
    if (params.featured) filter.featured = true;
    if (params.category) {
      const cat = await this.categoryModel.findOne({ slug: params.category });
      if (cat) filter.categories = cat._id;
    }
    if (params.q) filter.name = new RegExp(escapeRegex(params.q), 'i');

    const page = Math.max(1, params.page || 1);
    const limit = Math.min(50, params.limit || 20);
    const [items, total] = await Promise.all([
      this.businessModel
        .find(filter)
        .sort({ featured: -1, trustScore: -1, 'reviews.rating': -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('categories', 'name slug emoji'),
      this.businessModel.countDocuments(filter),
    ]);
    return { items, total, page, pages: Math.ceil(total / limit) };
  }

  async towns() {
    return this.businessModel.aggregate([
      { $match: { status: 'active', town: { $ne: null } } },
      { $group: { _id: '$town', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $project: { town: '$_id', count: 1, _id: 0 } },
    ]);
  }

  // Suspended, pending and closed listings are not public, including by direct link.
  async findBySlug(slug: string) {
    const business = await this.businessModel
      .findOne({ slug, status: BusinessStatus.ACTIVE })
      .select('-phoneE164 -nameNormalized -postcodeCanonical -websiteHost -importSource.scrapedWebsiteRef')
      .populate('categories', 'name slug emoji');
    if (!business) throw new NotFoundException('Business not found');
    const now = new Date();
    const [offers, menu, checkingAvailability] = await Promise.all([
      this.offerModel
        .find({
          businessId: business._id,
          status: { $in: PUBLIC_OFFER_STATUSES },
          $or: [{ endsAt: null }, { endsAt: { $gte: now } }],
        })
        .select(PUBLIC_OFFER_PROJECTION)
        .sort({ createdAt: -1 })
        .lean(),
      this.menuModel.find({ businessId: business._id }).sort({ section: 1, sortOrder: 1 }),
      // Spec §9: imported offers hidden while a recheck confirms whether they are still offered.
      this.offerModel.countDocuments({ businessId: business._id, status: OfferStatus.POSSIBLY_REMOVED, $or: [{ endsAt: null }, { endsAt: { $gte: now } }] }),
    ]);
    // A listing created from the business's website (and not yet claimed) says so, like imported offers do.
    const imported =
      business.importSource?.domain && !business.ownerId
        ? { domain: business.importSource.domain, lastCheckedAt: business.importSource.lastCheckedAt }
        : null;
    return { business: { ...business.toJSON(), imported }, offers: offers.map(withImportNotice), menu, checkingAvailability };
  }

  async create(
    dto: CreateBusinessDto,
    ownerId?: string,
    claimImmediately = false,
    options: { importSource?: { scrapedWebsiteRef: Types.ObjectId; domain: string; importedAt: Date; lastCheckedAt?: Date } } = {},
  ) {
    const slug = await this.uniqueSlug(dto.name);
    const postcode = normalisePostcode(dto.postcode);
    const geo = await geocodePostcode(postcode);
    const business = await this.businessModel
      .create({
        ...dto,
        ...deriveBusinessIdentity({ name: dto.name, phone: dto.phone, postcode, website: dto.website }),
        slug,
        postcode,
        postcodeArea: outwardCode(postcode),
        location: geo ? { type: 'Point', coordinates: [geo.lng, geo.lat] } : undefined,
        ownerId: claimImmediately && ownerId ? new Types.ObjectId(ownerId) : undefined,
        verificationStatus:
          claimImmediately && ownerId ? VerificationStatus.CLAIMED : VerificationStatus.UNCLAIMED,
        categories: (dto.categories || []).map((id) => new Types.ObjectId(id)),
        importSource: options.importSource,
      })
      .catch((err) => {
        throw duplicateListing(err);
      });
    if (business.categories.length) {
      await this.categoryModel.updateMany(
        { _id: { $in: business.categories } },
        { $inc: { businessCount: 1 } },
      );
    }
    return business;
  }

  async update(id: string, dto: UpdateBusinessDto, user: { userId: string; role: Role }) {
    const business = await this.assertCanManage(id, user);
    // The DTO class declares every field, so fields left out of the request are present as undefined: assigning
    // them would erase what the listing has (and fail validation for its name and postcode).
    dto = Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined)) as UpdateBusinessDto;
    if (dto.postcode) {
      const postcode = normalisePostcode(dto.postcode);
      const geo = await geocodePostcode(postcode);
      (dto as any).postcode = postcode;
      (business as any).postcodeArea = outwardCode(postcode);
      if (geo) business.location = { type: 'Point', coordinates: [geo.lng, geo.lat] } as any;
    }
    Object.assign(business, dto);
    if (dto.categories) {
      business.categories = dto.categories.map((c) => new Types.ObjectId(c));
    }
    Object.assign(
      business,
      deriveBusinessIdentity({ name: business.name, phone: business.phone, postcode: business.postcode, website: business.website }),
    );
    await business.save().catch((err) => {
      throw duplicateListing(err);
    });
    return business;
  }

  async myBusinesses(userId: string) {
    return this.businessModel
      .find({ ownerId: new Types.ObjectId(userId) })
      .populate('categories', 'name slug emoji');
  }

  // Franchise dashboard: per-location stats plus totals across every business
  // the user owns (multi-branch operators see them side by side).
  async myBusinessesStats(userId: string) {
    const businesses = await this.businessModel
      .find({ ownerId: new Types.ObjectId(userId) })
      .select('name slug town postcode verificationStatus reviews followerCount activeOfferCount status');
    if (businesses.length === 0) return { locations: [], totals: null };

    const perBusiness = await this.offerModel.aggregate([
      { $match: { businessId: { $in: businesses.map((b) => b._id) } } },
      {
        $group: {
          _id: '$businessId',
          impressions: { $sum: '$impressions' },
          flips: { $sum: '$flips' },
          detailViews: { $sum: '$detailViews' },
          orderClicks: { $sum: '$orderClicks' },
          redemptions: { $sum: '$redemptionCount' },
          offerCount: { $sum: 1 },
        },
      },
    ]);
    const statsById = new Map(perBusiness.map((s) => [String(s._id), s]));

    const empty = {
      impressions: 0,
      flips: 0,
      detailViews: 0,
      orderClicks: 0,
      redemptions: 0,
      offerCount: 0,
    };
    const locations = businesses.map((b) => ({
      business: b,
      stats: statsById.get(String(b._id)) || { _id: b._id, ...empty },
    }));

    const totals = locations.reduce(
      (acc, l) => ({
        impressions: acc.impressions + l.stats.impressions,
        flips: acc.flips + l.stats.flips,
        detailViews: acc.detailViews + l.stats.detailViews,
        orderClicks: acc.orderClicks + l.stats.orderClicks,
        redemptions: acc.redemptions + l.stats.redemptions,
        offerCount: acc.offerCount + l.stats.offerCount,
        activeOffers: acc.activeOffers + (l.business.activeOfferCount || 0),
        followers: acc.followers + (l.business.followerCount || 0),
        locations: acc.locations + 1,
      }),
      { ...empty, activeOffers: 0, followers: 0, locations: 0 },
    );

    return { locations, totals };
  }

  // ---- Claim & verification flow (blueprint section 8) ----

  async startClaim(businessId: string, userId: string, dto: StartClaimDto) {
    const business = Types.ObjectId.isValid(businessId) ? await this.businessModel.findById(businessId) : null;
    if (!business) throw new NotFoundException('Business not found');
    if (business.ownerId) throw new BadRequestException('This business is already claimed');

    const existing = await this.claimModel.findOne({
      businessId: business._id,
      userId: new Types.ObjectId(userId),
      status: ClaimStatus.PENDING,
    });
    if (existing && isExpiredOtpClaim(existing)) {
      await this.rejectOtpClaim(existing, 'The verification code expired');
    } else if (existing) {
      throw new BadRequestException('You already have a pending claim');
    }

    const phoneOtp = dto.method === ClaimMethod.PHONE_OTP;
    if (phoneOtp) {
      if (!business.phone) {
        throw new BadRequestException('This listing has no phone number to send a code to. Choose document review instead.');
      }
      // Counted across every account, so new sign-ups don't buy more guesses at the same business's code.
      const recent = await this.claimModel.countDocuments({
        businessId: business._id,
        method: ClaimMethod.PHONE_OTP,
        createdAt: { $gte: new Date(Date.now() - DAY_MS) },
      });
      if (recent >= OTP_CLAIMS_PER_BUSINESS_PER_DAY) {
        throw new HttpException(
          'Too many phone verification attempts for this business today. Try again tomorrow or choose document review.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    const otpCode = phoneOtp ? String(randomInt(100000, 1000000)) : undefined;

    const claim = await this.claimModel.create({
      businessId: business._id,
      userId: new Types.ObjectId(userId),
      method: dto.method,
      evidence: dto.evidence,
      otpCode,
      otpExpiresAt: phoneOtp ? new Date(Date.now() + OTP_TTL_MS) : undefined,
      riskLevel: dto.method === ClaimMethod.FOODBELL_AUTO ? 'very_low' : 'medium',
    });

    // In production the OTP is sent by SMS to the business's registered phone.
    // In dev we return it so the flow can be exercised end-to-end.
    return {
      claimId: claim.id,
      method: claim.method,
      status: claim.status,
      ...(otpCode && process.env.NODE_ENV !== 'production' ? { devOtp: otpCode } : {}),
    };
  }

  async verifyClaimOtp(claimId: string, userId: string, otp: string) {
    const claim = Types.ObjectId.isValid(claimId) ? await this.claimModel.findById(claimId) : null;
    if (!claim || String(claim.userId) !== userId) throw new NotFoundException('Claim not found');
    if (claim.status !== ClaimStatus.PENDING) throw new BadRequestException('Claim already resolved');
    if (claim.method !== ClaimMethod.PHONE_OTP) {
      throw new BadRequestException('This claim does not use OTP verification');
    }
    if (isExpiredOtpClaim(claim)) {
      await this.rejectOtpClaim(claim, 'The verification code expired');
      throw new BadRequestException('This code has expired. Start the claim again to get a new one.');
    }

    // Count the attempt before comparing, atomically, so parallel requests can't get past the limit.
    const attempt = await this.claimModel
      .findOneAndUpdate(
        { _id: claim._id, status: ClaimStatus.PENDING, otpAttempts: { $lt: OTP_MAX_ATTEMPTS } },
        { $inc: { otpAttempts: 1 } },
        { new: true },
      )
      .select('+otpCode');
    if (!attempt) {
      await this.rejectOtpClaim(claim, 'Too many incorrect codes');
      throw new BadRequestException('Too many incorrect codes. Start the claim again to get a new one.');
    }
    if (!otpMatches(attempt.otpCode, otp)) {
      const left = OTP_MAX_ATTEMPTS - attempt.otpAttempts;
      if (left <= 0) {
        await this.rejectOtpClaim(attempt, 'Too many incorrect codes');
        throw new BadRequestException('Incorrect code. Start the claim again to get a new one.');
      }
      throw new BadRequestException(`Incorrect code (${left} attempt${left === 1 ? '' : 's'} left)`);
    }

    const approved = await this.claimModel.findOneAndUpdate(
      { _id: claim._id, status: ClaimStatus.PENDING },
      { $set: { status: ClaimStatus.APPROVED, otpVerified: true }, $unset: { otpCode: 1 } },
      { new: true },
    );
    if (!approved) throw new BadRequestException('Claim already resolved');
    try {
      await this.approveClaimEffects(approved);
    } catch (err) {
      await this.claimModel.updateOne(
        { _id: approved._id },
        { $set: { status: ClaimStatus.REJECTED, reviewNote: 'The business was claimed by another account first' } },
      );
      throw err;
    }
    return { status: 'approved' };
  }

  private async rejectOtpClaim(claim: ClaimDocument, reason: string) {
    await this.claimModel.updateOne(
      { _id: claim._id, status: ClaimStatus.PENDING },
      { $set: { status: ClaimStatus.REJECTED, reviewNote: reason }, $unset: { otpCode: 1 } },
    );
  }

  /**
   * Makes the claimant the business's owner. A claim approved by a code alone never takes a business away from an
   * owner it already has (a claim started before someone else claimed it, say): only an admin reviewing the
   * claim may hand an owned business to someone else, with `replaceOwner`.
   */
  async approveClaimEffects(claim: ClaimDocument, options: { replaceOwner?: boolean } = {}) {
    const verificationStatus =
      claim.method === ClaimMethod.FOODBELL_AUTO
        ? VerificationStatus.FOODBELL_VERIFIED
        : AUTO_APPROVE_METHODS.includes(claim.method)
          ? VerificationStatus.VERIFIED
          : VerificationStatus.CLAIMED;
    const business = await this.businessModel.findOneAndUpdate(
      options.replaceOwner
        ? { _id: claim.businessId }
        : { _id: claim.businessId, $or: [{ ownerId: null }, { ownerId: claim.userId }] },
      { ownerId: claim.userId, verificationStatus, $inc: { trustScore: 20 } },
    );
    if (!business) throw new ConflictException('This business has already been claimed by another account');
    // Spec §14: any claim invitation an admin handed this business is done with, however the claim arrived.
    await this.invitationModel.updateMany(
      { businessRef: claim.businessId, claimedAt: { $exists: false }, revokedAt: { $exists: false } },
      { $set: { claimedAt: new Date(), claimedBy: claim.userId } },
    );
  }

  async myClaims(userId: string) {
    return this.claimModel
      .find({ userId: new Types.ObjectId(userId) })
      .populate('businessId', 'name slug');
  }

  // ---- Menu management ----

  async addMenuItem(businessId: string, dto: CreateMenuItemDto, user: { userId: string; role: Role }) {
    await this.assertCanManage(businessId, user);
    return this.menuModel.create({ ...dto, businessId: new Types.ObjectId(businessId) });
  }

  async removeMenuItem(businessId: string, itemId: string, user: { userId: string; role: Role }) {
    await this.assertCanManage(businessId, user);
    await this.menuModel.deleteOne({ _id: itemId, businessId: new Types.ObjectId(businessId) });
    return { deleted: true };
  }

  async assertCanManage(businessId: string, user: { userId: string; role: Role }) {
    const business = await this.businessModel.findById(businessId);
    if (!business) throw new NotFoundException('Business not found');
    const isAdmin = [Role.SUPER_ADMIN, Role.SUPPORT_ADMIN, Role.SALES_ADMIN].includes(user.role);
    if (!isAdmin && String(business.ownerId) !== user.userId) {
      throw new ForbiddenException('You do not manage this business');
    }
    return business;
  }

  async uniqueSlug(name: string) {
    const base = slugify(name, { lower: true, strict: true });
    let slug = base;
    let i = 1;
    while (await this.businessModel.exists({ slug })) {
      slug = `${base}-${++i}`;
    }
    return slug;
  }
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
