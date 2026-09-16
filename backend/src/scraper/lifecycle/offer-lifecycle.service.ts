import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ActorContext } from '../../common/actor-context';
import { LIVE_OFFER_STATUSES, OfferStatus, VerificationStatus } from '../../common/enums';
import { recountActiveOffers } from '../../common/offer-counts';
import {
  ActorKind,
  AuditAction,
  CandidateStatus,
  ConfidenceBand,
  DuplicateKind,
  OfferManagedBy,
  OfferOrigin,
  OfferRevisionStatus,
  OfferVerification,
  RESOLVED_BRANCH_STATUSES,
} from '../../common/scraper.enums';
import { Business, BusinessDocument } from '../../schemas/business.schema';
import {
  ExtractedOfferCandidate,
  ExtractedOfferCandidateDocument,
} from '../../schemas/extracted-offer-candidate.schema';
import { OfferRevision, OfferRevisionDocument } from '../../schemas/offer-revision.schema';
import { Offer, OfferDocument } from '../../schemas/offer.schema';
import { ScrapedWebsite, ScrapedWebsiteDocument } from '../../schemas/scraped-website.schema';
import { AuditService } from '../audit/audit.service';
import type { ExtractedOffer } from '../extraction/adapter.types';
import { validateExtractedOffer } from '../extraction/validate-offer';
import { RECHECK, RETENTION } from '../scraper.constants';
import { PublishableOffer, publishedFieldsOf } from './offer-mapping';

const AUTO_LIVE_VERIFICATION = [
  VerificationStatus.VERIFIED,
  VerificationStatus.FOODBELL_VERIFIED,
  VerificationStatus.TRUSTED_PARTNER,
  VerificationStatus.FRANCHISE_VERIFIED,
];

function redactedSources(sources: { url: string; pageTitle?: string; checkedAt: Date }[]) {
  return sources.map((s) => ({ url: s.url, pageTitle: s.pageTitle, checkedAt: s.checkedAt, excerpt: '' }));
}

type Reviewer = { userId: string };

/**
 * The only code that publishes, verifies, merges into or removes imported offers. Every write runs in
 * the caller's actor context, so the Offer lifecycle guard rejects anything not done by an admin or merchant.
 */
@Injectable()
export class OfferLifecycleService {
  constructor(
    @InjectModel(Offer.name) private readonly offers: Model<OfferDocument>,
    @InjectModel(ExtractedOfferCandidate.name) private readonly candidates: Model<ExtractedOfferCandidateDocument>,
    @InjectModel(ScrapedWebsite.name) private readonly sites: Model<ScrapedWebsiteDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    private readonly audit: AuditService,
    @InjectModel(OfferRevision.name) private readonly revisions: Model<OfferRevisionDocument>,
  ) {}

  private async loadCandidate(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Candidate not found');
    const candidate = await this.candidates.findById(id);
    if (!candidate) throw new NotFoundException('Candidate not found');
    return candidate;
  }

  // The resolved business for each branch the candidate applies to; throws if any is unresolved.
  private async resolveBranches(candidate: ExtractedOfferCandidateDocument, branchPaths = candidate.branchPaths) {
    const site = await this.sites.findById(candidate.scrapedWebsiteRef).lean();
    if (!site) throw new NotFoundException('Website not found');
    const resolved = branchPaths.map((path) => {
      const branch = site.businesses.find((b) => b.branchPath === path);
      if (!branch?.businessRef || !RESOLVED_BRANCH_STATUSES.includes(branch.matchStatus)) {
        throw new BadRequestException(`Resolve the business for branch ${path} before publishing`);
      }
      return { path, businessId: branch.businessRef };
    });
    return { site, resolved };
  }

  private assertPublishable(candidate: ExtractedOfferCandidateDocument) {
    if (candidate.confidenceBand === ConfidenceBand.FAILED || candidate.confidenceScore < 40) {
      throw new BadRequestException('Extractions scoring below 40 cannot be published');
    }
    const validation = validateExtractedOffer(candidate.toObject() as unknown as ExtractedOffer, new Date());
    if (!validation.valid) throw new BadRequestException(validation.errors.join('; '));
  }

  private offerFields(candidate: ExtractedOfferCandidateDocument, business: Pick<Business, 'orderUrl' | 'website'>, siteDomain: string) {
    const c = candidate.toObject() as ExtractedOfferCandidate & { _id: Types.ObjectId };
    return { ...publishedFieldsOf(c as unknown as PublishableOffer, business, siteDomain), candidateRef: c._id, scrapedWebsiteRef: c.scrapedWebsiteRef };
  }

