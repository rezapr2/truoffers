import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { parse as parseCsv } from 'csv-parse/sync';
import { Model, Types } from 'mongoose';
import { BusinessesService } from '../../businesses/businesses.service';
import type { CreateBusinessDto } from '../../businesses/businesses.dto';
import {
  AuditAction,
  AuthorisationSource,
  BranchMatchStatus,
  CandidateStatus,
  DomainAuthorisationStatus,
  ProviderPolicyBasis,
  ProviderPolicyStatus,
} from '../../common/scraper.enums';
import { DomainCrawlConfig, DomainCrawlConfigDocument } from '../../schemas/domain-crawl-config.schema';
import {
  ExtractedOfferCandidate,
  ExtractedOfferCandidateDocument,
} from '../../schemas/extracted-offer-candidate.schema';
import { ImportJob, ImportJobDocument } from '../../schemas/import-job.schema';
import { ProviderPolicy, ProviderPolicyDocument } from '../../schemas/provider-policy.schema';
import { ScrapedWebsite, ScrapedWebsiteDocument } from '../../schemas/scraped-website.schema';
import { AuditService } from '../audit/audit.service';
import { RunsService } from '../queue/runs.service';
import { DomainRegistryService } from '../safety/domain-registry.service';
import { neverCrawlReason } from '../safety/never-crawl';
import { providerPermitsCrawling } from '../safety/provider-permission';
import { normaliseUrl, registrableDomainOf, siteDomainOf, UrlRejectedError } from '../safety/url';
import { INTAKE_LIMITS } from '../scraper.constants';
import { ScraperSettingsService } from './scraper-settings.service';

export type IntakeSource = AuthorisationSource.ADMIN_MANUAL | AuthorisationSource.ADMIN_CSV | AuthorisationSource.PROVIDER_CLIENT_LIST;

export interface IntakeResult {
  input: string;
  domain?: string;
  outcome: 'queued' | 'already_running' | 'held' | 'rejected';
  message?: string;
  websiteId?: string;
  runId?: string;
}

export type BranchDecision =
  | { action: 'confirm'; businessId: string }
  | { action: 'attach'; businessId: string }
  | { action: 'create'; business: CreateBusinessDto }
  | { action: 'reject'; note?: string };

@Injectable()
export class WebsitesService {
  constructor(
    @InjectModel(ScrapedWebsite.name) private readonly sites: Model<ScrapedWebsiteDocument>,
    @InjectModel(ProviderPolicy.name) private readonly policies: Model<ProviderPolicyDocument>,
    @InjectModel(DomainCrawlConfig.name) private readonly configs: Model<DomainCrawlConfigDocument>,
    @InjectModel(ImportJob.name) private readonly jobs: Model<ImportJobDocument>,
    @InjectModel(ExtractedOfferCandidate.name) private readonly candidates: Model<ExtractedOfferCandidateDocument>,
    private readonly registry: DomainRegistryService,
    private readonly runs: RunsService,
    private readonly settings: ScraperSettingsService,
    private readonly businessesService: BusinessesService,
    private readonly audit: AuditService,
  ) {}

  parseCsv(buffer: Buffer): string[] {
    if (buffer.length > INTAKE_LIMITS.csvMaxBytes) throw new BadRequestException('CSV files are limited to 1 MB');
    let rows: string[][];
    try {
      rows = parseCsv(buffer, { skip_empty_lines: true, trim: true, relax_column_count: true, bom: true });
    } catch (err) {
      throw new BadRequestException(`Could not read the CSV: ${(err as Error).message}`);
    }
    if (rows.length > INTAKE_LIMITS.csvMaxRows + 1) throw new BadRequestException(`CSV files are limited to ${INTAKE_LIMITS.csvMaxRows} rows`);
    const header = rows[0]?.map((h) => h.toLowerCase());
    const column = header ? Math.max(0, header.findIndex((h) => /^(url|website|domain|site)$/.test(h))) : 0;
    const hasHeader = header?.some((h) => /^(url|website|domain|site)$/.test(h));
    return rows.slice(hasHeader ? 1 : 0).map((row) => row[column]).filter(Boolean);
  }

