import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import slugify from 'slugify';
import { Business, BusinessDocument } from '../schemas/business.schema';
import { Claim, ClaimDocument } from '../schemas/claim.schema';
import { MenuItem, MenuItemDocument } from '../schemas/menu.schema';
import { Offer, OfferDocument } from '../schemas/offer.schema';
import { Category, CategoryDocument } from '../schemas/category.schema';
import {
  ClaimMethod,
  ClaimStatus,
  OfferStatus,
  Role,
  VerificationStatus,
} from '../common/enums';
import { geocodePostcode, normalisePostcode, outwardCode } from '../common/postcode.util';
import {
  CreateBusinessDto,
  CreateMenuItemDto,
  StartClaimDto,
  UpdateBusinessDto,
} from './businesses.dto';

const AUTO_APPROVE_METHODS = [ClaimMethod.PHONE_OTP, ClaimMethod.FOODBELL_AUTO];

@Injectable()
export class BusinessesService {
  constructor(
    @InjectModel(Business.name) private businessModel: Model<BusinessDocument>,
    @InjectModel(Claim.name) private claimModel: Model<ClaimDocument>,
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

  async findBySlug(slug: string) {
    const business = await this.businessModel
      .findOne({ slug })
      .populate('categories', 'name slug emoji');
    if (!business) throw new NotFoundException('Business not found');
    const now = new Date();
    const [offers, menu] = await Promise.all([
      this.offerModel
        .find({
          businessId: business._id,
          status: OfferStatus.ACTIVE,
          $or: [{ endsAt: null }, { endsAt: { $gte: now } }],
        })
        .sort({ createdAt: -1 }),
      this.menuModel.find({ businessId: business._id }).sort({ section: 1, sortOrder: 1 }),
    ]);
    return { business, offers, menu };
  }

  async create(dto: CreateBusinessDto, ownerId?: string, claimImmediately = false) {
    const slug = await this.uniqueSlug(dto.name);
    const postcode = normalisePostcode(dto.postcode);
    const geo = await geocodePostcode(postcode);
    const business = await this.businessModel.create({
      ...dto,
      slug,
      postcode,
      postcodeArea: outwardCode(postcode),
      location: geo ? { type: 'Point', coordinates: [geo.lng, geo.lat] } : undefined,
      ownerId: claimImmediately && ownerId ? new Types.ObjectId(ownerId) : undefined,
      verificationStatus:
        claimImmediately && ownerId ? VerificationStatus.CLAIMED : VerificationStatus.UNCLAIMED,
      categories: (dto.categories || []).map((id) => new Types.ObjectId(id)),
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
    await business.save();
    return business;
  }

  async myBusinesses(userId: string) {
    return this.businessModel
      .find({ ownerId: new Types.ObjectId(userId) })
      .populate('categories', 'name slug emoji');
  }

  // ---- Claim & verification flow (blueprint section 8) ----

  async startClaim(businessId: string, userId: string, dto: StartClaimDto) {
    const business = await this.businessModel.findById(businessId);
    if (!business) throw new NotFoundException('Business not found');
    if (business.ownerId) throw new BadRequestException('This business is already claimed');

    const existing = await this.claimModel.findOne({
      businessId: business._id,
      userId: new Types.ObjectId(userId),
      status: ClaimStatus.PENDING,
    });
    if (existing) throw new BadRequestException('You already have a pending claim');

    const otpCode =
      dto.method === ClaimMethod.PHONE_OTP
        ? String(Math.floor(100000 + Math.random() * 900000))
        : undefined;

    const claim = await this.claimModel.create({
      businessId: business._id,
      userId: new Types.ObjectId(userId),
      method: dto.method,
      evidence: dto.evidence,
      otpCode,
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
    const claim = await this.claimModel.findById(claimId).select('+otpCode');
    if (!claim || String(claim.userId) !== userId) throw new NotFoundException('Claim not found');
    if (claim.status !== ClaimStatus.PENDING) throw new BadRequestException('Claim already resolved');
    if (claim.method !== ClaimMethod.PHONE_OTP) {
      throw new BadRequestException('This claim does not use OTP verification');
    }
    if (claim.otpCode !== otp) throw new BadRequestException('Incorrect code');

    claim.otpVerified = true;
    claim.status = ClaimStatus.APPROVED;
    await claim.save();
    await this.approveClaimEffects(claim);
    return { status: 'approved' };
  }

  async approveClaimEffects(claim: ClaimDocument) {
    const verificationStatus =
      claim.method === ClaimMethod.FOODBELL_AUTO
        ? VerificationStatus.FOODBELL_VERIFIED
        : AUTO_APPROVE_METHODS.includes(claim.method)
          ? VerificationStatus.VERIFIED
          : VerificationStatus.CLAIMED;
    await this.businessModel.findByIdAndUpdate(claim.businessId, {
      ownerId: claim.userId,
      verificationStatus,
      $inc: { trustScore: 20 },
    });
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
