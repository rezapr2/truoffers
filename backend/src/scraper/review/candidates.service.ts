import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AuditAction,
  BranchMatchStatus,
  CandidateStatus,
  ConfidenceBand,
  DuplicateKind,
  OfferVerification,
  OptOutSource,
  RESOLVED_BRANCH_STATUSES,
} from '../../common/scraper.enums';
import { Business, BusinessDocument } from '../../schemas/business.schema';
import { DomainCrawlConfig, DomainCrawlConfigDocument } from '../../schemas/domain-crawl-config.schema';
import {
  CandidateEdit,
  ExtractedOfferCandidate,
  ExtractedOfferCandidateDocument,
} from '../../schemas/extracted-offer-candidate.schema';
import { Offer, OfferDocument } from '../../schemas/offer.schema';
import { ScrapedWebsite, ScrapedWebsiteDocument } from '../../schemas/scraped-website.schema';
import { AuditService } from '../audit/audit.service';
import type { ExtractedOffer } from '../extraction/adapter.types';
import { contentFingerprint } from '../extraction/content-fingerprint';
import { evidenceFor } from '../extraction/evidence';
import { OfferLifecycleService } from '../lifecycle/offer-lifecycle.service';
import { RunsService } from '../queue/runs.service';
import { RETENTION } from '../scraper.constants';
import { OptOutsService } from './opt-outs.service';