  async submit(inputs: string[], options: { source: IntakeSource; submittedBy: string; providerPolicyId?: string }): Promise<IntakeResult[]> {
    const unique = [...new Set(inputs.map((i) => i.trim()).filter(Boolean))];
    if (unique.length === 0) throw new BadRequestException('Provide at least one URL');
    if (unique.length > INTAKE_LIMITS.csvMaxRows) throw new BadRequestException(`At most ${INTAKE_LIMITS.csvMaxRows} URLs per submission`);

    let providerRef: Types.ObjectId | undefined;
    if (options.source === AuthorisationSource.PROVIDER_CLIENT_LIST) {
      // Spec §2.3: provider client lists are only accepted under a recorded data-sharing agreement.
      const policy = options.providerPolicyId && Types.ObjectId.isValid(options.providerPolicyId)
        ? await this.policies.findById(options.providerPolicyId).lean()
        : null;
      if (!policy) throw new BadRequestException('Choose the provider this client list comes from');
      if (policy.status !== ProviderPolicyStatus.ALLOWED || policy.basis !== ProviderPolicyBasis.WRITTEN_AGREEMENT || !policy.agreementReference) {
        throw new BadRequestException(`${policy.name} has no allowed policy with a written agreement reference`);
      }
      providerRef = policy._id;
    }

    const settings = await this.settings.get();
    const batchId = new Types.ObjectId().toString();
    const results: IntakeResult[] = [];
    for (const input of unique) results.push(await this.intakeOne(input, options, providerRef, batchId, settings.extraNeverCrawlDomains));

    await this.audit.record({
      action: AuditAction.WEBSITE_SUBMITTED,
      targetType: 'WebsiteBatch',
      targetId: batchId,
      after: {
        source: options.source,
        submitted: unique.length,
        queued: results.filter((r) => r.outcome === 'queued').length,
        rejected: results.filter((r) => r.outcome === 'rejected').length,
      },
    });
    return results;
  }

