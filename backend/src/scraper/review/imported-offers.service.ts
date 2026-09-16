import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { OfferStatus, PUBLIC_OFFER_STATUSES } from '../../common/enums';
import { OfferManagedBy, OfferOrigin, OfferRevisionStatus } from '../../common/scraper.enums';
import { Business, BusinessDocument } from '../../schemas/business.schema';
import { OfferRevision, OfferRevisionDocument } from '../../schemas/offer-revision.schema';
import { Offer, OfferDocument } from '../../schemas/offer.schema';
import { ScrapedWebsite, ScrapedWebsiteDocument } from '../../schemas/scraped-website.schema';
import { RECHECK } from '../scraper.constants';

// What an admin works through after a recheck (spec §9): hidden offers, expiry decisions, changed terms,
// websites that stopped answering, and offers a business was told about.
export type ImportedOfferState = 'possibly_removed' | 'expiry_review' | 'revision_pending' | 'stale' | 'source_changed';

const CHECKED = [...PUBLIC_OFFER_STATUSES, OfferStatus.POSSIBLY_REMOVED];

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class ImportedOffersService {
  constructor(
    @InjectModel(Offer.name) private readonly offers: Model<OfferDocument>,
    @InjectModel(OfferRevision.name) private readonly revisions: Model<OfferRevisionDocument>,
    @InjectModel(ScrapedWebsite.name) private readonly sites: Model<ScrapedWebsiteDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
  ) {}

  private query(state: ImportedOfferState, now: Date): Record<string, unknown> {
    const staleBefore = new Date(now.getTime() - RECHECK.staleAfterDays * 24 * 60 * 60 * 1000);
    switch (state) {
      case 'possibly_removed':
        return { origin: OfferOrigin.SCRAPER, status: OfferStatus.POSSIBLY_REMOVED };
      case 'expiry_review':
        return { origin: OfferOrigin.SCRAPER, status: OfferStatus.EXPIRY_REVIEW };
      case 'revision_pending':
        return { origin: OfferOrigin.SCRAPER, status: OfferStatus.REVISION_PENDING };
      case 'source_changed':
        return { origin: OfferOrigin.SCRAPER, sourceChanged: true, status: { $in: CHECKED } };
      case 'stale':
        // Published, but the website hasn't been read successfully for a week.
        return {
          origin: OfferOrigin.SCRAPER,
          managedBy: OfferManagedBy.SCRAPER,
          status: { $in: CHECKED },
          $or: [{ lastCheckedAt: { $lt: staleBefore } }, { lastCheckedAt: { $exists: false } }],
        };
    }
  }

  async list(filter: { state: ImportedOfferState; q?: string; page?: number; limit?: number }, now = new Date()) {
    const query = this.query(filter.state, now);
    if (filter.q) query.$and = [{ $or: [{ title: new RegExp(escape(filter.q), 'i') }, { sourceDomain: new RegExp(escape(filter.q), 'i') }] }];
    const limit = Math.min(100, filter.limit ?? 25);
    const page = Math.max(1, filter.page ?? 1);
    const [items, total] = await Promise.all([
      this.offers
        .find(query)
        .select('title displayLabel status sourceDomain lastCheckedAt lastSeenAt absentChecks recheckStateAt endsAt verification managedBy sourceChanged businessId scrapedWebsiteRef')
        .sort({ recheckStateAt: -1, updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('businessId', 'name slug town')
        .lean(),
      this.offers.countDocuments(query),
    ]);
    const pending = await this.revisions
      .find({ offerRef: { $in: items.map((o) => o._id) }, status: OfferRevisionStatus.PENDING })
      .select('offerRef changedFields lastDetectedAt detectionCount')
      .lean();
    return {
      items: items.map((offer) => ({ ...offer, revision: pending.find((r) => String(r.offerRef) === String(offer._id)) ?? null })),
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  async counts(now = new Date()) {
    const states: ImportedOfferState[] = ['possibly_removed', 'expiry_review', 'revision_pending', 'stale', 'source_changed'];
    const counts = await Promise.all(states.map((state) => this.offers.countDocuments(this.query(state, now))));
    return Object.fromEntries(states.map((state, i) => [state, counts[i]])) as Record<ImportedOfferState, number>;
  }

  async detail(id: string) {
    const offer = Types.ObjectId.isValid(id) ? await this.offers.findOne({ _id: id, origin: OfferOrigin.SCRAPER }).lean() : null;
    if (!offer) throw new NotFoundException('Imported offer not found');
    const [business, website, revisions] = await Promise.all([
      this.businesses.findById(offer.businessId).select('name slug town postcode phone ownerId verificationStatus').lean(),
      offer.scrapedWebsiteRef
        ? this.sites.findById(offer.scrapedWebsiteRef).select('domain authorisationStatus adapterId adapterVersion nextCheckAt lastSuccessfulCheckAt lastFailedCheckAt lastError failureCount').lean()
        : null,
      this.revisions.find({ offerRef: offer._id }).sort({ createdAt: -1 }).populate('reviewedBy', 'name email').lean(),
    ]);
    return { offer, business, website, revisions };
  }

  async listRevisions(filter: { status?: OfferRevisionStatus; offerId?: string; page?: number; limit?: number }) {
    const query: Record<string, unknown> = { status: filter.status ?? OfferRevisionStatus.PENDING };
    if (filter.offerId && Types.ObjectId.isValid(filter.offerId)) query.offerRef = new Types.ObjectId(filter.offerId);
    const limit = Math.min(100, filter.limit ?? 25);
    const page = Math.max(1, filter.page ?? 1);
    const [items, total] = await Promise.all([
      this.revisions
        .find(query)
        .sort({ lastDetectedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('offerRef', 'title status sourceDomain verification managedBy endsAt')
        .populate('businessRef', 'name slug')
        .lean(),
      this.revisions.countDocuments(query),
    ]);
    return { items, total, page, pages: Math.ceil(total / limit) };
  }

  async revision(id: string) {
    const revision = Types.ObjectId.isValid(id)
      ? await this.revisions.findById(id).populate('businessRef', 'name slug town').populate('reviewedBy', 'name email').lean()
      : null;
    if (!revision) throw new NotFoundException('Revision not found');
    const offer = await this.offers.findById(revision.offerRef).lean();
    return { revision, offer };
  }
}
