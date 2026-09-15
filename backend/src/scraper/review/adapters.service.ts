import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import slugify from 'slugify';
import {
  AuditAction,
  CandidateStatus,
  DomainAuthorisationStatus,
  ImportJobType,
  ScraperAdapterStatus,
  ScraperAdapterType,
} from '../../common/scraper.enums';
import { ExtractedOfferCandidate, ExtractedOfferCandidateDocument } from '../../schemas/extracted-offer-candidate.schema';
import { ScrapedWebsite, ScrapedWebsiteDocument } from '../../schemas/scraped-website.schema';
import { ScraperAdapter, ScraperAdapterDocument } from '../../schemas/scraper-adapter.schema';
import { WebsiteFingerprint, WebsiteFingerprintDocument } from '../../schemas/website-fingerprint.schema';
import { AuditService } from '../audit/audit.service';
import { SELECTOR_ADAPTER_PRIORITY } from '../extraction/adapters/selector-adapter';
import { parseSelectorConfig } from '../extraction/selector-config';
import { RunsService } from '../queue/runs.service';

export const MAX_RERUN_SITES = 200;
const CODE_ADAPTER_TYPES = [ScraperAdapterType.BUILTIN_HTML, ScraperAdapterType.BUILTIN_JSONLD, ScraperAdapterType.PROVIDER];
const EDITABLE = [ScraperAdapterStatus.DRAFT, ScraperAdapterStatus.TESTING];

type AdapterLean = ScraperAdapter & { _id: Types.ObjectId; createdAt?: Date };

export interface DraftInput {
  name: string;
  fingerprintId: string;
  exampleDomains: string[];
  configuration: unknown;
}

/**
 * Adapter management: built-in and provider adapters can be paused; selector adapters also go through
 * draft -> testing -> approved versions, can be rolled back, and their sites re-extracted.
 */
@Injectable()
export class AdaptersService {
  constructor(
    @InjectModel(ScraperAdapter.name) private readonly adapters: Model<ScraperAdapterDocument>,
    @InjectModel(ScrapedWebsite.name) private readonly sites: Model<ScrapedWebsiteDocument>,
    @InjectModel(ExtractedOfferCandidate.name) private readonly candidates: Model<ExtractedOfferCandidateDocument>,
    @InjectModel(WebsiteFingerprint.name) private readonly fingerprints: Model<WebsiteFingerprintDocument>,
    private readonly runs: RunsService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const [records, sites, outcomes] = await Promise.all([
      this.adapters.find().sort({ priority: -1, key: 1, createdAt: -1 }).populate('fingerprintRef', 'name key').lean<AdapterLean[]>(),
      this.sites.aggregate([{ $match: { adapterId: { $exists: true } } }, { $group: { _id: '$adapterId', count: { $sum: 1 } } }]),
      this.candidates.aggregate([{ $group: { _id: { adapter: '$adapterId', status: '$status' }, count: { $sum: 1 } } }]),
    ]);
    // One row per key: its current version, or its newest draft when nothing is approved yet.
    const byKey = new Map<string, AdapterLean[]>();
    for (const record of records) byKey.set(record.key, [...(byKey.get(record.key) ?? []), record]);
    return [...byKey.entries()].map(([key, versions]) => {
      const current = versions.find((v) => v.isCurrent) ?? versions[0];
      const byStatus = Object.fromEntries(outcomes.filter((o) => o._id.adapter === key).map((o) => [o._id.status, o.count]));
      return {
        ...current,
        versions: versions.length,
        latestVersion: versions.map((v) => v.version).sort((a, b) => Number(b) - Number(a))[0],
        websites: sites.find((s) => s._id === key)?.count ?? 0,
        candidates: byStatus,
        approvalRate: approvalRate(byStatus),
      };
    });
  }