  private async intakeOne(input: string, options: { source: IntakeSource; submittedBy: string }, providerRef: Types.ObjectId | undefined, batchId: string, extraNeverCrawl: string[]): Promise<IntakeResult> {
    let url: string;
    try {
      url = normaliseUrl(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`);
    } catch (err) {
      return { input, outcome: 'rejected', message: err instanceof UrlRejectedError ? err.message : 'Not a valid URL' };
    }
    const domain = siteDomainOf(new URL(url).hostname);
    const blocked = neverCrawlReason(domain, extraNeverCrawl);
    if (blocked) return { input, domain, outcome: 'rejected', message: blocked };
    if (await this.registry.activeOptOutFor(domain)) {
      return { input, domain, outcome: 'rejected', message: `${domain} has opted out` };
    }

    let site = await this.sites.findOne({ domain });
    if (!site) {
      site = await this.sites.create({
        domain,
        registrableDomain: registrableDomainOf(domain),
        seedUrl: url,
        authorisationStatus: DomainAuthorisationStatus.AUTHORISED,
        authorisationSource: options.source,
        authorisedBy: new Types.ObjectId(options.submittedBy),
        authorisedAt: new Date(),
        submittedBy: new Types.ObjectId(options.submittedBy),
        batchId,
        providerRef,
        businesses: [],
      });
    } else if (site.authorisationStatus === DomainAuthorisationStatus.PENDING_AUTHORISATION || site.authorisationStatus === DomainAuthorisationStatus.OPTED_OUT) {
      // Entering a domain explicitly is how an admin authorises it (spec §2.1).
      site.set({
        authorisationStatus: DomainAuthorisationStatus.AUTHORISED,
        authorisationSource: options.source,
        authorisedBy: new Types.ObjectId(options.submittedBy),
        authorisedAt: new Date(),
        seedUrl: url,
        providerRef: providerRef ?? site.providerRef,
      });
      await site.save();
    }
    if (site.authorisationStatus === DomainAuthorisationStatus.AWAITING_PROVIDER_REVIEW) {
      return { input, domain, outcome: 'held', message: 'Awaiting provider policy review', websiteId: String(site._id) };
    }

    const { job, created } = await this.runs.startRun(site, { submittedBy: options.submittedBy, batchId });
    return {
      input,
      domain,
      outcome: created ? 'queued' : 'already_running',
      websiteId: String(site._id),
      runId: String(job.runId),
    };
  }

  async list(filter: { status?: DomainAuthorisationStatus; providerId?: string; q?: string; page?: number; limit?: number }) {
    const query: Record<string, unknown> = {};
    if (filter.status) query.authorisationStatus = filter.status;
    if (filter.providerId && Types.ObjectId.isValid(filter.providerId)) query.providerRef = new Types.ObjectId(filter.providerId);
    if (filter.q) query.domain = new RegExp(filter.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const limit = Math.min(100, filter.limit ?? 25);
    const page = Math.max(1, filter.page ?? 1);
    const [items, total] = await Promise.all([
      this.sites
        .find(query)
        .select('-businesses.extracted.evidence')
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('providerRef', 'name status')
        .lean(),
      this.sites.countDocuments(query),
    ]);
    const runIds = items.map((s) => s.lastRunRef).filter(Boolean);
    const [runs, candidateCounts] = await Promise.all([
      this.jobs.find({ runId: { $in: runIds } }).select('runId type status progress finishedAt createdAt').lean(),
      this.candidates.aggregate([
        { $match: { scrapedWebsiteRef: { $in: items.map((s) => s._id) } } },
        { $group: { _id: { site: '$scrapedWebsiteRef', status: '$status' }, count: { $sum: 1 } } },
      ]),
    ]);
    return {
      items: items.map((site) => ({
        ...site,
        lastRun: summariseRun(runs.filter((r) => String(r.runId) === String(site.lastRunRef))),
        candidates: Object.fromEntries(
          candidateCounts.filter((c) => String(c._id.site) === String(site._id)).map((c) => [c._id.status, c.count]),
        ),
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  async detail(id: string) {
    const site = await this.find(id).then((s) => s.populate([{ path: 'providerRef', select: 'name status basis agreementReference' }, { path: 'businesses.businessRef', select: 'name slug postcode phone town verificationStatus' }, { path: 'businesses.suggestions.businessRef', select: 'name slug postcode phone town' }]));
    const [runs, candidates, config] = await Promise.all([
      this.jobs.find({ scrapedWebsiteRef: site._id }).select('runId type status progress resultCounts errorLog startedAt finishedAt createdAt').sort({ createdAt: -1 }).limit(60).lean(),
      this.candidates.aggregate([{ $match: { scrapedWebsiteRef: site._id } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      this.configs.findOne({ domain: site.domain }).lean(),
    ]);
    return {
      site: site.toObject(),
      config,
      candidates: Object.fromEntries(candidates.map((c) => [c._id, c.count])),
      runs: groupRuns(runs),
    };
  }

  async analyse(id: string, userId: string) {
    const site = await this.find(id);
    if (site.authorisationStatus !== DomainAuthorisationStatus.AUTHORISED) {
      throw new BadRequestException(`${site.domain} is ${site.authorisationStatus.replace(/_/g, ' ')}`);
    }
    const { job, created } = await this.runs.startRun(site, { submittedBy: userId });
    return { runId: String(job.runId), created };
  }

  async authorise(id: string, decision: 'approve' | 'deny', userId: string, note?: string) {
    const site = await this.find(id);
    const before = { authorisationStatus: site.authorisationStatus };
    if (decision === 'approve') {
      if (await this.registry.activeOptOutFor(site.domain)) throw new BadRequestException(`${site.domain} has an active opt-out; lift it first`);
      if (site.providerRef) {
        const [policy, settings] = await Promise.all([this.policies.findById(site.providerRef).lean(), this.settings.get()]);
        if (!providerPermitsCrawling(policy?.status, !!settings.providerReviewRequired)) {
          throw new BadRequestException(`${site.domain} is hosted by ${policy?.name ?? 'a provider'} whose policy is ${policy?.status ?? 'missing'}`);
        }
      }
      site.set({
        authorisationStatus: DomainAuthorisationStatus.AUTHORISED,
        authorisationSource: site.authorisationSource === AuthorisationSource.DISCOVERED_LINK ? AuthorisationSource.DISCOVERED_APPROVED : site.authorisationSource,
        authorisedBy: new Types.ObjectId(userId),
        authorisedAt: new Date(),
        authorisationNote: note,
      });
    } else {
      site.set({ authorisationStatus: DomainAuthorisationStatus.OPTED_OUT, authorisationNote: note ?? 'Authorisation denied', robotsOverride: undefined });
    }
    await site.save();
    await this.audit.record({
      action: decision === 'approve' ? AuditAction.WEBSITE_AUTHORISED : AuditAction.WEBSITE_AUTHORISATION_DENIED,
      targetType: 'ScrapedWebsite',
      targetId: site._id,
      before,
      after: { authorisationStatus: site.authorisationStatus },
      note,
    });
    return site;
  }

  /**
   * Reads the website despite its robots.txt, on the owner's written consent (the note says who agreed, how and
   * when). Never set in bulk, by an import or by discovery; an opt-out or a denial clears it, and the crawl gate
   * still applies everything else, including opt-outs, the never-crawl list and the rate limit.
   */
  async setRobotsOverride(id: string, note: string, userId: string) {
    const site = await this.find(id);
    if (site.authorisationStatus === DomainAuthorisationStatus.OPTED_OUT || (await this.registry.activeOptOutFor(site.domain))) {
      throw new BadRequestException(`${site.domain} has opted out, so it can't be read`);
    }
    const before = site.robotsOverride ? { note: site.robotsOverride.note } : undefined;
    site.set('robotsOverride', { note: note.trim(), recordedBy: new Types.ObjectId(userId), recordedAt: new Date() });
    await site.save();
    await this.audit.record({
      action: AuditAction.WEBSITE_ROBOTS_OVERRIDE_SET,
      targetType: 'ScrapedWebsite',
      targetId: site._id,
      before,
      after: { domain: site.domain, note: note.trim() },
      note: note.trim(),
    });
    return site.robotsOverride;
  }

  async clearRobotsOverride(id: string, userId: string) {
    const site = await this.find(id);
    if (!site.robotsOverride) throw new BadRequestException(`${site.domain} has no robots.txt exception to remove`);
    const before = { note: site.robotsOverride.note };
    site.set('robotsOverride', undefined);
    await site.save();
    await this.audit.record({
      action: AuditAction.WEBSITE_ROBOTS_OVERRIDE_REMOVED,
      targetType: 'ScrapedWebsite',
      targetId: site._id,
      before,
      after: { domain: site.domain },
      note: `Removed by ${userId}`,
    });
    return { removed: true };
  }

  async setPaused(id: string, paused: boolean, userId: string, reason?: string) {
    const site = await this.find(id);
    const config = await this.configs.findOneAndUpdate(
      { domain: site.domain },
      { $set: { paused, pausedReason: paused ? reason : undefined, pausedBy: paused ? new Types.ObjectId(userId) : undefined } },
      { upsert: true, new: true },
    );
    await this.audit.record({
      action: paused ? AuditAction.WEBSITE_PAUSED : AuditAction.WEBSITE_RESUMED,
      targetType: 'ScrapedWebsite',
      targetId: site._id,
      note: reason,
    });
    return config;
  }

  async updateCrawlConfig(id: string, patch: { rateLimitMs?: number; pageCap?: number; recheckIntervalHours?: number | null }) {
    const site = await this.find(id);
    // An explicit null clears the override so the adapter's or the default interval applies again.
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
    const $set = Object.fromEntries(entries.filter(([, value]) => value !== null));
    const $unset = Object.fromEntries(entries.filter(([, value]) => value === null).map(([key]) => [key, 1]));
    return this.configs.findOneAndUpdate(
      { domain: site.domain },
      { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) },
      { upsert: true, new: true, runValidators: true },
    );
  }