  // Spec §9: candidate -> approved (published, unverified | admin_verified).
  async approveCandidate(
    candidateId: string,
    options: { verification: OfferVerification.UNVERIFIED | OfferVerification.ADMIN_VERIFIED; branchPaths?: string[]; note?: string },
    reviewer: Reviewer,
  ) {
    const candidate = await this.loadCandidate(candidateId);
    if (![CandidateStatus.PENDING_REVIEW, CandidateStatus.AWAITING_MERCHANT_CONFIRMATION].includes(candidate.status)) {
      throw new BadRequestException(`A ${candidate.status} candidate cannot be approved`);
    }
    if (candidate.duplicate?.kind === DuplicateKind.CHANGED_TERMS) {
      throw new BadRequestException('This updates an offer that is already live: merge it into that offer instead');
    }
    this.assertPublishable(candidate);
    const paths = options.branchPaths?.length ? options.branchPaths.filter((p) => candidate.branchPaths.includes(p)) : candidate.branchPaths;
    if (paths.length === 0) throw new BadRequestException('Choose at least one of the candidate’s branches');
    const { site, resolved } = await this.resolveBranches(candidate, paths);

    const published: Types.ObjectId[] = [];
    for (const { businessId } of resolved) {
      const business = await this.businesses.findById(businessId).lean();
      if (!business) throw new NotFoundException('Business not found');
      const fields = this.offerFields(candidate, business, site.domain);
      const live = await this.offers.findOne({ dedupeKey: `${String(businessId)}:${candidate.contentFingerprint}` });
      if (live) {
        // Already live for this business: link, never duplicate.
        published.push(live._id);
        continue;
      }
      const offer = await this.offers.create({
        ...fields,
        businessId,
        status: OfferStatus.ACTIVE,
        origin: OfferOrigin.SCRAPER,
        verification: options.verification,
        managedBy: OfferManagedBy.SCRAPER,
      });
      published.push(offer._id);
      await recountActiveOffers(this.offers, this.businesses, businessId);
    }
    if (published.length) await this.checkWithinADay(site._id);

    const before = { status: candidate.status };
    candidate.set({
      status: CandidateStatus.APPROVED,
      reviewedBy: new Types.ObjectId(reviewer.userId),
      reviewedAt: new Date(),
      reviewNote: options.note,
      approvedOfferRefs: [...new Set([...candidate.approvedOfferRefs.map(String), ...published.map(String)])].map((id) => new Types.ObjectId(id)),
    });
    await candidate.save();
    await this.audit.record({
      action: AuditAction.CANDIDATE_APPROVED,
      targetType: 'ExtractedOfferCandidate',
      targetId: candidate._id,
      before,
      after: { status: candidate.status, verification: options.verification, offers: published.map(String), branchPaths: paths },
      note: options.note,
    });
    return { candidate, offerIds: published };
  }

  // Applies a changed-terms candidate to the live offer it updates.
  async mergeIntoOffer(candidateId: string, options: { verification: OfferVerification.UNVERIFIED | OfferVerification.ADMIN_VERIFIED }, reviewer: Reviewer) {
    const candidate = await this.loadCandidate(candidateId);
    const offerId = candidate.duplicate?.offerRef;
    if (!offerId) throw new BadRequestException('This candidate does not update an existing offer');
    if (![CandidateStatus.PENDING_REVIEW, CandidateStatus.AWAITING_MERCHANT_CONFIRMATION].includes(candidate.status)) {
      throw new BadRequestException(`A ${candidate.status} candidate cannot be merged`);
    }
    this.assertPublishable(candidate);
    const offer = await this.offers.findById(offerId);
    if (!offer) throw new NotFoundException('The offer this candidate updates no longer exists');
    if (!LIVE_OFFER_STATUSES.includes(offer.status)) {
      throw new BadRequestException(`The earlier offer is ${offer.status}; approve this as a new offer instead`);
    }
    if (offer.managedBy === OfferManagedBy.MERCHANT || offer.origin === OfferOrigin.MERCHANT) {
      throw new ForbiddenException('The business manages this offer; it can only be flagged for their review');
    }
    const site = await this.sites.findById(candidate.scrapedWebsiteRef).lean();
    const business = await this.businesses.findById(offer.businessId).lean();
    const before = offer.toObject();
    offer.set({ ...this.offerFields(candidate, business ?? {}, site?.domain ?? candidate.domain), verification: options.verification });
    await offer.save();
    await recountActiveOffers(this.offers, this.businesses, offer.businessId);
    if (site) await this.checkWithinADay(site._id);

    candidate.set({
      status: CandidateStatus.MERGED,
      reviewedBy: new Types.ObjectId(reviewer.userId),
      reviewedAt: new Date(),
      approvedOfferRefs: [offer._id],
    });
    await candidate.save();
    await this.audit.record({
      action: AuditAction.CANDIDATE_MERGED,
      targetType: 'Offer',
      targetId: offer._id,
      before: { title: before.title, value: before.value, code: before.code, minOrder: before.minOrder, endsAt: before.endsAt, verification: before.verification },
      after: { title: offer.title, value: offer.value, code: offer.code, minOrder: offer.minOrder, endsAt: offer.endsAt, verification: offer.verification, candidate: String(candidate._id) },
    });
    return offer;
  }