  async detail(key: string) {
    const versions = await this.adapters.find({ key }).sort({ createdAt: -1 }).populate('fingerprintRef', 'name key thresholds').populate('approvedBy withdrawnBy createdBy', 'name').lean<AdapterLean[]>();
    if (versions.length === 0) throw new NotFoundException('Adapter not found');
    const [affected, outcomes] = await Promise.all([
      this.sites.find({ adapterId: key }).select('domain adapterVersion authorisationStatus lastSuccessfulCheckAt matchCategory matchScore').limit(500).lean(),
      this.candidates.aggregate([{ $match: { adapterId: key } }, { $group: { _id: { version: '$adapterVersion', status: '$status' }, count: { $sum: 1 } } }]),
    ]);
    return {
      key,
      versions: versions.map((v) => {
        const byStatus = Object.fromEntries(outcomes.filter((o) => o._id.version === v.version).map((o) => [o._id.status, o.count]));
        return { ...v, candidates: byStatus, approvalRate: approvalRate(byStatus) };
      }),
      affectedWebsites: affected,
    };
  }

  async createDraft(input: DraftInput, userId: string) {
    const fingerprint = await this.fingerprint(input.fingerprintId);
    const configuration = this.validConfig(input.configuration);
    const exampleDomains = await this.authorisedDomains(input.exampleDomains);
    const key = await this.uniqueKey(input.name);
    const draft = await this.adapters.create({
      key,
      name: input.name.trim(),
      type: ScraperAdapterType.SELECTOR,
      version: '1',
      priority: SELECTOR_ADAPTER_PRIORITY,
      status: ScraperAdapterStatus.DRAFT,
      isCurrent: false,
      fingerprintRef: fingerprint._id,
      provider: undefined,
      exampleDomains,
      configuration,
      createdBy: new Types.ObjectId(userId),
    });
    await this.audit.record({ action: AuditAction.ADAPTER_CREATED, targetType: 'ScraperAdapter', targetId: draft._id, after: { key, version: '1', fingerprint: fingerprint.name, exampleDomains } });
    return draft;
  }

  // Draft and testing versions can be edited; editing sends a tested version back to draft.
  async updateVersion(key: string, version: string, input: Partial<Omit<DraftInput, 'fingerprintId'>>, userId: string) {
    const record = await this.version(key, version);
    if (!EDITABLE.includes(record.status)) throw new BadRequestException(`Version ${version} is ${record.status}; create a new version to change it`);
    const before = { name: record.name, exampleDomains: record.exampleDomains, status: record.status };
    if (input.name !== undefined) record.name = input.name.trim();
    if (input.exampleDomains !== undefined) record.exampleDomains = await this.authorisedDomains(input.exampleDomains);
    if (input.configuration !== undefined) record.set('configuration', this.validConfig(input.configuration));
    record.set({ status: ScraperAdapterStatus.DRAFT, testResults: undefined, testedAt: undefined });
    await record.save();
    await this.audit.record({ action: AuditAction.ADAPTER_UPDATED, targetType: 'ScraperAdapter', targetId: record._id, before, after: { name: record.name, exampleDomains: record.exampleDomains, status: record.status, by: userId } });
    return record;
  }

  // Approved and withdrawn versions are immutable: changes start a new draft version from them.
  async newVersion(key: string, fromVersion: string, userId: string) {
    const source = await this.version(key, fromVersion);
    if (source.type !== ScraperAdapterType.SELECTOR) throw new BadRequestException('Only selector adapters have versions');
    const versions = await this.adapters.find({ key }).select('version').lean();
    const next = String(Math.max(...versions.map((v) => Number(v.version) || 0)) + 1);
    const draft = await this.adapters.create({
      key,
      name: source.name,
      type: ScraperAdapterType.SELECTOR,
      version: next,
      priority: source.priority,
      status: ScraperAdapterStatus.DRAFT,
      isCurrent: false,
      fingerprintRef: source.fingerprintRef,
      exampleDomains: source.exampleDomains,
      configuration: source.configuration,
      basedOnVersion: source.version,
      createdBy: new Types.ObjectId(userId),
    });
    await this.audit.record({ action: AuditAction.ADAPTER_VERSION_CREATED, targetType: 'ScraperAdapter', targetId: draft._id, after: { key, version: next, basedOn: source.version } });
    return draft;
  }