  async decideBranch(id: string, branchPath: string, decision: BranchDecision, userId: string) {
    const site = await this.find(id);
    const branch = site.businesses.find((b) => b.branchPath === branchPath);
    if (!branch) throw new NotFoundException(`No branch ${branchPath} on ${site.domain}`);
    const before = { matchStatus: branch.matchStatus, businessRef: branch.businessRef ? String(branch.businessRef) : undefined };

    let businessRef: Types.ObjectId | undefined;
    let status = BranchMatchStatus.CONFIRMED;
    if (decision.action === 'confirm' || decision.action === 'attach') {
      if (!Types.ObjectId.isValid(decision.businessId)) throw new BadRequestException('Invalid business');
      businessRef = new Types.ObjectId(decision.businessId);
      if (decision.action === 'confirm' && !branch.suggestions.some((s) => String(s.businessRef) === decision.businessId)) {
        throw new BadRequestException('That business was not one of the suggestions; attach it instead');
      }
    } else if (decision.action === 'create') {
      // New businesses exist only after an admin creates them from the extracted details (spec §8).
      const created = await this.businessesService.create(decision.business, undefined, false, {
        importSource: { scrapedWebsiteRef: site._id, domain: site.domain, importedAt: new Date(), lastCheckedAt: site.lastSuccessfulCheckAt },
      });
      businessRef = created._id;
      await this.audit.record({
        action: AuditAction.BUSINESS_CREATED_FROM_IMPORT,
        targetType: 'Business',
        targetId: created._id,
        after: { name: created.name, postcode: created.postcode, website: site.domain, branchPath },
      });
    } else {
      status = BranchMatchStatus.REJECTED;
    }

    await this.sites.updateOne(
      { _id: site._id, 'businesses.branchPath': branchPath },
      {
        $set: {
          'businesses.$.matchStatus': status,
          'businesses.$.businessRef': businessRef,
          'businesses.$.decidedBy': new Types.ObjectId(userId),
          'businesses.$.decidedAt': new Date(),
        },
      },
    );
    if (status === BranchMatchStatus.REJECTED) {
      await this.candidates.updateMany(
        { scrapedWebsiteRef: site._id, branchPaths: [branchPath], status: CandidateStatus.PENDING_REVIEW },
        { $set: { status: CandidateStatus.REJECTED, reviewNote: 'Branch rejected', reviewedBy: new Types.ObjectId(userId), reviewedAt: new Date() } },
      );
    }
    await this.audit.record({
      action: AuditAction.BRANCH_MATCH_DECIDED,
      targetType: 'ScrapedWebsite',
      targetId: site._id,
      before,
      after: { branchPath, matchStatus: status, businessRef: businessRef ? String(businessRef) : undefined },
      note: decision.action === 'reject' ? decision.note : undefined,
    });
    return this.detail(String(site._id));
  }

