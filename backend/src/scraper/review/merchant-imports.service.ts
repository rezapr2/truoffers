import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ADMIN_ROLES, Role } from '../../common/enums';
import { CandidateStatus, RESOLVED_BRANCH_STATUSES } from '../../common/scraper.enums';
import { Business, BusinessDocument } from '../../schemas/business.schema';
import {
  ExtractedOfferCandidate,
  ExtractedOfferCandidateDocument,
} from '../../schemas/extracted-offer-candidate.schema';
import { Offer, OfferDocument } from '../../schemas/offer.schema';
import { ScrapedWebsite, ScrapedWebsiteDocument } from '../../schemas/scraped-website.schema';

// What a business sees of an offer found on its own website: the offer and where it was found, never scoring internals.
const MERCHANT_PROJECTION =
  'domain branchPaths title shortDescription terms offerType discountPercentage discountAmount originalPrice promotionalPrice freeItem promoCode minimumOrder requiredSpend collectionEligible deliveryEligible newCustomersOnly applicableProducts eligibleWeekdays dailyStartTime dailyEndTime startDate endDate sources lastCheckedAt status approvedOfferRefs createdAt';

@Injectable()
export class MerchantImportsService {
  constructor(
    @InjectModel(ExtractedOfferCandidate.name) private readonly candidates: Model<ExtractedOfferCandidateDocument>,
    @InjectModel(ScrapedWebsite.name) private readonly sites: Model<ScrapedWebsiteDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Offer.name) private readonly offers: Model<OfferDocument>,
  ) {}

  // Candidates an admin sent to this business for confirmation and the business hasn't answered yet.
  async pendingFor(businessId: string, user: { userId: string; role: Role }) {
    const business = await this.assertCanManage(businessId, user);
    const sites = await this.sites
      .find({ businesses: { $elemMatch: { businessRef: business._id, matchStatus: { $in: RESOLVED_BRANCH_STATUSES } } } })
      .select('_id businesses.branchPath businesses.businessRef businesses.matchStatus')
      .lean();
    if (sites.length === 0) return [];

    const clauses = sites.map((site) => ({
      scrapedWebsiteRef: site._id,
      branchPaths: {
        $in: site.businesses
          .filter((b) => String(b.businessRef) === String(business._id) && RESOLVED_BRANCH_STATUSES.includes(b.matchStatus))
          .map((b) => b.branchPath),
      },
    }));
    const candidates = await this.candidates
      .find({ status: CandidateStatus.AWAITING_MERCHANT_CONFIRMATION, $or: clauses })
      .select(MERCHANT_PROJECTION)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    // A multi-branch candidate stays open until every branch answers; hide it from branches that already have.
    const answered = new Set(
      (
        await this.offers
          .find({ _id: { $in: candidates.flatMap((c) => c.approvedOfferRefs) }, businessId: business._id })
          .select('candidateRef')
          .lean()
      ).map((o) => String(o.candidateRef)),
    );
    return candidates
      .filter((c) => !answered.has(String(c._id)))
      .map(({ approvedOfferRefs: _refs, ...candidate }) => candidate);
  }

  private async assertCanManage(businessId: string, user: { userId: string; role: Role }) {
    const business = Types.ObjectId.isValid(businessId) ? await this.businesses.findById(businessId).select('_id ownerId').lean() : null;
    if (!business) throw new NotFoundException('Business not found');
    if (!ADMIN_ROLES.includes(user.role) && String(business.ownerId) !== user.userId) {
      throw new ForbiddenException('You do not manage this business');
    }
    return business;
  }
}