  // Folds a duplicate candidate into another open candidate.
  async mergeIntoCandidate(candidateId: string, targetId: string, reviewer: Reviewer) {
    if (candidateId === targetId) throw new BadRequestException('A candidate cannot be merged into itself');
    const [candidate, target] = await Promise.all([this.loadCandidate(candidateId), this.loadCandidate(targetId)]);
    const open = [CandidateStatus.PENDING_REVIEW, CandidateStatus.AWAITING_MERCHANT_CONFIRMATION, CandidateStatus.NEEDS_REEXTRACTION];
    if (!open.includes(candidate.status) || !open.includes(target.status)) {
      throw new BadRequestException('Only candidates still awaiting review can be merged');
    }
    if (String(candidate.scrapedWebsiteRef) !== String(target.scrapedWebsiteRef)) {
      throw new BadRequestException('Only candidates from the same website can be merged');
    }
    const known = new Set(target.sources.map((s) => s.url));
    target.sources.push(...candidate.sources.filter((s) => !known.has(s.url)));
    target.set({ branchPaths: [...new Set([...target.branchPaths, ...candidate.branchPaths])].sort() });
    await target.save();
    candidate.set({ status: CandidateStatus.MERGED, mergedInto: target._id, reviewedBy: new Types.ObjectId(reviewer.userId), reviewedAt: new Date() });
    await candidate.save();
    await this.audit.record({
      action: AuditAction.CANDIDATE_MERGED,
      targetType: 'ExtractedOfferCandidate',
      targetId: candidate._id,
      after: { mergedInto: String(target._id) },
    });
    return target;
  }

  // A merchant confirms an offer found on their own website. Goes live under the platform's usual rule.
  async confirmCandidateAsMerchant(candidateId: string, businessId: string) {
    const actor = ActorContext.current();
    if (actor.kind !== ActorKind.MERCHANT) throw new ForbiddenException('Only the business can confirm this offer');
    const candidate = await this.loadCandidate(candidateId);
    if (candidate.status !== CandidateStatus.AWAITING_MERCHANT_CONFIRMATION) {
      throw new BadRequestException('This offer is not waiting for your confirmation');
    }
    const { site, resolved } = await this.resolveBranches(candidate);
    const branch = resolved.find((r) => String(r.businessId) === businessId);
    if (!branch) throw new ForbiddenException('This offer does not belong to your business');
    const business = await this.businesses.findById(businessId).lean();
    if (!business || String(business.ownerId) !== actor.userId) throw new ForbiddenException('You do not manage this business');
    this.assertPublishable(candidate);

    const live = AUTO_LIVE_VERIFICATION.includes(business.verificationStatus);
    const offer = await this.offers.create({
      ...this.offerFields(candidate, business, site.domain),
      businessId: business._id,
      status: live ? OfferStatus.ACTIVE : OfferStatus.PENDING,
      origin: OfferOrigin.SCRAPER,
      verification: OfferVerification.MERCHANT_VERIFIED,
      managedBy: OfferManagedBy.MERCHANT,
    });
    await recountActiveOffers(this.offers, this.businesses, business._id);

    const approvedOfferRefs = [...candidate.approvedOfferRefs, offer._id];
    const allDone = resolved.length <= approvedOfferRefs.length;
    candidate.set({
      approvedOfferRefs,
      status: allDone ? CandidateStatus.APPROVED : candidate.status,
      reviewedBy: new Types.ObjectId(actor.userId),
      reviewedAt: new Date(),
      reviewNote: 'Confirmed by the business',
    });
    await candidate.save();
    await this.audit.record({
      action: AuditAction.OFFER_MERCHANT_CONFIRMED,
      targetType: 'Offer',
      targetId: offer._id,
      after: { candidate: String(candidate._id), status: offer.status },
    });
    return offer;
  }

