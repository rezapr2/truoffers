import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Business, BusinessDocument } from '../schemas/business.schema';
import { Offer, OfferDocument } from '../schemas/offer.schema';
import { Category, CategoryDocument } from '../schemas/category.schema';
import { BusinessStatus, isVerifiedLevel, PromotionPlacement, PUBLIC_OFFER_STATUSES, VerificationLevel } from '../common/enums';
import { geocodePostcode, outwardCode } from '../common/postcode.util';
import { offerSlug, PUBLIC_OFFER_PROJECTION } from '../common/public-offer';
import { PlansService } from '../plans/plans.service';
import { PromotionsService } from '../promotions/promotions.service';

export interface SearchParams {
  postcode?: string;
  lat?: number;
  lng?: number;
  category?: string;
  radiusKm?: number;
  discountType?: string;
  delivery?: boolean;
  collection?: boolean;
  verifiedOnly?: boolean;
  limit?: number;
}

type NearbyBusiness = Business & { _id: Types.ObjectId; distanceMeters?: number };

@Injectable()
export class SearchService {
  constructor(
    @InjectModel(Business.name) private businessModel: Model<BusinessDocument>,
    @InjectModel(Offer.name) private offerModel: Model<OfferDocument>,
    @InjectModel(Category.name) private categoryModel: Model<CategoryDocument>,
    private readonly plans: PlansService,
    private readonly promotions: PromotionsService,
  ) {}

