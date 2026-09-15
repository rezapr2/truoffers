import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  DomainAuthorisationStatus,
  ProviderPolicyStatus,
  ScraperAdapterStatus,
} from '../../common/scraper.enums';
import { DomainCrawlConfig, DomainCrawlConfigDocument } from '../../schemas/domain-crawl-config.schema';
import { ProviderPolicy, ProviderPolicyDocument } from '../../schemas/provider-policy.schema';
import { ScraperAdapter, ScraperAdapterDocument } from '../../schemas/scraper-adapter.schema';
import { ScraperControlService } from '../queue/scraper-control.service';
import { ScraperSettingsService } from '../review/scraper-settings.service';
import { CRAWL_DEFAULTS } from '../scraper.constants';
import { DomainRegistryService, ScrapedWebsiteLean } from './domain-registry.service';
import { FetchDeniedError } from './errors';
import { neverCrawlReason } from './never-crawl';
import { RobotsService } from './robots.service';
import { registrableDomainOf, siteDomainOf } from './url';

export type GateDenial =
  | 'never_crawl'
  | 'opted_out'
  | 'not_registered'
  | 'pending_authorisation'
  | 'awaiting_provider_review'
  | 'provider_not_allowed'
  | 'cross_site'
  | 'domain_paused'
  | 'adapter_paused'
  | 'blocked_path'
  | 'robots_disallowed';

// Denials that only rule out one page; the rest of the site can still be crawled.
export const PAGE_LEVEL_DENIALS: ReadonlySet<GateDenial> = new Set(['blocked_path', 'robots_disallowed', 'cross_site']);

// Denials that pause rather than end work: the job is parked and re-checked later.
export const PARKING_DENIALS: ReadonlySet<GateDenial> = new Set(['domain_paused', 'adapter_paused']);

export class CrawlDeniedError extends FetchDeniedError {
  constructor(
    readonly denial: GateDenial,
    message: string,
  ) {
    super('gate', message);
    this.name = 'CrawlDeniedError';
  }
}

export interface GateContext {
  runId: string;
  siteDomain: string;
  adapterKey?: string;
  checkRobots: boolean;
  signal?: AbortSignal;
  // Rate limiting for requests the gate makes itself (robots.txt).
  throttle?: (url: URL) => Promise<void>;
}

export interface HostCrawlPolicy {
  rateLimitMs: number;
  pageCap: number;
  paused: boolean;
  pausedReason?: string;
  blockedPaths: string[];
}

type ConfigLean = DomainCrawlConfig & { _id: Types.ObjectId };

/**
 * The single authorisation check made before every request, including every redirect hop.
 * Re-reads opt-outs, authorisation and provider policy each time so admin changes apply immediately.
 */
@Injectable()
export class CrawlGateService {
  constructor(
    @InjectModel(DomainCrawlConfig.name) private readonly configs: Model<DomainCrawlConfigDocument>,
    @InjectModel(ProviderPolicy.name) private readonly policies: Model<ProviderPolicyDocument>,
    @InjectModel(ScraperAdapter.name) private readonly adapters: Model<ScraperAdapterDocument>,
    private readonly registry: DomainRegistryService,
    private readonly settings: ScraperSettingsService,
    private readonly control: ScraperControlService,
    private readonly robots: RobotsService,
  ) {}

  async crawlPolicyFor(hostname: string): Promise<HostCrawlPolicy> {
    const host = hostname.toLowerCase();
    const site = siteDomainOf(host);
    // Most specific first: exact host, site domain, registrable domain.
    const keys = [...new Set([host, site, registrableDomainOf(site)])];
    const [settings, found] = await Promise.all([
      this.settings.get(),
      this.configs.find({ domain: { $in: keys } }).lean<ConfigLean[]>(),
    ]);
    const ordered = keys.map((k) => found.find((c) => c.domain === k)).filter((c): c is ConfigLean => !!c);
    const paused = ordered.find((c) => c.paused);
    return {
      rateLimitMs: ordered.find((c) => c.rateLimitMs)?.rateLimitMs ?? settings.defaultRateLimitMs ?? CRAWL_DEFAULTS.rateLimitMs,
      pageCap: ordered.find((c) => c.pageCap)?.pageCap ?? settings.defaultPageCap ?? CRAWL_DEFAULTS.pageCap,
      paused: !!paused,
      pausedReason: paused?.pausedReason,
      blockedPaths: ordered.flatMap((c) => c.blockedPaths ?? []),
    };
  }