  async rejectCandidateAsMerchant(candidateId: string, businessId: string, reason?: string) {
    const actor = ActorContext.current();
    if (actor.kind !== ActorKind.MERCHANT) throw new ForbiddenException('Only the business can reject this offer');
    const candidate = await this.loadCandidate(candidateId);
    if (candidate.status !== CandidateStatus.AWAITING_MERCHANT_CONFIRMATION) {
      throw new BadRequestException('This offer is not waiting for your confirmation');
    }
    const { resolved } = await this.resolveBranches(candidate);
    const business = await this.businesses.findById(businessId).lean();
    if (!resolved.some((r) => String(r.businessId) === businessId) || String(business?.ownerId) !== actor.userId) {
      throw new ForbiddenException('This offer does not belong to your business');
    }
    candidate.set({
      status: CandidateStatus.REJECTED,
      reviewedBy: new Types.ObjectId(actor.userId),
      reviewedAt: new Date(),
      reviewNote: reason ? `Rejected by the business: ${reason}` : 'Rejected by the business',
      excerptsRedactAfter: new Date(Date.now() + RETENTION.excerptDays * 24 * 60 * 60 * 1000),
    });
    await candidate.save();
    await this.audit.record({ action: AuditAction.CANDIDATE_REJECTED, targetType: 'ExtractedOfferCandidate', targetId: candidate._id, note: candidate.reviewNote });
    return candidate;
  }

  // A merchant confirms an already-published imported offer as correct.
  async confirmOfferAsMerchant(offerId: string) {
    const actor = ActorContext.current();
    if (actor.kind !== ActorKind.MERCHANT) throw new ForbiddenException('Only the business can confirm this offer');
    const offer = Types.ObjectId.isValid(offerId) ? await this.offers.findById(offerId) : null;
    if (!offer) throw new NotFoundException('Offer not found');
    const business = await this.businesses.findById(offer.businessId).lean();
    if (!business || String(business.ownerId) !== actor.userId) throw new ForbiddenException('You do not manage this business');
    if (offer.origin !== OfferOrigin.SCRAPER) throw new BadRequestException('Only imported offers need confirming');
    offer.set({ verification: OfferVerification.MERCHANT_VERIFIED, managedBy: OfferManagedBy.MERCHANT, sourceChanged: false });
    await offer.save();
    await this.audit.record({ action: AuditAction.OFFER_MERCHANT_CONFIRMED, targetType: 'Offer', targetId: offer._id });
    return offer;
  }

