import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BusinessStatus } from '../../common/enums';
import { ACTIVE_IMPORT_JOB_STATUSES, AuditAction, DomainAuthorisationStatus, OptOutSource } from '../../common/scraper.enums';
import { Business, BusinessDocument } from '../../schemas/business.schema';
import { DomainOptOut, DomainOptOutDocument } from '../../schemas/domain-opt-out.schema';
import { ImportJob, ImportJobDocument } from '../../schemas/import-job.schema';
import { Offer, OfferDocument } from '../../schemas/offer.schema';
import { ScrapedWebsite, ScrapedWebsiteDocument } from '../../schemas/scraped-website.schema';
import { AuditService } from '../audit/audit.service';
import { OfferLifecycleService } from '../lifecycle/offer-lifecycle.service';
import { RunsService } from '../queue/runs.service';
import { RetentionService } from '../retention/retention.service';
import { OPTED_OUT_MATCH_FIELDS } from '../scraper.constants';
import { siteDomainOf } from '../safety/url';

export interface NewOptOut {
  domain: string;
  reason?: string;
  source: OptOutSource;
  createdBy?: string;
  requestedBy?: { name?: string; email?: string };
  relatedListing?: { offerId?: Types.ObjectId; businessId?: Types.ObjectId };
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Domain opt-outs (spec §3) and public removal requests (spec §2.5). Both unpublish the domain's imported
 * offers immediately, stop crawling, and notify admins through the unacknowledged opt-out queue.
 */
@Injectable()
export class OptOutsService {
  constructor(
    @InjectModel(DomainOptOut.name) private readonly optOuts: Model<DomainOptOutDocument>,
    @InjectModel(ScrapedWebsite.name) private readonly sites: Model<ScrapedWebsiteDocument>,
    @InjectModel(Offer.name) private readonly offers: Model<OfferDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(ImportJob.name) private readonly jobs: Model<ImportJobDocument>,
    private readonly lifecycle: OfferLifecycleService,
    private readonly runs: RunsService,
    private readonly audit: AuditService,
    private readonly retention: RetentionService,
  ) {}

  async create(input: NewOptOut) {
    const domain = siteDomainOf(input.domain);
    if (!domain.includes('.')) throw new BadRequestException('Enter a domain such as example.co.uk');

    let optOut = await this.optOuts.findOne({ activeKey: domain });
    if (!optOut) {
      try {
        optOut = await this.optOuts.create({
          domain,
          activeKey: domain,
          reason: input.reason,
          source: input.source,
          createdBy: input.createdBy ? new Types.ObjectId(input.createdBy) : undefined,
          requestedBy: input.requestedBy,
          relatedListing: input.relatedListing,
        });
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err;
        optOut = (await this.optOuts.findOne({ activeKey: domain }))!;
      }
    }

    // The domain and every subdomain.
    const sites = await this.sites.find({ domain: new RegExp(`(^|\\.)${escapeRegex(domain)}$`) }).select('_id domain').lean();
    const siteIds = sites.map((s) => s._id);
    if (siteIds.length) {
      await this.sites.updateMany(
        { _id: { $in: siteIds } },
        { $set: { authorisationStatus: DomainAuthorisationStatus.OPTED_OUT }, $unset: { ...OPTED_OUT_MATCH_FIELDS, robotsOverride: 1 } },
      );
      const active = await this.jobs.distinct('runId', { scrapedWebsiteRef: { $in: siteIds }, status: { $in: ACTIVE_IMPORT_JOB_STATUSES } });
      for (const runId of active) await this.runs.cancelRun(String(runId));
    }
    const removal = await this.lifecycle.removeImportedOffersForSites(siteIds, input.source === OptOutSource.PUBLIC_FORM ? 'Removal requested' : 'Opted out');
    const builderOutput = await this.retention.redactTemplateExamplesFor(sites.map((s) => s.domain));

    // Listings that exist only because of the import are hidden until an admin reviews them.
    const hidden = await this.businesses.updateMany(
      { 'importSource.scrapedWebsiteRef': { $in: siteIds }, ownerId: { $exists: false }, status: BusinessStatus.ACTIVE },
      { $set: { status: BusinessStatus.SUSPENDED } },
    );

    await this.audit.record({
      action: input.source === OptOutSource.PUBLIC_FORM ? AuditAction.REMOVAL_REQUESTED : AuditAction.OPT_OUT_ADDED,
      targetType: 'DomainOptOut',
      targetId: optOut._id,
      after: { domain, websites: sites.map((s) => s.domain), offersRemoved: removal.removed, listingsHidden: hidden.modifiedCount, ...builderOutput },
      note: input.reason,
    });
    return { optOut, websites: sites.length, offersRemoved: removal.removed, listingsHidden: hidden.modifiedCount };
  }

