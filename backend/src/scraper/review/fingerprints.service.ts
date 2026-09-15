import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import slugify from 'slugify';
import {
  AuditAction,
  DomainAuthorisationStatus,
  ImportJobType,
  MarkerCategory,
  ScraperAdapterType,
} from '../../common/scraper.enums';
import { ProviderPolicy, ProviderPolicyDocument } from '../../schemas/provider-policy.schema';
import { ScrapedWebsite, ScrapedWebsiteDocument } from '../../schemas/scraped-website.schema';
import { ScraperAdapter, ScraperAdapterDocument } from '../../schemas/scraper-adapter.schema';
import { FingerprintMarker, WebsiteFingerprint, WebsiteFingerprintDocument } from '../../schemas/website-fingerprint.schema';
import { AuditService } from '../audit/audit.service';
import { DEFAULT_CATEGORY_WEIGHTS, DEFAULT_THRESHOLDS } from '../fingerprinting/scoring';
import { RunsService } from '../queue/runs.service';

export const MAX_MATCH_REQUEST = 500;

export interface FingerprintPatch {
  name?: string;
  active?: boolean;
  providerId?: string | null;
  markers?: { category: MarkerCategory; value: string; weight?: number; required?: boolean; negative?: boolean }[];
  categoryWeights?: Partial<Record<MarkerCategory, number>>;
  thresholds?: { exact: number; high: number; possible: number };
}

@Injectable()
export class FingerprintsService {
  constructor(
    @InjectModel(WebsiteFingerprint.name) private readonly fingerprints: Model<WebsiteFingerprintDocument>,
    @InjectModel(ScrapedWebsite.name) private readonly sites: Model<ScrapedWebsiteDocument>,
    @InjectModel(ScraperAdapter.name) private readonly adapters: Model<ScraperAdapterDocument>,
    @InjectModel(ProviderPolicy.name) private readonly policies: Model<ProviderPolicyDocument>,
    private readonly runs: RunsService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const [fingerprints, matches, adapters] = await Promise.all([
      this.fingerprints.find().select('-examples.offersFound').sort({ updatedAt: -1 }).populate('providerRef', 'name status').lean(),
      this.sites.aggregate([
        { $match: { fingerprintRef: { $exists: true } } },
        { $group: { _id: { fingerprint: '$fingerprintRef', category: '$matchCategory' }, count: { $sum: 1 } } },
      ]),
      this.adapters.find({ type: ScraperAdapterType.SELECTOR, isCurrent: true }).select('key name version status fingerprintRef').lean(),
    ]);
    return fingerprints.map((fp) => ({
      ...fp,
      markerCount: fp.markers.length,
      matches: Object.fromEntries(matches.filter((m) => String(m._id.fingerprint) === String(fp._id)).map((m) => [m._id.category, m.count])),
      adapters: adapters.filter((a) => String(a.fingerprintRef) === String(fp._id)),
    }));
  }

  async detail(id: string) {
    const fingerprint = await this.find(id);
    const [matchedSites, adapters] = await Promise.all([
      this.sites
        .find({ fingerprintRef: fingerprint._id })
        .select('domain authorisationStatus matchScore matchCategory fingerprintMatchedAt adapterId adapterVersion')
        .sort({ matchScore: -1 })
        .limit(200)
        .lean(),
      this.adapters.find({ fingerprintRef: fingerprint._id }).select('key name version status isCurrent approvedAt').sort({ createdAt: -1 }).lean(),
    ]);
    await fingerprint.populate('providerRef', 'name status');
    return {
      fingerprint: fingerprint.toObject(),
      defaults: { categoryWeights: DEFAULT_CATEGORY_WEIGHTS, thresholds: DEFAULT_THRESHOLDS },
      matchedSites,
      adapters,
    };
  }

  // Step 1-2 of the adapter builder: two or more authorised example sites, analysed by the worker.
  async create(input: { name: string; exampleWebsiteIds: string[]; providerId?: string }, userId: string) {
    const ids = [...new Set(input.exampleWebsiteIds)].filter((id) => Types.ObjectId.isValid(id));
    if (ids.length < 2) throw new BadRequestException('Choose at least two example websites');
    const examples = await this.sites.find({ _id: { $in: ids } }).select('domain authorisationStatus').lean();
    const unusable = examples.filter((s) => s.authorisationStatus !== DomainAuthorisationStatus.AUTHORISED);
    if (examples.length !== ids.length || unusable.length) {
      throw new BadRequestException(`Every example must be an authorised website${unusable.length ? ` (${unusable.map((s) => s.domain).join(', ')} is not)` : ''}`);
    }
    const providerRef = await this.providerRef(input.providerId);
    const fingerprint = await this.fingerprints.create({
      name: input.name.trim(),
      key: await this.uniqueKey(input.name),
      exampleDomains: examples.map((s) => s.domain),
      providerRef,
      createdBy: new Types.ObjectId(userId),
    });
    const { job } = await this.analyse(fingerprint, userId);
    await this.audit.record({
      action: AuditAction.FINGERPRINT_CREATED,
      targetType: 'WebsiteFingerprint',
      targetId: fingerprint._id,
      after: { name: fingerprint.name, examples: fingerprint.exampleDomains, jobId: String(job._id) },
    });
    return { fingerprint, jobId: String(job._id), runId: String(job.runId) };
  }