  /**
   * Spec §2.5/§3: opt-outs and removal requests unpublish imported, scraper-managed offers at once and
   * redact their stored excerpts. Offers a merchant has taken over belong to the merchant and are left alone.
   */
  async removeImportedOffersForSites(siteIds: Types.ObjectId[], reason: string): Promise<{ removed: number; businesses: Types.ObjectId[] }> {
    const targets = await this.offers
      .find({ scrapedWebsiteRef: { $in: siteIds }, origin: OfferOrigin.SCRAPER, managedBy: OfferManagedBy.SCRAPER, status: { $ne: OfferStatus.REMOVED } })
      .select('_id businessId sources')
      .lean();
    const now = new Date();
    for (const offer of targets) {
      await this.offers.updateOne(
        { _id: offer._id, managedBy: OfferManagedBy.SCRAPER },
        {
          $set: {
            status: OfferStatus.REMOVED,
            removedAt: now,
            removedReason: reason,
            sources: redactedSources(offer.sources),
            evidence: {},
            excerptsRedactedAt: now,
          },
        },
      );
    }
    const businessIds = [...new Set(targets.map((o) => String(o.businessId)))].map((id) => new Types.ObjectId(id));
    for (const businessId of businessIds) await recountActiveOffers(this.offers, this.businesses, businessId);

    // Changes waiting for review on those offers are closed, and their page text goes with the offers'.
    const revisionsOpen = await this.revisions.find({ scrapedWebsiteRef: { $in: siteIds }, excerptsRedactedAt: { $exists: false } }).select('_id status sources').lean();
    for (const revision of revisionsOpen) {
      await this.revisions.updateOne(
        { _id: revision._id },
        {
          $set: {
            ...(revision.status === OfferRevisionStatus.PENDING ? { status: OfferRevisionStatus.SUPERSEDED, closedReason: reason } : {}),
            sources: redactedSources(revision.sources),
            evidence: {},
            excerptsRedactedAt: now,
          },
        },
      );
    }

    await this.candidates.updateMany(
      { scrapedWebsiteRef: { $in: siteIds }, status: { $in: [CandidateStatus.PENDING_REVIEW, CandidateStatus.AWAITING_MERCHANT_CONFIRMATION, CandidateStatus.NEEDS_REEXTRACTION, CandidateStatus.FAILED_EXTRACTION] } },
      { $set: { status: CandidateStatus.REJECTED, reviewNote: reason, reviewedAt: now } },
    );
    const withExcerpts = await this.candidates.find({ scrapedWebsiteRef: { $in: siteIds }, excerptsRedactedAt: { $exists: false } }).select('_id sources').lean();
    for (const candidate of withExcerpts) {
      await this.candidates.updateOne(
        { _id: candidate._id },
        { $set: { sources: redactedSources(candidate.sources), evidence: {}, excerptsRedactedAt: now } },
      );
    }
    await this.audit.record({
      action: AuditAction.OFFER_REMOVED,
      targetType: 'ScrapedWebsite',
      targetId: siteIds.map(String).join(','),
      after: { offersRemoved: targets.length, reason },
    });
    return { removed: targets.length, businesses: businessIds };
  }

  /** The business has seen the source change flagged by a recheck and is keeping its offer as it is. */
  async markSourceReviewed(offerId: string) {
    const actor = ActorContext.current();
    if (actor.kind !== ActorKind.MERCHANT) throw new ForbiddenException('Only the business can review this');
    const offer = Types.ObjectId.isValid(offerId) ? await this.offers.findById(offerId) : null;
    if (!offer) throw new NotFoundException('Offer not found');
    const business = await this.businesses.findById(offer.businessId).lean();
    if (!business || String(business.ownerId) !== actor.userId) throw new ForbiddenException('You do not manage this business');
    offer.set({ sourceChanged: false });
    await offer.save();
    return offer;
  }

  // A newly published imported offer is checked within a day, whatever the website's schedule was.
  private async checkWithinADay(siteId: Types.ObjectId) {
    const soon = new Date(Date.now() + RECHECK.activeOfferHours * 60 * 60 * 1000);
    await this.sites.updateOne({ _id: siteId, $or: [{ nextCheckAt: { $exists: false } }, { nextCheckAt: { $gt: soon } }] }, { $set: { nextCheckAt: soon } });
  }

  private async loadRevision(id: string) {
    const revision = Types.ObjectId.isValid(id) ? await this.revisions.findById(id) : null;
    if (!revision) throw new NotFoundException('Revision not found');
    if (revision.status !== OfferRevisionStatus.PENDING) throw new BadRequestException(`This revision is already ${revision.status}`);
    const offer = await this.offers.findById(revision.offerRef);
    if (!offer) throw new NotFoundException('The offer this revision changes no longer exists');
    return { revision, offer };
  }

