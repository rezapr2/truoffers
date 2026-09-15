import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import {
  AuditAction,
  AuthorisationSource,
  DomainAuthorisationStatus,
  FingerprintMatchCategory,
  ImportJobType,
  OptOutSource,
  ProviderPolicyBasis,
} from '../../common/scraper.enums';
import { AuthorisedNetwork, AuthorisedNetworkDocument } from '../../schemas/authorised-network.schema';
import { DomainCrawlConfig, DomainCrawlConfigDocument } from '../../schemas/domain-crawl-config.schema';
import { ProviderPolicy, ProviderPolicyDocument } from '../../schemas/provider-policy.schema';
import { ScrapedWebsite, ScrapedWebsiteDocument } from '../../schemas/scraped-website.schema';
import { AuditService } from '../audit/audit.service';
import { RunsService } from '../queue/runs.service';
import { DomainRegistryService } from '../safety/domain-registry.service';
import { neverCrawlReason } from '../safety/never-crawl';
import { normaliseUrl, registrableDomainOf, siteDomainOf, UrlRejectedError } from '../safety/url';
import { FingerprintsService } from './fingerprints.service';
import { OptOutsService } from './opt-outs.service';
import { ScraperSettingsService } from './scraper-settings.service';
import { WebsitesService } from './websites.service';

export const MAX_BULK = 500;

export type BulkAction = 'authorise' | 'run' | 'pause' | 'resume' | 'opt_out' | 'match_fingerprint';

export interface NetworkInput {
  name?: string;
  sitemapUrls?: string[];
  basis?: ProviderPolicyBasis;
  agreementReference?: string | null;
  basisNotes?: string | null;
  providerId?: string | null;
  active?: boolean;
}

export interface NetworkFilter {
  providerId?: string;
  adapterKey?: string;
  fingerprintId?: string;
  networkId?: string;
  matchCategory?: FingerprintMatchCategory;
  minScore?: number;
  status?: DomainAuthorisationStatus;
  checkedBefore?: string;
  hasErrors?: boolean;
  q?: string;
  groupBy?: 'fingerprint' | 'provider' | 'adapter';
  page?: number;
  limit?: number;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

@Injectable()
export class NetworksService {
  constructor(
    @InjectModel(AuthorisedNetwork.name) private readonly networks: Model<AuthorisedNetworkDocument>,
    @InjectModel(ScrapedWebsite.name) private readonly sites: Model<ScrapedWebsiteDocument>,
    @InjectModel(ProviderPolicy.name) private readonly policies: Model<ProviderPolicyDocument>,
    @InjectModel(DomainCrawlConfig.name) private readonly configs: Model<DomainCrawlConfigDocument>,
    private readonly registry: DomainRegistryService,
    private readonly settings: ScraperSettingsService,
    private readonly runs: RunsService,
    private readonly websiteReview: WebsitesService,
    private readonly optOuts: OptOutsService,
    private readonly fingerprints: FingerprintsService,
    private readonly audit: AuditService,
  ) {}

  // ---------- authorised networks ----------

  async listNetworks() {
    const [networks, counts] = await Promise.all([
      this.networks.find().sort({ name: 1 }).populate('providerRef', 'name status').populate('registeredBy', 'name').lean(),
      this.sites.aggregate([{ $match: { networkRef: { $exists: true } } }, { $group: { _id: { network: '$networkRef', status: '$authorisationStatus' }, count: { $sum: 1 } } }]),
    ]);
    return networks.map((n) => ({
      ...n,
      websites: Object.fromEntries(counts.filter((c) => String(c._id.network) === String(n._id)).map((c) => [c._id.status, c.count])),
    }));
  }

  async createNetwork(input: NetworkInput, userId: string) {
    if (!input.name?.trim()) throw new BadRequestException('Name is required');
    const sitemapUrls = await this.sitemapUrls(input.sitemapUrls ?? []);
    const network = new this.networks({
      name: input.name.trim(),
      sitemapUrls,
      basis: input.basis,
      agreementReference: input.agreementReference ?? undefined,
      basisNotes: input.basisNotes ?? undefined,
      providerRef: await this.providerRef(input.providerId),
      registeredBy: new Types.ObjectId(userId),
    });
    await this.save(network);
    await this.authoriseSitemapHosts(network);
    await this.audit.record({ action: AuditAction.NETWORK_CREATED, targetType: 'AuthorisedNetwork', targetId: network._id, after: this.snapshot(network) });
    return network;
  }