  // Step 4 of the builder: a dry run on the example sites. Results only; no candidates are created.
  async requestTest(key: string, version: string, userId: string) {
    const record = await this.version(key, version);
    if (!EDITABLE.includes(record.status)) throw new BadRequestException(`Version ${version} is ${record.status} and can no longer be tested`);
    if (record.exampleDomains.length === 0) throw new BadRequestException('Add at least one example website to test on');
    record.status = ScraperAdapterStatus.TESTING;
    await record.save();
    const { job, created } = await this.runs.startJob({
      type: ImportJobType.TEST_ADAPTER,
      key: `adapter:${key}@${version}`,
      label: `${key}@${version}`,
      payload: { adapterId: String(record._id) },
      submittedBy: userId,
    });
    await this.adapters.updateOne({ _id: record._id }, { $set: { lastTestJobRef: job._id } });
    await this.audit.record({ action: AuditAction.ADAPTER_TEST_REQUESTED, targetType: 'ScraperAdapter', targetId: record._id, after: { key, version, jobId: String(job._id) } });
    return { jobId: String(job._id), runId: String(job.runId), created };
  }

  async approve(key: string, version: string, userId: string) {
    const record = await this.version(key, version);
    if (record.status !== ScraperAdapterStatus.TESTING) throw new BadRequestException('Test this version on its example websites before approving it');
    const summary = (record.testResults as { summary?: { domains: number; handled: number; offers: number } } | undefined)?.summary;
    if (!summary || record.testedAt === undefined) throw new BadRequestException('The test run has not finished yet');
    if (summary.handled < summary.domains) throw new BadRequestException(`The adapter recognised only ${summary.handled} of ${summary.domains} example websites`);
    if (summary.offers === 0) throw new BadRequestException('The test run found no offers');

    const previous = await this.adapters.findOne({ key, isCurrent: true });
    if (previous && String(previous._id) !== String(record._id)) {
      previous.isCurrent = false;
      await previous.save();
    }
    record.set({ status: ScraperAdapterStatus.APPROVED, isCurrent: true, approvedBy: new Types.ObjectId(userId), approvedAt: new Date() });
    try {
      await record.save();
    } catch (err) {
      if (previous) await this.adapters.updateOne({ _id: previous._id }, { $set: { isCurrent: true } });
      if ((err as { code?: number }).code === 11000) throw new ConflictException('Another version became current at the same time; try again');
      throw err;
    }
    await this.audit.record({
      action: AuditAction.ADAPTER_APPROVED,
      targetType: 'ScraperAdapter',
      targetId: record._id,
      before: { current: previous?.version },
      after: { key, version, testSummary: summary },
    });
    return record;
  }

  /**
   * The current version is withdrawn and the previous approved version (if any) becomes current again.
   * Open candidates the withdrawn version produced are marked for re-extraction.
   */
  async rollback(key: string, userId: string, reason?: string) {
    const current = await this.adapters.findOne({ key, isCurrent: true, type: ScraperAdapterType.SELECTOR });
    if (!current) throw new BadRequestException('This adapter has no current selector version to roll back');
    const previous = await this.adapters
      .findOne({ key, _id: { $ne: current._id }, status: { $in: [ScraperAdapterStatus.APPROVED, ScraperAdapterStatus.PAUSED] }, approvedAt: { $exists: true } })
      .sort({ approvedAt: -1 });

    current.set({ status: ScraperAdapterStatus.WITHDRAWN, isCurrent: false, withdrawnBy: new Types.ObjectId(userId), withdrawnAt: new Date(), withdrawnReason: reason });
    await current.save();
    if (previous) {
      previous.set({ isCurrent: true, status: ScraperAdapterStatus.APPROVED });
      await previous.save();
    }
    const reextract = await this.candidates.updateMany(
      { adapterId: key, adapterVersion: current.version, status: { $in: [CandidateStatus.PENDING_REVIEW, CandidateStatus.AWAITING_MERCHANT_CONFIRMATION] } },
      { $set: { status: CandidateStatus.NEEDS_REEXTRACTION, reviewNote: `Adapter ${key}@${current.version} was withdrawn` } },
    );
    await this.audit.record({
      action: AuditAction.ADAPTER_ROLLED_BACK,
      targetType: 'ScraperAdapter',
      targetId: current._id,
      before: { current: current.version },
      after: { key, withdrawn: current.version, current: previous?.version ?? null, candidatesNeedingReextraction: reextract.modifiedCount },
      note: reason,
    });
    return { withdrawn: current.version, current: previous?.version ?? null, candidatesNeedingReextraction: reextract.modifiedCount };
  }

