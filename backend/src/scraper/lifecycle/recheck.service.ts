import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Actor, ActorContext } from '../../common/actor-context';
import { LIVE_OFFER_STATUSES, OfferStatus, PUBLIC_OFFER_STATUSES } from '../../common/enums';
import { recountActiveOffers } from '../../common/offer-counts';
import { ActorKind, DomainAuthorisationStatus, OfferManagedBy, OfferOrigin, OfferRevisionStatus, ScraperAdapterStatus } from '../../common/scraper.enums';
import { Business, BusinessDocument } from '../../schemas/business.schema';
import { DomainCrawlConfig, DomainCrawlConfigDocument } from '../../schemas/domain-crawl-config.schema';
import { RECHECK_COMPONENT } from '../../schemas/offer-lifecycle.guard';
import { OfferRevision, OfferRevisionDocument } from '../../schemas/offer-revision.schema';
import { Offer, OfferDocument } from '../../schemas/offer.schema';
import { ScrapedWebsite, ScrapedWebsiteDocument } from '../../schemas/scraped-website.schema';
import { ScraperAdapter, ScraperAdapterDocument } from '../../schemas/scraper-adapter.schema';
import type { OfferExtraction } from '../extraction/adapter.types';
import { pageKey, registrableDomainOf } from '../safety/url';
import { RECHECK, RETENTION } from '../scraper.constants';
import { MERCHANT_MANAGED_FILTER } from './merchant-management';
import { changedRevisionFields, revisionValuesOf, revisionValuesOfExtraction } from './offer-mapping';
import {
  CheckEvidence,
  checkOutcome,
  nextCheckAfterFailure,
  nextCheckAfterSuccess,
  RECHECKED_STATUSES,
  recheckTransition,
} from './recheck-rules';

const RECHECK_ACTOR: Actor = { kind: ActorKind.SYSTEM, component: RECHECK_COMPONENT };
const DAY_MS = 24 * 60 * 60 * 1000;
// Published or hidden only while a recheck confirms it: what the next check is scheduled around.
const CHECKED_FOR_SCHEDULE = [...PUBLIC_OFFER_STATUSES, OfferStatus.POSSIBLY_REMOVED];

export type RevisionProposal = 'opened' | 'updated' | 'no_change' | 'previously_discarded' | 'not_applicable';

function safePageKey(url: string): string | null {
  try {
    return pageKey(url);
  } catch {
    return null;
  }
}

/**
 * Spec §9/§10 automation in the worker: revisions for changed terms, the recheck transitions applied at the
 * end of every run, check scheduling and expiry of stale imported offers. Everything runs as the recheck
 * component, which the Offer lifecycle guard allows only the transitions between already-published states.
 */
@Injectable()
export class RecheckService {
  private readonly logger = new Logger(RecheckService.name);

  constructor(
    @InjectModel(Offer.name) private readonly offers: Model<OfferDocument>,
    @InjectModel(OfferRevision.name) private readonly revisions: Model<OfferRevisionDocument>,
    @InjectModel(ScrapedWebsite.name) private readonly sites: Model<ScrapedWebsiteDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(DomainCrawlConfig.name) private readonly configs: Model<DomainCrawlConfigDocument>,
    @InjectModel(ScraperAdapter.name) private readonly adapters: Model<ScraperAdapterDocument>,
  ) {}

  // ---------- changed terms ----------