  // Public form: resolves the listing to its source domain; responds the same whether or not it exists.
  async requestRemoval(input: { offerId?: string; businessSlug?: string; name?: string; email: string; reason: string }) {
    const domains = new Set<string>();
    let relatedListing: NewOptOut['relatedListing'];
    if (input.offerId && Types.ObjectId.isValid(input.offerId)) {
      const offer = await this.offers.findById(input.offerId).select('scrapedWebsiteRef sourceDomain businessId').lean();
      if (offer) relatedListing = { offerId: offer._id, businessId: offer.businessId };
      if (offer?.scrapedWebsiteRef) {
        const domain = offer.sourceDomain ?? (await this.sites.findById(offer.scrapedWebsiteRef).select('domain').lean())?.domain;
        if (domain) domains.add(domain);
      }
    } else if (input.businessSlug) {
      const business = await this.businesses.findOne({ slug: input.businessSlug }).select('_id importSource').lean();
      if (business) {
        relatedListing = { businessId: business._id };
        if (business.importSource?.domain) domains.add(business.importSource.domain);
        // A listing the business already had can still carry offers imported from its website.
        const sources = await this.offers.distinct('sourceDomain', { businessId: business._id, sourceDomain: { $type: 'string' } });
        for (const domain of sources) domains.add(domain as string);
      }
    }

    for (const domain of domains) {
      await this.create({
        domain,
        reason: input.reason,
        source: OptOutSource.PUBLIC_FORM,
        requestedBy: { name: input.name, email: input.email },
        relatedListing,
      });
    }
    if (domains.size === 0) {
      // Nothing imported to remove, but a person asked: keep a record admins can follow up.
      await this.audit.record({
        action: AuditAction.REMOVAL_REQUESTED,
        targetType: relatedListing?.offerId ? 'Offer' : relatedListing?.businessId ? 'Business' : 'RemovalRequest',
        targetId: relatedListing?.offerId ?? relatedListing?.businessId,
        after: { matchedImport: false, offerId: input.offerId, businessSlug: input.businessSlug, requestedBy: { name: input.name, email: input.email } },
        note: input.reason,
      });
    }
    return { received: true };
  }

  list(filter: { active?: boolean; unacknowledged?: boolean; limit?: number }) {
    const query: Record<string, unknown> = {};
    if (filter.active) query.activeKey = { $type: 'string' };
    if (filter.unacknowledged) Object.assign(query, { source: OptOutSource.PUBLIC_FORM, acknowledgedAt: { $exists: false } });
    return this.optOuts.find(query).sort({ createdAt: -1 }).limit(Math.min(200, filter.limit ?? 100)).populate('createdBy acknowledgedBy liftedBy', 'name email').lean();
  }

  unacknowledgedCount() {
    return this.optOuts.countDocuments({ source: OptOutSource.PUBLIC_FORM, acknowledgedAt: { $exists: false } });
  }

  async acknowledge(id: string, userId: string) {
    const optOut = await this.find(id);
    optOut.set({ acknowledgedBy: new Types.ObjectId(userId), acknowledgedAt: new Date() });
    await optOut.save();
    await this.audit.record({ action: AuditAction.OPT_OUT_ACKNOWLEDGED, targetType: 'DomainOptOut', targetId: optOut._id });
    return optOut;
  }

  // Lifting allows crawling again only after an admin re-authorises the website; removed offers stay removed.
  async lift(id: string, userId: string) {
    const optOut = await this.find(id);
    if (!optOut.activeKey) throw new BadRequestException('This opt-out has already been lifted');
    optOut.set({ liftedBy: new Types.ObjectId(userId), liftedAt: new Date(), activeKey: undefined });
    await optOut.save();
    await this.audit.record({ action: AuditAction.OPT_OUT_LIFTED, targetType: 'DomainOptOut', targetId: optOut._id, after: { domain: optOut.domain } });
    return optOut;
  }

  private async find(id: string) {
    const optOut = Types.ObjectId.isValid(id) ? await this.optOuts.findById(id) : null;
    if (!optOut) throw new NotFoundException('Opt-out not found');
    return optOut;
  }
}
