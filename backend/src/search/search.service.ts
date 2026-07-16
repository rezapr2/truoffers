import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Business, BusinessDocument } from '../schemas/business.schema';
import { Offer, OfferDocument } from '../schemas/offer.schema';
import { Category, CategoryDocument } from '../schemas/category.schema';
import { Promotion, PromotionDocument, PromotionStatus } from '../schemas/promotion.schema';
import { OfferStatus, VerificationStatus } from '../common/enums';
import { geocodePostcode } from '../common/postcode.util';

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

@Injectable()
export class SearchService {
  constructor(
    @InjectModel(Business.name) private businessModel: Model<BusinessDocument>,
    @InjectModel(Offer.name) private offerModel: Model<OfferDocument>,
    @InjectModel(Category.name) private categoryModel: Model<CategoryDocument>,
    @InjectModel(Promotion.name) private promotionModel: Model<PromotionDocument>,
  ) {}

  async searchOffers(params: SearchParams) {
    let lng = params.lng;
    let lat = params.lat;
    let area: string | undefined;

    if ((lng == null || lat == null) && params.postcode) {
      const geo = await geocodePostcode(params.postcode);
      if (!geo) {
        throw new BadRequestException(
          'We could not find that postcode. Try a full postcode like M14 5TQ.',
        );
      }
      lng = geo.lng;
      lat = geo.lat;
      area = geo.area;
    }

    const radiusMeters = (params.radiusKm || 8) * 1000;

    // 1. Find nearby businesses
    const businessFilter: any = { status: 'active' };
    if (params.verifiedOnly) {
      businessFilter.verificationStatus = { $ne: VerificationStatus.UNCLAIMED };
    }
    if (params.category) {
      const cat = await this.categoryModel.findOne({ slug: params.category });
      if (cat) businessFilter.categories = cat._id;
    }

    let businesses: any[];
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
      businesses = await this.businessModel.find(businessFilter).limit(200).lean();
    }

    if (businesses.length === 0) {
      return { offers: [], businesses: [], searchedArea: area || null, count: 0 };
    }

    // 2. Find their live offers
    const byId = new Map(businesses.map((b) => [String(b._id), b]));
    const now = new Date();
    const offerFilter: any = {
      businessId: { $in: businesses.map((b) => b._id) },
      status: OfferStatus.ACTIVE,
      $or: [{ endsAt: null }, { endsAt: { $gte: now } }],
    };
    if (params.discountType) offerFilter.discountType = params.discountType;
    if (params.delivery) offerFilter.delivery = true;
    if (params.collection) offerFilter.collection = true;

    const offers = await this.offerModel.find(offerFilter).sort({ createdAt: -1 }).lean();

    // 2b. Promoted placements: active promotions boost ranking and tag results
    // as sponsored. A promotion without an offerId boosts the whole business.
    const promotions = await this.promotionModel
      .find({
        businessId: { $in: businesses.map((b) => b._id) },
        status: PromotionStatus.ACTIVE,
      })
      .lean();
    const promotedBusinesses = new Set(
      promotions.filter((p) => !p.offerId).map((p) => String(p.businessId)),
    );
    const promotedOffers = new Set(
      promotions.filter((p) => p.offerId).map((p) => String(p.offerId)),
    );
    const SPONSOR_BOOST = 1.25;

    // 3. Rank: distance + business quality (trust score, rating, verification)
    const enriched = offers.map((o) => {
      const b = byId.get(String(o.businessId));
      const distanceMeters = b?.distanceMeters ?? null;
      const verified = b && b.verificationStatus !== VerificationStatus.UNCLAIMED;
      const sponsored =
        promotedBusinesses.has(String(o.businessId)) || promotedOffers.has(String(o._id));
      const quality =
        (b?.trustScore || 0) / 100 + (b?.reviews?.rating || 0) / 5 + (verified ? 0.5 : 0);
      const distancePenalty = distanceMeters != null ? distanceMeters / radiusMeters : 0.5;
      return {
        ...o,
        sponsored,
        business: b
          ? {
              _id: b._id,
              name: b.name,
              slug: b.slug,
              town: b.town,
              postcodeArea: b.postcodeArea,
              verificationStatus: b.verificationStatus,
              reviews: b.reviews,
              logoUrl: b.logoUrl,
              orderUrl: b.orderUrl,
              phone: b.phone,
              distanceMiles:
                distanceMeters != null ? Math.round((distanceMeters / 1609.34) * 10) / 10 : null,
            }
          : null,
        rankScore: quality - distancePenalty + (sponsored ? SPONSOR_BOOST : 0),
      };
    });
    enriched.sort((a, b) => b.rankScore - a.rankScore);

    const limit = Math.min(100, params.limit || 40);
    return {
      offers: enriched.slice(0, limit),
      businesses: businesses.slice(0, 30).map((b) => ({
        _id: b._id,
        name: b.name,
        slug: b.slug,
        town: b.town,
        postcodeArea: b.postcodeArea,
        verificationStatus: b.verificationStatus,
        reviews: b.reviews,
        logoUrl: b.logoUrl,
        activeOfferCount: b.activeOfferCount,
        sponsored: promotedBusinesses.has(String(b._id)),
        location: b.location,
        distanceMiles:
          b.distanceMeters != null ? Math.round((b.distanceMeters / 1609.34) * 10) / 10 : null,
      })),
      searchedArea: area || null,
      count: enriched.length,
    };
  }
}