  async updateNetwork(id: string, input: NetworkInput) {
    const network = await this.findNetwork(id);
    const before = this.snapshot(network);
    if (input.name !== undefined) network.name = input.name.trim();
    if (input.sitemapUrls !== undefined) network.sitemapUrls = await this.sitemapUrls(input.sitemapUrls);
    if (input.basis !== undefined) network.basis = input.basis;
    if (input.agreementReference !== undefined) network.agreementReference = input.agreementReference ?? undefined;
    if (input.basisNotes !== undefined) network.basisNotes = input.basisNotes ?? undefined;
    if (input.providerId !== undefined) network.providerRef = await this.providerRef(input.providerId);
    if (input.active !== undefined) network.active = input.active;
    await this.save(network);
    await this.authoriseSitemapHosts(network);
    await this.audit.record({ action: AuditAction.NETWORK_UPDATED, targetType: 'AuthorisedNetwork', targetId: network._id, before, after: this.snapshot(network) });
    return network;
  }

  async discover(id: string, userId: string) {
    const network = await this.findNetwork(id);
    if (!network.active) throw new BadRequestException('Activate the network before discovering its websites');
    const { job, created } = await this.runs.startJob({
      type: ImportJobType.DISCOVER_AUTHORISED_DOMAINS,
      key: `network:${network._id}`,
      label: network.name,
      payload: { networkId: String(network._id) },
      submittedBy: userId,
    });
    await this.audit.record({ action: AuditAction.NETWORK_DISCOVERY_REQUESTED, targetType: 'AuthorisedNetwork', targetId: network._id, after: { jobId: String(job._id), created } });
    return { jobId: String(job._id), runId: String(job.runId), created };
  }

  // The sitemap's own host must be crawlable to read the sitemap; registering the network is that authorisation.
  private async authoriseSitemapHosts(network: AuthorisedNetworkDocument) {
    for (const url of network.sitemapUrls) {
      const parsed = new URL(url);
      const domain = siteDomainOf(parsed.hostname);
      await this.sites.updateOne(
        { domain },
        {
          $setOnInsert: {
            domain,
            registrableDomain: registrableDomainOf(domain),
            seedUrl: `${parsed.protocol}//${parsed.host}/`,
            authorisationStatus: DomainAuthorisationStatus.AUTHORISED,
            authorisationSource: AuthorisationSource.NETWORK_SITEMAP,
            authorisedAt: new Date(),
            authorisationNote: `Sitemap host for the ${network.name} network`,
            networkRef: network._id,
            businesses: [],
          },
        },
        { upsert: true },
      );
      await this.sites.updateOne(
        { domain, authorisationStatus: DomainAuthorisationStatus.PENDING_AUTHORISATION },
        { $set: { authorisationStatus: DomainAuthorisationStatus.AUTHORISED, authorisationSource: AuthorisationSource.NETWORK_SITEMAP, authorisedAt: new Date(), networkRef: network._id } },
      );
    }
  }

  private async sitemapUrls(urls: string[]): Promise<string[]> {
    const settings = await this.settings.get();
    const out: string[] = [];
    for (const raw of [...new Set(urls.map((u) => u.trim()).filter(Boolean))]) {
      let url: string;
      try {
        url = normaliseUrl(raw);
      } catch (err) {
        throw new BadRequestException(err instanceof UrlRejectedError ? err.message : `Not a valid URL: ${raw}`);
      }
      const domain = siteDomainOf(new URL(url).hostname);
      const blocked = neverCrawlReason(domain, settings.extraNeverCrawlDomains);
      if (blocked) throw new BadRequestException(blocked);
      if (await this.registry.activeOptOutFor(domain)) throw new BadRequestException(`${domain} has opted out`);
      out.push(url);
    }
    if (out.length === 0) throw new BadRequestException('Add at least one sitemap URL');
    if (out.length > 20) throw new BadRequestException('A network can have at most 20 sitemaps');
    return out;
  }

  private async providerRef(id?: string | null): Promise<Types.ObjectId | undefined> {
    if (!id) return undefined;
    if (!Types.ObjectId.isValid(id) || !(await this.policies.exists({ _id: id }))) throw new BadRequestException('Provider not found');
    return new Types.ObjectId(id);
  }

  private async save(network: AuthorisedNetworkDocument) {
    try {
      await network.save();
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new BadRequestException('A network with that name already exists');
      if ((err as Error).name === 'ValidationError' || /basis|agreement|sitemap/i.test((err as Error).message)) throw new BadRequestException((err as Error).message);
      throw err;
    }
  }

  private snapshot(network: AuthorisedNetworkDocument) {
    return { name: network.name, sitemapUrls: network.sitemapUrls, basis: network.basis, agreementReference: network.agreementReference, active: network.active };
  }

  private async findNetwork(id: string) {
    const network = Types.ObjectId.isValid(id) ? await this.networks.findById(id) : null;
    if (!network) throw new NotFoundException('Network not found');
    return network;
  }

  // ---------- the website network view ----------