  async reanalyse(id: string, userId: string) {
    const fingerprint = await this.find(id);
    const { job, created } = await this.analyse(fingerprint, userId);
    return { jobId: String(job._id), runId: String(job.runId), created };
  }

  private analyse(fingerprint: WebsiteFingerprintDocument, userId: string) {
    return this.runs.startJob({
      type: ImportJobType.CREATE_FINGERPRINT,
      key: `fingerprint:${fingerprint._id}`,
      label: fingerprint.exampleDomains.join(', ').slice(0, 200),
      payload: { fingerprintId: String(fingerprint._id) },
      submittedBy: userId,
    });
  }

  async update(id: string, patch: FingerprintPatch, userId: string) {
    const fingerprint = await this.find(id);
    const before = { name: fingerprint.name, active: fingerprint.active, markers: fingerprint.markers.length, thresholds: { ...fingerprint.thresholds }, version: fingerprint.version };
    if (patch.name !== undefined) fingerprint.name = patch.name.trim();
    if (patch.active !== undefined) fingerprint.active = patch.active;
    if (patch.providerId !== undefined) fingerprint.providerRef = patch.providerId ? await this.providerRef(patch.providerId) : undefined;
    const structural = patch.markers !== undefined || patch.thresholds !== undefined || patch.categoryWeights !== undefined;
    if (patch.markers) {
      const seen = new Set<string>();
      fingerprint.markers = patch.markers
        .map((m): FingerprintMarker => ({ category: m.category, value: m.value.trim(), weight: m.weight ?? 1, required: !!m.required && !m.negative, negative: !!m.negative }))
        .filter((m) => m.value && !seen.has(`${m.category}|${m.value}`) && seen.add(`${m.category}|${m.value}`));
    }
    if (patch.thresholds) fingerprint.set('thresholds', patch.thresholds);
    if (patch.categoryWeights) fingerprint.categoryWeights = patch.categoryWeights;
    if (structural) fingerprint.version += 1;
    fingerprint.updatedBy = new Types.ObjectId(userId);
    try {
      await fingerprint.save();
    } catch (err) {
      if ((err as Error).name === 'ValidationError' || /Thresholds/.test((err as Error).message)) throw new BadRequestException((err as Error).message);
      throw err;
    }
    await this.audit.record({
      action: AuditAction.FINGERPRINT_UPDATED,
      targetType: 'WebsiteFingerprint',
      targetId: fingerprint._id,
      before,
      after: { name: fingerprint.name, active: fingerprint.active, markers: fingerprint.markers.length, thresholds: { ...fingerprint.thresholds }, version: fingerprint.version },
    });
    return fingerprint;
  }

  // Matches websites against every active fingerprint (the worker picks the best one per site).
  async requestMatch(input: { websiteIds?: string[]; allAuthorised?: boolean; refetch?: boolean }, userId: string) {
    const filter = input.allAuthorised
      ? { authorisationStatus: DomainAuthorisationStatus.AUTHORISED }
      : { _id: { $in: (input.websiteIds ?? []).filter((id) => Types.ObjectId.isValid(id)) } };
    const sites = await this.sites.find(filter).select('_id domain').limit(MAX_MATCH_REQUEST).lean();
    if (sites.length === 0) throw new BadRequestException('No websites to match');
    let queued = 0;
    for (const site of sites) {
      const { created } = await this.runs.startJob({
        type: ImportJobType.MATCH_FINGERPRINT,
        key: `match:${site.domain}`,
        label: site.domain,
        payload: { websiteId: String(site._id), refetch: !!input.refetch },
        submittedBy: userId,
        scrapedWebsiteId: site._id,
      });
      if (created) queued += 1;
    }
    await this.audit.record({ action: AuditAction.FINGERPRINT_MATCH_REQUESTED, targetType: 'ScrapedWebsite', after: { websites: sites.length, queued } });
    return { websites: sites.length, queued };
  }

  private async providerRef(providerId?: string): Promise<Types.ObjectId | undefined> {
    if (!providerId) return undefined;
    const policy = Types.ObjectId.isValid(providerId) ? await this.policies.exists({ _id: providerId }) : null;
    if (!policy) throw new BadRequestException('Provider not found');
    return new Types.ObjectId(providerId);
  }

  private async uniqueKey(name: string): Promise<string> {
    const base = slugify(name, { lower: true, strict: true }) || 'fingerprint';
    let key = base;
    for (let n = 2; await this.fingerprints.exists({ key }); n++) key = `${base}-${n}`;
    return key;
  }

  private async find(id: string) {
    const fingerprint = Types.ObjectId.isValid(id) ? await this.fingerprints.findById(id) : null;
    if (!fingerprint) throw new NotFoundException('Fingerprint not found');
    return fingerprint;
  }
}