  // Re-extracts every authorised website the adapter (or one version of it) was used on.
  async rerun(key: string, userId: string, version?: string) {
    const filter: Record<string, unknown> = { adapterId: key, authorisationStatus: DomainAuthorisationStatus.AUTHORISED };
    if (version) filter.adapterVersion = version;
    const sites = await this.sites.find(filter).select('_id domain seedUrl').limit(MAX_RERUN_SITES).lean();
    let started = 0;
    for (const site of sites) {
      const { created } = await this.runs.startRun(site, { submittedBy: userId });
      if (created) started += 1;
    }
    await this.audit.record({ action: AuditAction.ADAPTER_RERUN_REQUESTED, targetType: 'ScraperAdapter', after: { key, version, websites: sites.length, runsStarted: started } });
    return { websites: sites.length, runsStarted: started };
  }

  async setPaused(key: string, paused: boolean, reason?: string) {
    const current = (await this.adapters.findOne({ key, isCurrent: true })) ?? (await this.adapters.findOne({ key }).sort({ createdAt: -1 }));
    if (!current) throw new NotFoundException('Adapter not found');
    const runnable = CODE_ADAPTER_TYPES.includes(current.type) ? ScraperAdapterStatus.ACTIVE : ScraperAdapterStatus.APPROVED;
    if (paused && ![ScraperAdapterStatus.ACTIVE, ScraperAdapterStatus.APPROVED].includes(current.status)) {
      throw new BadRequestException(`Only running adapters can be paused (this one is ${current.status})`);
    }
    if (!paused && current.status !== ScraperAdapterStatus.PAUSED) throw new BadRequestException('This adapter is not paused');
    current.set({ status: paused ? ScraperAdapterStatus.PAUSED : runnable, pausedReason: paused ? reason : undefined });
    await current.save();
    await this.audit.record({
      action: paused ? AuditAction.ADAPTER_PAUSED : AuditAction.ADAPTER_RESUMED,
      targetType: 'ScraperAdapter',
      targetId: current._id,
      after: { key, version: current.version, status: current.status },
      note: reason,
    });
    return current;
  }

  private validConfig(input: unknown) {
    const { config, errors } = parseSelectorConfig(input);
    if (!config) throw new BadRequestException(errors);
    return config;
  }

  private async fingerprint(id: string) {
    const fingerprint = Types.ObjectId.isValid(id) ? await this.fingerprints.findById(id).lean() : null;
    if (!fingerprint) throw new BadRequestException('Choose the fingerprint this adapter is for');
    return fingerprint;
  }

  private async authorisedDomains(domains: string[]): Promise<string[]> {
    const unique = [...new Set(domains.map((d) => d.trim().toLowerCase()).filter(Boolean))];
    const found = await this.sites.find({ domain: { $in: unique }, authorisationStatus: DomainAuthorisationStatus.AUTHORISED }).select('domain').lean();
    const missing = unique.filter((d) => !found.some((s) => s.domain === d));
    if (missing.length) throw new BadRequestException(`Example websites must be authorised: ${missing.join(', ')}`);
    return unique;
  }

  private async uniqueKey(name: string): Promise<string> {
    const base = `selector-${slugify(name, { lower: true, strict: true }) || 'adapter'}`;
    let key = base;
    for (let n = 2; await this.adapters.exists({ key }); n++) key = `${base}-${n}`;
    return key;
  }

  private async version(key: string, version: string) {
    const record = await this.adapters.findOne({ key, version });
    if (!record) throw new NotFoundException(`Adapter ${key}@${version} not found`);
    return record;
  }
}

function approvalRate(byStatus: Record<string, number>): number | null {
  const decided = (byStatus.approved ?? 0) + (byStatus.rejected ?? 0) + (byStatus.merged ?? 0);
  return decided ? ((byStatus.approved ?? 0) + (byStatus.merged ?? 0)) / decided : null;
}