  async websites(filter: NetworkFilter) {
    const match: Record<string, unknown> = {};
    const id = (value?: string) => (value && Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : undefined);
    if (filter.providerId) match.providerRef = id(filter.providerId);
    if (filter.fingerprintId) match.fingerprintRef = id(filter.fingerprintId);
    if (filter.networkId) match.networkRef = id(filter.networkId);
    if (filter.adapterKey) match.adapterId = filter.adapterKey;
    if (filter.matchCategory) match.matchCategory = filter.matchCategory;
    if (filter.minScore !== undefined) match.matchScore = { $gte: filter.minScore };
    if (filter.status) match.authorisationStatus = filter.status;
    if (filter.hasErrors) match.failureCount = { $gt: 0 };
    if (filter.checkedBefore) match.$or = [{ lastSuccessfulCheckAt: { $lt: new Date(filter.checkedBefore) } }, { lastSuccessfulCheckAt: { $exists: false } }];
    if (filter.q) match.domain = new RegExp(escape(filter.q), 'i');

    const limit = Math.min(200, filter.limit ?? 50);
    const page = Math.max(1, filter.page ?? 1);
    const groupField = { fingerprint: '$fingerprintRef', provider: '$providerRef', adapter: '$adapterId' }[filter.groupBy ?? 'fingerprint'];
    const groupPipeline: PipelineStage[] = [{ $match: match }, { $group: { _id: groupField, count: { $sum: 1 } } }, { $sort: { count: -1 } }];

    const [items, total, groups] = await Promise.all([
      this.sites
        .find(match)
        .select('domain authorisationStatus authorisationSource providerRef networkRef fingerprintRef matchScore matchCategory fingerprintMatchedAt adapterId adapterVersion lastSuccessfulCheckAt lastFailedCheckAt lastError failureCount updatedAt')
        .sort({ matchScore: -1, domain: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('providerRef', 'name status')
        .populate('fingerprintRef', 'name key')
        .populate('networkRef', 'name')
        .lean(),
      this.sites.countDocuments(match),
      this.sites.aggregate(groupPipeline),
    ]);
    const paused = new Set((await this.configs.find({ domain: { $in: items.map((i) => i.domain) }, paused: true }).select('domain').lean()).map((c) => c.domain));
    return {
      items: items.map((item) => ({ ...item, paused: paused.has(item.domain) })),
      total,
      page,
      pages: Math.ceil(total / limit),
      groups: groups.map((g) => ({ key: g._id ? String(g._id) : null, count: g.count })),
    };
  }

  async bulk(input: { websiteIds: string[]; action: BulkAction; reason?: string }, userId: string) {
    const ids = [...new Set(input.websiteIds)].filter((id) => Types.ObjectId.isValid(id)).slice(0, MAX_BULK);
    if (ids.length === 0) throw new BadRequestException('Select at least one website');
    const results: { websiteId: string; domain?: string; ok: boolean; message?: string }[] = [];

    if (input.action === 'match_fingerprint') {
      const outcome = await this.fingerprints.requestMatch({ websiteIds: ids }, userId);
      results.push(...ids.map((websiteId) => ({ websiteId, ok: true })));
      await this.recordBulk(input, ids.length, outcome.queued);
      return { action: input.action, results, ...outcome };
    }

    const sites = await this.sites.find({ _id: { $in: ids } }).select('_id domain seedUrl authorisationStatus').lean();
    for (const site of sites) {
      const websiteId = String(site._id);
      try {
        switch (input.action) {
          case 'authorise':
            await this.websiteReview.authorise(websiteId, 'approve', userId, input.reason);
            break;
          case 'run':
            if (site.authorisationStatus !== DomainAuthorisationStatus.AUTHORISED) throw new BadRequestException(`${site.domain} is not authorised`);
            await this.runs.startRun(site, { submittedBy: userId });
            break;
          case 'pause':
          case 'resume':
            await this.websiteReview.setPaused(websiteId, input.action === 'pause', userId, input.reason);
            break;
          case 'opt_out':
            await this.optOuts.create({ domain: site.domain, reason: input.reason ?? 'Opted out from the website network', source: OptOutSource.ADMIN, createdBy: userId });
            break;
        }
        results.push({ websiteId, domain: site.domain, ok: true });
      } catch (err) {
        results.push({ websiteId, domain: site.domain, ok: false, message: (err as Error).message });
      }
    }
    const succeeded = results.filter((r) => r.ok).length;
    await this.recordBulk(input, ids.length, succeeded);
    return { action: input.action, results, succeeded, failed: results.length - succeeded };
  }

  private recordBulk(input: { action: BulkAction; reason?: string }, requested: number, succeeded: number) {
    return this.audit.record({ action: AuditAction.WEBSITES_BULK_ACTION, targetType: 'ScrapedWebsite', after: { action: input.action, requested, succeeded }, note: input.reason });
  }
}