export const EDITABLE_FIELDS = [
  'title',
  'shortDescription',
  'terms',
  'offerType',
  'discountPercentage',
  'discountAmount',
  'originalPrice',
  'promotionalPrice',
  'promoCode',
  'minimumOrder',
  'requiredSpend',
  'freeItem',
  'collectionEligible',
  'deliveryEligible',
  'newCustomersOnly',
  'applicableProducts',
  'eligibleWeekdays',
  'dailyStartTime',
  'dailyEndTime',
  'startDate',
  'endDate',
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

const OPEN = [CandidateStatus.PENDING_REVIEW, CandidateStatus.AWAITING_MERCHANT_CONFIRMATION, CandidateStatus.NEEDS_REEXTRACTION];

@Injectable()
export class CandidatesService {
  constructor(
    @InjectModel(ExtractedOfferCandidate.name) private readonly candidates: Model<ExtractedOfferCandidateDocument>,
    @InjectModel(ScrapedWebsite.name) private readonly sites: Model<ScrapedWebsiteDocument>,
    @InjectModel(Offer.name) private readonly offers: Model<OfferDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(DomainCrawlConfig.name) private readonly configs: Model<DomainCrawlConfigDocument>,
    private readonly lifecycle: OfferLifecycleService,
    private readonly runs: RunsService,
    private readonly optOuts: OptOutsService,
    private readonly audit: AuditService,
  ) {}

  async list(filter: { status?: CandidateStatus; band?: ConfidenceBand; duplicate?: boolean; websiteId?: string; q?: string; page?: number; limit?: number }) {
    const query: Record<string, unknown> = { status: filter.status ?? { $in: OPEN } };
    if (filter.band) query.confidenceBand = filter.band;
    if (filter.duplicate) query.duplicate = { $exists: true };
    if (filter.websiteId && Types.ObjectId.isValid(filter.websiteId)) query.scrapedWebsiteRef = new Types.ObjectId(filter.websiteId);
    if (filter.q) query.$or = [{ title: new RegExp(escape(filter.q), 'i') }, { domain: new RegExp(escape(filter.q), 'i') }];
    const limit = Math.min(100, filter.limit ?? 25);
    const page = Math.max(1, filter.page ?? 1);
    const [items, total, bands] = await Promise.all([
      this.candidates
        .find(query)
        .select('title offerType displayLabel discountPercentage discountAmount promotionalPrice promoCode domain branchPaths confidenceScore confidenceBand status duplicate conflicts flags createdAt lastCheckedAt scrapedWebsiteRef')
        .sort({ confidenceScore: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.candidates.countDocuments(query),
      this.candidates.aggregate([{ $match: { status: { $in: OPEN } } }, { $group: { _id: '$confidenceBand', count: { $sum: 1 } } }]),
    ]);
    return { items, total, page, pages: Math.ceil(total / limit), openByBand: Object.fromEntries(bands.map((b) => [b._id, b.count])) };
  }

  async detail(id: string) {
    const candidate = await this.find(id);
    const site = await this.sites
      .findById(candidate.scrapedWebsiteRef)
      .select('domain seedUrl authorisationStatus adapterId adapterVersion businesses providerRef')
      .populate('businesses.businessRef', 'name slug postcode phone town verificationStatus ownerId')
      .populate('businesses.suggestions.businessRef', 'name slug postcode phone town')
      .lean();
    const branches = (site?.businesses ?? []).filter((b) => candidate.branchPaths.includes(b.branchPath));
    const previous = candidate.duplicate?.offerRef
      ? await this.offers.findById(candidate.duplicate.offerRef).select('title displayLabel discountType value code minOrder terms startsAt endsAt status verification managedBy lastCheckedAt').lean()
      : null;
    const approvedOffers = candidate.approvedOfferRefs.length
      ? await this.offers.find({ _id: { $in: candidate.approvedOfferRefs } }).select('title status verification managedBy businessId').lean()
      : [];
    const history = await this.audit.list({ targetType: 'ExtractedOfferCandidate', targetId: String(candidate._id), limit: 20 });
    return {
      candidate: candidate.toObject(),
      website: site ? { _id: site._id, domain: site.domain, seedUrl: site.seedUrl, authorisationStatus: site.authorisationStatus, adapterId: site.adapterId } : null,
      branches,
      canApprove:
        OPEN.slice(0, 2).includes(candidate.status) &&
        candidate.confidenceScore >= 40 &&
        candidate.duplicate?.kind !== DuplicateKind.CHANGED_TERMS &&
        branches.length === candidate.branchPaths.length &&
        branches.every((b) => b.businessRef && RESOLVED_BRANCH_STATUSES.includes(b.matchStatus)),
      previous,
      approvedOffers,
      history,
    };
  }

  // "Edit then approve": each edited field records before/after and carries the admin as its evidence.
  async edit(id: string, patch: Partial<Record<EditableField, unknown>> & { branchPaths?: string[] }, user: { userId: string; name?: string }) {
    const candidate = await this.find(id);
    if (!OPEN.includes(candidate.status)) throw new BadRequestException(`A ${candidate.status} candidate cannot be edited`);
    const now = new Date();
    const edits: CandidateEdit[] = [];
    for (const field of EDITABLE_FIELDS) {
      // Validated DTOs define every declared property, so undefined means "not sent"; null clears a field.
      if (patch[field] === undefined) continue;
      const before = candidate.get(field);
      const after = patch[field] === null || patch[field] === '' ? undefined : patch[field];
      if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) continue;
      candidate.set(field, after);
      const evidence = { ...candidate.evidence };
      if (after === undefined) delete evidence[field];
      else evidence[field] = evidenceFor('admin', `Set by ${user.name ?? 'an administrator'}: ${JSON.stringify(after)}`, `admin_edit:${user.userId}`);
      candidate.set('evidence', evidence);
      edits.push({ field, before, after, editedBy: new Types.ObjectId(user.userId), editedAt: now });
    }
    if (patch.branchPaths) {
      const allowed = patch.branchPaths.filter((p) => candidate.branchPaths.includes(p));
      if (allowed.length === 0) throw new BadRequestException('Keep at least one branch');
      edits.push({ field: 'branchPaths', before: candidate.branchPaths, after: allowed, editedBy: new Types.ObjectId(user.userId), editedAt: now });
      candidate.set('branchPaths', [...allowed].sort());
    }
    if (edits.length === 0) return candidate;
    candidate.edits.push(...edits);
    candidate.set('contentFingerprint', contentFingerprint(candidate.toObject() as unknown as ExtractedOffer));
    await candidate.save();
    await this.audit.record({
      action: AuditAction.CANDIDATE_EDITED,
      targetType: 'ExtractedOfferCandidate',
      targetId: candidate._id,
      before: Object.fromEntries(edits.map((e) => [e.field, e.before])),
      after: Object.fromEntries(edits.map((e) => [e.field, e.after])),
    });
    return candidate;
  }

  approve(id: string, verification: OfferVerification.UNVERIFIED | OfferVerification.ADMIN_VERIFIED, userId: string, options: { branchPaths?: string[]; note?: string } = {}) {
    return this.lifecycle.approveCandidate(id, { verification, ...options }, { userId });
  }

  async reject(id: string, userId: string, reason?: string) {
    const candidate = await this.find(id);
    if (!OPEN.includes(candidate.status) && candidate.status !== CandidateStatus.FAILED_EXTRACTION) {
      throw new BadRequestException(`A ${candidate.status} candidate cannot be rejected`);
    }
    const before = { status: candidate.status };
    candidate.set({
      status: CandidateStatus.REJECTED,
      reviewedBy: new Types.ObjectId(userId),
      reviewedAt: new Date(),
      reviewNote: reason,
      excerptsRedactAfter: new Date(Date.now() + RETENTION.excerptDays * 24 * 60 * 60 * 1000),
    });
    await candidate.save();
    await this.audit.record({ action: AuditAction.CANDIDATE_REJECTED, targetType: 'ExtractedOfferCandidate', targetId: candidate._id, before, after: { status: candidate.status }, note: reason });
    return candidate;
  }

  merge(id: string, userId: string, target: { candidateId?: string; verification?: OfferVerification.UNVERIFIED | OfferVerification.ADMIN_VERIFIED }) {
    if (target.candidateId) return this.lifecycle.mergeIntoCandidate(id, target.candidateId, { userId });
    return this.lifecycle.mergeIntoOffer(id, { verification: target.verification ?? OfferVerification.UNVERIFIED }, { userId });
  }

  // Points a branch (and therefore every candidate on it) at a different business.
  async attachBusiness(id: string, branchPath: string, businessId: string, userId: string) {
    const candidate = await this.find(id);
    if (!candidate.branchPaths.includes(branchPath)) throw new BadRequestException(`The candidate does not apply to ${branchPath}`);
    if (!Types.ObjectId.isValid(businessId) || !(await this.businesses.exists({ _id: businessId }))) throw new NotFoundException('Business not found');
    const site = await this.sites.findById(candidate.scrapedWebsiteRef);
    if (!site) throw new NotFoundException('Website not found');
    const existing = site.businesses.find((b) => b.branchPath === branchPath);
    const entry = {
      branchPath,
      businessRef: new Types.ObjectId(businessId),
      matchStatus: BranchMatchStatus.CONFIRMED,
      decidedBy: new Types.ObjectId(userId),
      decidedAt: new Date(),
    };
    if (existing) {
      await this.sites.updateOne({ _id: site._id, 'businesses.branchPath': branchPath }, { $set: Object.fromEntries(Object.entries(entry).map(([k, v]) => [`businesses.$.${k}`, v])) });
    } else {
      await this.sites.updateOne({ _id: site._id, 'businesses.branchPath': { $ne: branchPath } }, { $push: { businesses: { ...entry, matchSignals: [], suggestions: [] } } });
    }
    await this.audit.record({
      action: AuditAction.CANDIDATE_BUSINESS_ATTACHED,
      targetType: 'ExtractedOfferCandidate',
      targetId: candidate._id,
      before: { businessRef: existing?.businessRef ? String(existing.businessRef) : undefined },
      after: { branchPath, businessRef: businessId },
    });
    return this.detail(id);
  }

  async requestMerchantConfirmation(id: string, userId: string) {
    const candidate = await this.find(id);
    if (candidate.status !== CandidateStatus.PENDING_REVIEW) throw new BadRequestException('Only candidates awaiting review can be sent to the business');
    const detail = await this.detail(id);
    if (!detail.branches.length || !detail.branches.every((b) => b.businessRef && RESOLVED_BRANCH_STATUSES.includes(b.matchStatus))) {
      throw new BadRequestException('Resolve the business first');
    }
    candidate.set({ status: CandidateStatus.AWAITING_MERCHANT_CONFIRMATION, reviewedBy: new Types.ObjectId(userId), reviewedAt: new Date() });
    await candidate.save();
    await this.audit.record({ action: AuditAction.CANDIDATE_MERCHANT_CONFIRMATION_REQUESTED, targetType: 'ExtractedOfferCandidate', targetId: candidate._id });
    return candidate;
  }

  async blockSource(id: string, scope: 'url' | 'domain', userId: string, reason?: string) {
    const candidate = await this.find(id);
    const source = candidate.sources[0];
    if (!source) throw new BadRequestException('The candidate has no source to block');
    if (scope === 'domain') {
      await this.optOuts.create({ domain: candidate.domain, reason: reason ?? 'Blocked from a candidate', source: OptOutSource.ADMIN, createdBy: userId });
    } else {
      const path = new URL(source.url).pathname;
      await this.configs.updateOne({ domain: candidate.domain }, { $addToSet: { blockedPaths: path } }, { upsert: true });
      await this.reject(id, userId, reason ?? `Source ${path} blocked`);
    }
    await this.audit.record({
      action: AuditAction.CANDIDATE_SOURCE_BLOCKED,
      targetType: 'ExtractedOfferCandidate',
      targetId: candidate._id,
      after: { scope, url: source.url },
      note: reason,
    });
    return { blocked: scope };
  }

  async reextract(id: string, userId: string) {
    const candidate = await this.find(id);
    const site = await this.sites.findById(candidate.scrapedWebsiteRef).lean();
    if (!site) throw new NotFoundException('Website not found');
    if (OPEN.includes(candidate.status)) {
      candidate.set({ status: CandidateStatus.NEEDS_REEXTRACTION });
      await candidate.save();
    }
    const { job, created } = await this.runs.startRun(site, { submittedBy: userId });
    await this.audit.record({ action: AuditAction.CANDIDATE_REEXTRACTION_REQUESTED, targetType: 'ExtractedOfferCandidate', targetId: candidate._id, after: { runId: String(job.runId) } });
    return { runId: String(job.runId), created };
  }

  private async find(id: string) {
    const candidate = Types.ObjectId.isValid(id) ? await this.candidates.findById(id) : null;
    if (!candidate) throw new NotFoundException('Candidate not found');
    return candidate;
  }
}

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