  /** A run found a published, scraper-managed offer with different terms: open or update its revision. */
  proposeRevision(offerId: Types.ObjectId, extraction: OfferExtraction, runRef: Types.ObjectId, domain: string): Promise<RevisionProposal> {
    return ActorContext.run(RECHECK_ACTOR, async () => {
      const offer = await this.offers.findById(offerId).lean();
      if (!offer || offer.origin !== OfferOrigin.SCRAPER || offer.managedBy !== OfferManagedBy.SCRAPER || !RECHECKED_STATUSES.includes(offer.status)) {
        return 'not_applicable';
      }
      const previous = revisionValuesOf(offer);
      const proposedValues = revisionValuesOfExtraction({ ...extraction.offer, flags: extraction.flags });
      const changedFields = changedRevisionFields(previous, proposedValues);
      if (changedFields.length === 0) return 'no_change';
      const fingerprint = extraction.offer.contentFingerprint;
      // An admin already chose to keep the published version over exactly this change.
      if (await this.revisions.exists({ offerRef: offer._id, status: OfferRevisionStatus.DISCARDED, proposedFingerprint: fingerprint })) {
        return 'previously_discarded';
      }

      const { sources, evidence, ...proposed } = extraction.offer;
      const now = new Date();
      const update = {
        $set: {
          businessRef: offer.businessId,
          scrapedWebsiteRef: offer.scrapedWebsiteRef,
          domain,
          previous,
          proposedValues,
          changedFields,
          proposed: { ...proposed, flags: extraction.flags },
          proposedFingerprint: fingerprint,
          sources,
          evidence,
          runRef,
          lastDetectedAt: now,
        },
        $setOnInsert: { firstDetectedAt: now },
        $inc: { detectionCount: 1 },
      };
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await this.revisions.findOneAndUpdate({ offerRef: offer._id, status: OfferRevisionStatus.PENDING }, update, {
            upsert: true,
            new: true,
            includeResultMetadata: true,
          });
          return result.lastErrorObject?.updatedExisting ? 'updated' : 'opened';
        } catch (err) {
          // Two runs opening the same revision at once: the second updates the first.
          if ((err as { code?: number }).code !== 11000 || attempt > 0) throw err;
        }
      }
    });
  }

  /** Merchant-managed offers are never changed by rechecks; the business sees that its website changed. */
  flagSourceChanged(offerId: Types.ObjectId): Promise<void> {
    return ActorContext.run(RECHECK_ACTOR, async () => {
      await this.offers.updateOne({ _id: offerId }, { $set: { sourceChanged: true } });
    });
  }

  // ---------- recheck_offer ----------

  /**
   * The check a completed run made of its website, applied to the offers published from it (spec §9), and the
   * next check scheduled (spec §10).
   */
  applyCheck(siteId: Types.ObjectId, evidence: CheckEvidence, revisedOfferIds: ReadonlySet<string>, checkedAt: Date) {
    return ActorContext.run(RECHECK_ACTOR, async () => {
      const counts = { checked: 0, seen: 0, absent: 0, inconclusive: 0, republished: 0, possiblyRemoved: 0, expiryReview: 0, revisionPending: 0, revisionsSuperseded: 0, merchantFlagged: 0 };
      const site = await this.sites.findById(siteId).lean();
      if (!site) return counts;

      const offers = await this.offers
        .find({ scrapedWebsiteRef: site._id, origin: OfferOrigin.SCRAPER, status: { $in: RECHECKED_STATUSES } })
        .select('_id businessId status managedBy absentChecks sources endsAt')
        .lean();
      const pending = new Set(
        (await this.revisions.find({ offerRef: { $in: offers.map((o) => o._id) }, status: OfferRevisionStatus.PENDING }).distinct('offerRef')).map(String),
      );
      const changedBusinesses = new Set<string>();
      const now = new Date();

      for (const offer of offers) {
        const id = String(offer._id);
        const outcome = checkOutcome({ id, sourcePages: offer.sources.map((s) => safePageKey(s.url)).filter((k): k is string => !!k) }, evidence);
        counts.checked++;
        counts[outcome === 'seen' ? 'seen' : outcome === 'absent' ? 'absent' : 'inconclusive']++;

        // Seen with the published terms again: the website went back, so the change waiting for review is moot.
        if (outcome === 'seen' && pending.has(id) && !revisedOfferIds.has(id) && offer.managedBy === OfferManagedBy.SCRAPER) {
          await this.closeRevisions([offer._id], 'The website shows the published terms again', now);
          pending.delete(id);
          counts.revisionsSuperseded++;
        }

        const change = recheckTransition({ status: offer.status, managedBy: offer.managedBy, absentChecks: offer.absentChecks ?? 0, hasOpenRevision: pending.has(id) }, outcome);
        if (change.kind === 'none') continue;
        if (change.kind === 'flag_merchant') {
          await this.offers.updateOne({ _id: offer._id, ...MERCHANT_MANAGED_FILTER }, { $set: { sourceChanged: true } });
          counts.merchantFlagged++;
          continue;
        }

        const set: Record<string, unknown> = { lastCheckedAt: checkedAt };
        if (change.kind === 'seen') Object.assign(set, { absentChecks: 0, lastSeenAt: checkedAt });
        else set.absentChecks = change.absentChecks;
        if (change.status) Object.assign(set, { status: change.status, recheckStateAt: now });
        // The filter pins the state this decision was made from; the guard requires it for published states.
        const result = await this.offers.updateOne(
          { _id: offer._id, status: offer.status, origin: OfferOrigin.SCRAPER, managedBy: OfferManagedBy.SCRAPER },
          { $set: set },
        );
        if (!change.status || result.modifiedCount === 0) continue;
        changedBusinesses.add(String(offer.businessId));
        if (change.status === OfferStatus.POSSIBLY_REMOVED) counts.possiblyRemoved++;
        else if (change.status === OfferStatus.EXPIRY_REVIEW) counts.expiryReview++;
        else if (offer.status === OfferStatus.POSSIBLY_REMOVED) counts.republished++;
        if (change.status === OfferStatus.REVISION_PENDING) counts.revisionPending++;
      }

      for (const businessId of changedBusinesses) await recountActiveOffers(this.offers, this.businesses, businessId);
      await this.scheduleAfterSuccess(site._id, now);
      return counts;
    });
  }

  private async closeRevisions(offerIds: Types.ObjectId[], reason: string, now: Date) {
    if (offerIds.length === 0) return 0;
    const result = await this.revisions.updateMany(
      { offerRef: { $in: offerIds }, status: OfferRevisionStatus.PENDING },
      { $set: { status: OfferRevisionStatus.SUPERSEDED, closedReason: reason, excerptsRedactAfter: new Date(now.getTime() + RETENTION.excerptDays * DAY_MS) } },
    );
    return result.modifiedCount;
  }

  // ---------- scheduling ----------

  private async intervalHoursFor(site: Pick<ScrapedWebsite, 'domain' | 'registrableDomain' | 'adapterId'>): Promise<number | undefined> {
    const keys = [...new Set([site.domain, site.registrableDomain ?? registrableDomainOf(site.domain)])];
    const configs = await this.configs.find({ domain: { $in: keys }, recheckIntervalHours: { $exists: true } }).lean();
    const domainHours = keys.map((k) => configs.find((c) => c.domain === k)?.recheckIntervalHours).find((h) => h !== undefined);
    if (domainHours !== undefined) return domainHours;
    if (!site.adapterId) return undefined;
    const adapter = await this.adapters.findOne({ key: site.adapterId, recheckIntervalHours: { $exists: true } }).select('recheckIntervalHours').lean();
    return adapter?.recheckIntervalHours;
  }

  async scheduleAfterSuccess(siteId: Types.ObjectId, now = new Date()) {
    const site = await this.sites.findById(siteId).select('domain registrableDomain adapterId authorisationStatus').lean();
    if (!site) return;
    const published = await this.offers.find({ scrapedWebsiteRef: siteId, origin: OfferOrigin.SCRAPER, status: { $in: CHECKED_FOR_SCHEDULE } }).select('endsAt').lean();
    const nextCheckAt = nextCheckAfterSuccess(now, published, await this.intervalHoursFor(site));
    await this.sites.updateOne({ _id: siteId }, { $set: { nextCheckAt } });
  }

  // Spec §10: a failed check backs off 1h, 4h, 16h, 64h, then weekly.
  async scheduleAfterFailure(siteId: Types.ObjectId, now = new Date()) {
    const site = await this.sites.findById(siteId).select('failureCount').lean();
    if (!site) return;
    await this.sites.updateOne({ _id: siteId }, { $set: { nextCheckAt: nextCheckAfterFailure(now, site.failureCount ?? 1) } });
  }

  // ---------- review_stale_offer ----------

  async staleWork(now = new Date()): Promise<number> {
    const [stale, orphaned] = await Promise.all([
      this.offers.countDocuments({ origin: OfferOrigin.SCRAPER, status: { $in: CHECKED_FOR_SCHEDULE }, endsAt: { $ne: null, $lt: now } }),
      this.pendingRevisionsOfClosedOffers().then((ids) => ids.length),
    ]);
    return stale + orphaned;
  }

  private async pendingRevisionsOfClosedOffers(): Promise<Types.ObjectId[]> {
    const offerRefs = await this.revisions.find({ status: OfferRevisionStatus.PENDING }).distinct('offerRef');
    if (offerRefs.length === 0) return [];
    const closed = await this.offers.find({ _id: { $in: offerRefs }, status: { $nin: LIVE_OFFER_STATUSES } }).select('_id').lean();
    return closed.map((o) => o._id);
  }

  /** approved / possibly_removed / revision_pending -> expired once the end date has passed (spec §9). */
  reviewStaleOffers(now = new Date()) {
    return ActorContext.run(RECHECK_ACTOR, async () => {
      const stale = await this.offers
        .find({ origin: OfferOrigin.SCRAPER, status: { $in: CHECKED_FOR_SCHEDULE }, endsAt: { $ne: null, $lt: now } })
        .select('_id businessId status')
        .lean();
      const businesses = new Set<string>();
      let expired = 0;
      for (const offer of stale) {
        const result = await this.offers.updateOne({ _id: offer._id, status: offer.status }, { $set: { status: OfferStatus.EXPIRED, expiredAt: now } });
        if (result.modifiedCount) {
          expired++;
          businesses.add(String(offer.businessId));
        }
      }
      for (const businessId of businesses) await recountActiveOffers(this.offers, this.businesses, businessId);

      const revisionsClosed = await this.closeRevisions(await this.pendingRevisionsOfClosedOffers(), 'The offer is no longer published', now);
      const [awaitingExpiryReview, possiblyRemoved] = await Promise.all([
        this.offers.countDocuments({ origin: OfferOrigin.SCRAPER, status: OfferStatus.EXPIRY_REVIEW }),
        this.offers.countDocuments({ origin: OfferOrigin.SCRAPER, status: OfferStatus.POSSIBLY_REMOVED }),
      ]);
      if (expired || revisionsClosed) this.logger.log(`Expired ${expired} imported offer(s); closed ${revisionsClosed} revision(s)`);
      return { expired, revisionsClosed, awaitingExpiryReview, possiblyRemoved };
    });
  }

  // Due websites for the scheduler: authorised, not paused, with a check due.
  async dueWebsites(now: Date, limit: number) {
    const paused = await this.configs.find({ paused: true }).distinct('domain');
    const pausedAdapters = await this.adapters.find({ status: ScraperAdapterStatus.PAUSED, isCurrent: { $ne: false } }).distinct('key');
    return this.sites
      .find({
        authorisationStatus: DomainAuthorisationStatus.AUTHORISED,
        nextCheckAt: { $lte: now },
        domain: { $nin: paused },
        registrableDomain: { $nin: paused },
        adapterId: { $nin: pausedAdapters },
      })
      .sort({ nextCheckAt: 1 })
      .limit(limit)
      .select('_id domain seedUrl')
      .lean();
  }

  async markScheduled(siteId: Types.ObjectId, now = new Date()) {
    await this.sites.updateOne({ _id: siteId }, { $set: { nextCheckAt: new Date(now.getTime() + RECHECK.provisionalHours * 60 * 60 * 1000) } });
  }
}