  // Site-level checks, used before a run starts and on every request.
  async assertSiteCrawlable(siteDomain: string, adapterKey?: string): Promise<ScrapedWebsiteLean> {
    const settings = await this.settings.get();
    const blocked = neverCrawlReason(siteDomain, settings.extraNeverCrawlDomains);
    if (blocked) throw new CrawlDeniedError('never_crawl', blocked);

    const optOut = await this.registry.activeOptOutFor(siteDomain);
    if (optOut) throw new CrawlDeniedError('opted_out', `${siteDomain} has opted out (${optOut.domain})`);

    const site = await this.registry.siteFor(siteDomain);
    if (!site) throw new CrawlDeniedError('not_registered', `${siteDomain} is not on the authorised domain list`);
    switch (site.authorisationStatus) {
      case DomainAuthorisationStatus.AUTHORISED:
        break;
      case DomainAuthorisationStatus.PENDING_AUTHORISATION:
        throw new CrawlDeniedError('pending_authorisation', `${siteDomain} is awaiting admin authorisation`);
      case DomainAuthorisationStatus.AWAITING_PROVIDER_REVIEW:
        throw new CrawlDeniedError('awaiting_provider_review', `${siteDomain} is awaiting provider policy review`);
      default:
        throw new CrawlDeniedError('opted_out', `${siteDomain} has opted out`);
    }

    if (site.providerRef) {
      const policy = await this.policies.findById(site.providerRef).lean();
      if (policy?.status !== ProviderPolicyStatus.ALLOWED) {
        throw new CrawlDeniedError(
          'provider_not_allowed',
          `${siteDomain} is hosted by ${policy?.name ?? 'an unknown provider'}, which is not allowed`,
        );
      }
    }

    const policy = await this.crawlPolicyFor(siteDomain);
    if (policy.paused) {
      throw new CrawlDeniedError('domain_paused', `${siteDomain} is paused${policy.pausedReason ? `: ${policy.pausedReason}` : ''}`);
    }
    if (adapterKey) {
      // The current version decides: pausing an adapter pauses the version sites are using.
      const paused = await this.adapters.exists({ key: adapterKey, status: ScraperAdapterStatus.PAUSED, isCurrent: { $ne: false } });
      if (paused) throw new CrawlDeniedError('adapter_paused', `Adapter ${adapterKey} is paused`);
    }
    return site;
  }

  async assertRequestAllowed(url: URL, ctx: GateContext): Promise<void> {
    await this.control.checkpoint(ctx.runId);

    const settings = await this.settings.get();
    const blocked = neverCrawlReason(url.hostname, settings.extraNeverCrawlDomains);
    if (blocked) throw new CrawlDeniedError('never_crawl', blocked);

    const domain = siteDomainOf(url.hostname);
    if (domain !== ctx.siteDomain) {
      // Following a link or redirect to another domain never authorises it.
      await this.registry.registerDiscovered(url, ctx.siteDomain);
      throw new CrawlDeniedError('cross_site', `${url.toString()} is on ${domain}, outside ${ctx.siteDomain}`);
    }

    await this.assertSiteCrawlable(domain, ctx.adapterKey);

    const policy = await this.crawlPolicyFor(url.hostname);
    const blockedPath = policy.blockedPaths.find((prefix) => url.pathname.startsWith(prefix));
    if (blockedPath) throw new CrawlDeniedError('blocked_path', `${url.pathname} is blocked (${blockedPath})`);

    if (ctx.checkRobots) {
      const rules = await this.robots.rulesFor(url, {
        signal: ctx.signal,
        beforeRequest: async (hop) => {
          await this.assertRequestAllowed(hop, { ...ctx, checkRobots: false });
          await ctx.throttle?.(hop);
        },
      });
      if (!this.robots.isAllowed(rules, url.toString())) {
        throw new CrawlDeniedError('robots_disallowed', `robots.txt disallows ${url.pathname}`);
      }
    }
  }
}