  /** Spec §9: revision_pending -> approved, publishing the terms the website now shows. */
  async applyRevision(revisionId: string, options: { verification: OfferVerification.UNVERIFIED | OfferVerification.ADMIN_VERIFIED; note?: string }, reviewer: Reviewer) {
    const { revision, offer } = await this.loadRevision(revisionId);
    if (offer.managedBy === OfferManagedBy.MERCHANT || offer.origin !== OfferOrigin.SCRAPER) {
      throw new ForbiddenException('The business manages this offer; it can only be flagged for their review');
    }
    if (![OfferStatus.ACTIVE, OfferStatus.REVISION_PENDING, OfferStatus.POSSIBLY_REMOVED, OfferStatus.EXPIRY_REVIEW].includes(offer.status)) {
      throw new BadRequestException(`The offer is ${offer.status}; revisions apply only to published offers`);
    }
    const proposed = { ...(revision.proposed as object), sources: revision.sources, evidence: revision.evidence } as PublishableOffer;
    const validation = validateExtractedOffer(proposed as unknown as ExtractedOffer, new Date());
    if (!validation.valid) throw new BadRequestException(`The new terms can't be published as they are: ${validation.errors.join('; ')}`);

    const business = await this.businesses.findById(offer.businessId).lean();
    const before = { status: offer.status, verification: offer.verification, ...revision.previous };
    offer.set({
      ...publishedFieldsOf(proposed, business ?? {}, revision.domain ?? offer.sourceDomain ?? ''),
      verification: options.verification,
      status: OfferStatus.ACTIVE,
      absentChecks: 0,
      recheckStateAt: new Date(),
    });
    try {
      await offer.save();
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new ConflictException('Another live offer for this business already has these terms');
      throw err;
    }
    await recountActiveOffers(this.offers, this.businesses, offer.businessId);

    revision.set({
      status: OfferRevisionStatus.APPLIED,
      appliedVerification: options.verification,
      reviewedBy: new Types.ObjectId(reviewer.userId),
      reviewedAt: new Date(),
      reviewNote: options.note,
      excerptsRedactAfter: new Date(Date.now() + RETENTION.excerptDays * 24 * 60 * 60 * 1000),
    });
    await revision.save();
    await this.audit.record({
      action: AuditAction.REVISION_APPLIED,
      targetType: 'Offer',
      targetId: offer._id,
      before,
      after: { status: offer.status, verification: offer.verification, ...revision.proposedValues, revision: String(revision._id), changedFields: revision.changedFields },
      note: options.note,
    });
    return { offer, revision };
  }

  /** Spec §9: revision_pending -> approved, keeping the published terms. The same change isn't proposed again. */
  async discardRevision(revisionId: string, note: string | undefined, reviewer: Reviewer) {
    const { revision, offer } = await this.loadRevision(revisionId);
    revision.set({
      status: OfferRevisionStatus.DISCARDED,
      reviewedBy: new Types.ObjectId(reviewer.userId),
      reviewedAt: new Date(),
      reviewNote: note,
      excerptsRedactAfter: new Date(Date.now() + RETENTION.excerptDays * 24 * 60 * 60 * 1000),
    });
    await revision.save();
    if (offer.status === OfferStatus.REVISION_PENDING) {
      offer.set({ status: OfferStatus.ACTIVE, recheckStateAt: new Date() });
      await offer.save();
      await recountActiveOffers(this.offers, this.businesses, offer.businessId);
    }
    await this.audit.record({
      action: AuditAction.REVISION_DISCARDED,
      targetType: 'Offer',
      targetId: offer._id,
      after: { revision: String(revision._id), changedFields: revision.changedFields, status: offer.status },
      note,
    });
    return { offer, revision };
  }

  /** Spec §9: expiry_review -> expired or approved, decided by an admin. */
  async decideExpiryReview(offerId: string, decision: 'expire' | 'restore', note?: string) {
    const offer = Types.ObjectId.isValid(offerId) ? await this.offers.findById(offerId) : null;
    if (!offer || offer.origin !== OfferOrigin.SCRAPER) throw new NotFoundException('Imported offer not found');
    if (offer.status !== OfferStatus.EXPIRY_REVIEW) throw new BadRequestException(`The offer is ${offer.status}, not awaiting expiry review`);
    const now = new Date();
    if (decision === 'expire') {
      offer.set({ status: OfferStatus.EXPIRED, expiredAt: now, recheckStateAt: now });
      await this.revisions.updateMany(
        { offerRef: offer._id, status: OfferRevisionStatus.PENDING },
        { $set: { status: OfferRevisionStatus.SUPERSEDED, closedReason: 'The offer expired', excerptsRedactAfter: new Date(now.getTime() + RETENTION.excerptDays * 24 * 60 * 60 * 1000) } },
      );
    } else {
      const pending = await this.revisions.exists({ offerRef: offer._id, status: OfferRevisionStatus.PENDING });
      offer.set({ status: pending ? OfferStatus.REVISION_PENDING : OfferStatus.ACTIVE, absentChecks: 0, recheckStateAt: now });
    }
    await offer.save();
    await recountActiveOffers(this.offers, this.businesses, offer.businessId);
    if (decision === 'restore' && offer.scrapedWebsiteRef) await this.checkWithinADay(offer.scrapedWebsiteRef);
    await this.audit.record({
      action: AuditAction.OFFER_EXPIRY_DECIDED,
      targetType: 'Offer',
      targetId: offer._id,
      before: { status: OfferStatus.EXPIRY_REVIEW },
      after: { status: offer.status, decision },
      note,
    });
    return offer;
  }
}