  /**
   * Spec: "Results rank promoted slots first, then verified businesses, then distance", with the plan's
   * ranking boost after verification (T5.3). Promoted results are labelled "Promoted".
   */
  async searchOffers(params: SearchParams) {
    let lng = params.lng;
    let lat = params.lat;
    let area: string | undefined;

    if ((lng == null || lat == null) && params.postcode) {
      const geo = await geocodePostcode(params.postcode);
      if (!geo) {
        throw new BadRequestException('We could not find that postcode. Try a full postcode like M14 5TQ.');
      }
      lng = geo.lng;
      lat = geo.lat;
      area = geo.area;
    }
    if (!area && params.postcode) area = outwardCode(params.postcode);

    const radiusMeters = (params.radiusKm || 8) * 1000;

    // 1. Nearby live businesses
    const businessFilter: Record<string, unknown> = { status: BusinessStatus.ACTIVE };
    if (params.verifiedOnly) businessFilter.verificationLevel = { $gte: VerificationLevel.VERIFIED };
    let category: CategoryDocument | null = null;
    if (params.category) {
      category = await this.categoryModel.findOne({ slug: params.category });
      if (category) businessFilter.categories = category._id;
    }

    let businesses: NearbyBusiness[];
    if (lng != null && lat != null) {
      businesses = await this.businessModel.aggregate([
        {
          $geoNear: {
            near: { type: 'Point', coordinates: [lng, lat] },
            distanceField: 'distanceMeters',
            maxDistance: radiusMeters,
            query: businessFilter,
            spherical: true,
          },
        },
        { $limit: 200 },
      ]);
    } else {
      businesses = (await this.businessModel.find(businessFilter).limit(200).lean()) as NearbyBusiness[];
    }

    if (businesses.length === 0) {
      return { offers: [], businesses: [], searchedArea: area || null, count: 0 };
    }

    // 2. Their live offers
    const byId = new Map(businesses.map((b) => [String(b._id), b]));
    const now = new Date();
    const offerFilter: Record<string, unknown> = {
      businessId: { $in: businesses.map((b) => b._id) },
      status: { $in: PUBLIC_OFFER_STATUSES },
      $or: [{ endsAt: null }, { endsAt: { $gte: now } }],
    };
    if (params.discountType) offerFilter.discountType = params.discountType;
    if (params.delivery) offerFilter.delivery = true;
    if (params.collection) offerFilter.collection = true;

    const offers = await this.offerModel.find(offerFilter).select(PUBLIC_OFFER_PROJECTION).sort({ createdAt: -1 }).lean();

    // 3. Promoted slots: Top of search for the searched postcode area, Category feature for the cuisine in the
    // towns being shown.
    const towns = [...new Set(businesses.map((b) => b.town).filter(Boolean) as string[])];
    const [topOfSearch, categoryFeature, plans] = await Promise.all([
      area ? this.promotions.promotedOfferIds(PromotionPlacement.TOP_OF_SEARCH, { area }) : Promise.resolve([] as string[]),
      category ? this.promotions.promotedOfferIds(PromotionPlacement.CATEGORY_FEATURE, { categoryId: String(category._id), cities: towns }) : Promise.resolve([] as string[]),
      this.plans.plansFor(businesses.map((b) => b._id)),
    ]);
    const promotedRank = new Map<string, number>();
    topOfSearch.forEach((id, i) => promotedRank.set(id, i));
    categoryFeature.forEach((id, i) => {
      if (!promotedRank.has(id)) promotedRank.set(id, topOfSearch.length + i);
    });

    const enriched = offers.map((o) => {
      const b = byId.get(String(o.businessId));
      const distanceMeters = b?.distanceMeters ?? null;
      const verified = isVerifiedLevel(b?.verificationLevel);
      const boost = plans.get(String(o.businessId))?.flags?.rankingBoost ?? 0;
      const promoted = promotedRank.has(String(o._id));
      return {
        ...o,
        slug: offerSlug(o.title, b?.name),
        promoted,
        business: b
          ? {
              _id: b._id,
              name: b.name,
              slug: b.slug,
              town: b.town,
              postcodeArea: b.postcodeArea,
              verificationLevel: b.verificationLevel,
              isFoodbellClient: b.isFoodbellClient,
              reviews: b.reviews,
              logoUrl: b.logoUrl,
              orderUrl: b.orderUrl,
              phone: b.phone,
              distanceMiles: distanceMeters != null ? Math.round((distanceMeters / 1609.34) * 10) / 10 : null,
            }
          : null,
        rank: {
          promoted: promoted ? promotedRank.get(String(o._id))! : Number.POSITIVE_INFINITY,
          verified: verified ? 1 : 0,
          boost,
          distance: distanceMeters ?? Number.POSITIVE_INFINITY,
          rating: b?.reviews?.rating ?? 0,
        },
      };
    });
    enriched.sort(
      (a, b) =>
        a.rank.promoted - b.rank.promoted ||
        b.rank.verified - a.rank.verified ||
        b.rank.boost - a.rank.boost ||
        a.rank.distance - b.rank.distance ||
        b.rank.rating - a.rank.rating,
    );

    const limit = Math.min(100, params.limit || 40);
    return {
      offers: enriched.slice(0, limit).map(({ rank: _rank, ...offer }) => offer),
      businesses: businesses
        .slice()
        .sort((a, b) => Number(isVerifiedLevel(b.verificationLevel)) - Number(isVerifiedLevel(a.verificationLevel)) || (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0))
        .slice(0, 30)
        .map((b) => ({
          _id: b._id,
          name: b.name,
          slug: b.slug,
          town: b.town,
          postcodeArea: b.postcodeArea,
          verificationLevel: b.verificationLevel,
          claimState: (b.verificationLevel ?? 0) >= VerificationLevel.VERIFIED ? 'verified' : b.verificationLevel === VerificationLevel.CLAIM_PENDING ? 'in_review' : 'unclaimed',
          isFoodbellClient: b.isFoodbellClient,
          reviews: b.reviews,
          logoUrl: b.logoUrl,
          activeOfferCount: b.activeOfferCount,
          location: b.location,
          distanceMiles: b.distanceMeters != null ? Math.round((b.distanceMeters / 1609.34) * 10) / 10 : null,
        })),
      searchedArea: area || null,
      count: enriched.length,
    };
  }
}