  // The business-matching queue: branches waiting for an admin decision.
  async pendingBranches(limit = 50) {
    const sites = await this.sites
      .find({ 'businesses.matchStatus': { $in: [BranchMatchStatus.NEEDS_REVIEW, BranchMatchStatus.NEW_BUSINESS_PROPOSED] } })
      .select('domain businesses')
      .populate('businesses.suggestions.businessRef', 'name slug postcode phone town')
      .limit(limit)
      .lean();
    return sites.flatMap((site) =>
      site.businesses
        .filter((b) => b.matchStatus === BranchMatchStatus.NEEDS_REVIEW || b.matchStatus === BranchMatchStatus.NEW_BUSINESS_PROPOSED)
        .map((branch) => ({ websiteId: site._id, domain: site.domain, branch })),
    );
  }

  private async find(id: string) {
    const site = Types.ObjectId.isValid(id) ? await this.sites.findById(id) : null;
    if (!site) throw new NotFoundException('Website not found');
    return site;
  }
}

function summariseRun(stages: Pick<ImportJob, 'type' | 'status' | 'progress' | 'finishedAt'>[]) {
  if (stages.length === 0) return null;
  const latest = stages[stages.length - 1];
  return { stage: latest.type, status: latest.status, stages: stages.length, message: latest.progress?.message };
}

function groupRuns(stages: (Pick<ImportJob, 'runId' | 'type' | 'status'> & Record<string, unknown>)[]) {
  const runs = new Map<string, typeof stages>();
  for (const stage of stages) {
    const key = String(stage.runId);
    runs.set(key, [...(runs.get(key) ?? []), stage]);
  }
  return [...runs.entries()].map(([runId, list]) => ({ runId, stages: list.reverse() }));
}
