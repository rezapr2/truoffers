import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AuthorisationSource,
  DomainAuthorisationStatus,
  FingerprintMatchCategory,
  ImportJobType,
  ScraperAdapterStatus,
} from '../../common/scraper.enums';
import { AuthorisedNetwork, AuthorisedNetworkDocument } from '../../schemas/authorised-network.schema';
import { ProviderPolicy, ProviderPolicyDocument } from '../../schemas/provider-policy.schema';
import { ScrapedWebsite, ScrapedWebsiteDocument } from '../../schemas/scraped-website.schema';
import { ScraperAdapter, ScraperAdapterDocument } from '../../schemas/scraper-adapter.schema';
import { WebsiteFingerprint, WebsiteFingerprintDocument } from '../../schemas/website-fingerprint.schema';
import type { PageRole, WebsiteContext } from '../extraction/adapter.types';
import { AdapterRegistry } from '../extraction/adapter-registry.service';
import { GenericHtmlAdapter } from '../extraction/adapters/generic-html.adapter';
import { ExamplePage, suggestSelectorConfig } from '../extraction/selector-suggestion';
import { truncate } from '../extraction/text';
import { validateExtractedOffer } from '../extraction/validate-offer';
import { suggestFingerprint } from '../fingerprinting/builder';
import { extractMarkers, mergeMarkers, SiteMarker } from '../fingerprinting/markers';
import { betterMatch, categoryAtLeast, classRarity, FingerprintScore, scoreFingerprint } from '../fingerprinting/scoring';
import { ScraperSettingsService } from '../review/scraper-settings.service';
import { CrawlDeniedError, CrawlGateService } from '../safety/crawl-gate.service';
import { DomainRegistryService } from '../safety/domain-registry.service';
import { neverCrawlReason } from '../safety/never-crawl';
import { PageBudget } from '../safety/page-budget.service';
import { providerPermitsCrawling } from '../safety/provider-permission';
import { DomainRateLimiter } from '../safety/rate-limiter.service';
import { RobotsService } from '../safety/robots.service';
import { SafeFetchService } from '../safety/safe-fetch.service';
import { SitemapService } from '../safety/sitemap.service';
import { registrableDomainOf, siteDomainOf } from '../safety/url';
import { OPTED_OUT_MATCH_FIELDS } from '../scraper.constants';
import { PageLoader } from './page-loader';
import { StageAbortedError, StageContext, StageOutcome } from './pipeline.service';

export const NETWORK_LIMITS = {
  maxDomainsPerDiscovery: 1000,
  examplePagesPerSite: 4,
  testPagesPerSite: 6,
  markersFreshMs: 24 * 60 * 60 * 1000,
  rarityCorpus: 500,
};

type SiteLean = ScrapedWebsite & { _id: Types.ObjectId };
type FingerprintLean = WebsiteFingerprint & { _id: Types.ObjectId };

/**
 * Phase 2 worker jobs: analysing example sites for a fingerprint, matching sites to fingerprints, dry runs
 * of selector adapters, and registering the websites an authorised network lists. Every request goes
 * through the same page loader, crawl gate, robots and rate limits as import runs.
 */
@Injectable()
export class NetworkJobsService {
  private readonly generic = new GenericHtmlAdapter();

  constructor(
    @InjectModel(ScrapedWebsite.name) private readonly sites: Model<ScrapedWebsiteDocument>,
    @InjectModel(WebsiteFingerprint.name) private readonly fingerprints: Model<WebsiteFingerprintDocument>,
    @InjectModel(ScraperAdapter.name) private readonly adapters: Model<ScraperAdapterDocument>,
    @InjectModel(AuthorisedNetwork.name) private readonly networks: Model<AuthorisedNetworkDocument>,
    @InjectModel(ProviderPolicy.name) private readonly policies: Model<ProviderPolicyDocument>,
    private readonly fetcher: SafeFetchService,
    private readonly gate: CrawlGateService,
    private readonly robots: RobotsService,
    private readonly sitemaps: SitemapService,
    private readonly rateLimiter: DomainRateLimiter,
    private readonly pageBudget: PageBudget,
    private readonly settings: ScraperSettingsService,
    private readonly domains: DomainRegistryService,
    private readonly registry: AdapterRegistry,
  ) {}

  handles(type: ImportJobType): boolean {
    return [ImportJobType.CREATE_FINGERPRINT, ImportJobType.MATCH_FINGERPRINT, ImportJobType.TEST_ADAPTER, ImportJobType.DISCOVER_AUTHORISED_DOMAINS].includes(type);
  }

  run(type: ImportJobType, ctx: StageContext): Promise<StageOutcome> {
    switch (type) {
      case ImportJobType.CREATE_FINGERPRINT:
        return this.createFingerprint(ctx);
      case ImportJobType.MATCH_FINGERPRINT:
        return this.matchFingerprint(ctx);
      case ImportJobType.TEST_ADAPTER:
        return this.testAdapter(ctx);
      case ImportJobType.DISCOVER_AUTHORISED_DOMAINS:
        return this.discoverDomains(ctx);
      default:
        throw new StageAbortedError(`${type} is not a network job`);
    }
  }

  private payload<T extends string>(ctx: StageContext, key: T): string {
    const value = (ctx.job.payload as Record<string, unknown> | undefined)?.[key];
    if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) throw new StageAbortedError(`The job has no valid ${key}`);
    return value;
  }

  private loader(ctx: StageContext, siteDomain: string, adapterKey?: string): PageLoader {
    return new PageLoader(
      { fetcher: this.fetcher, gate: this.gate, robots: this.robots, rateLimiter: this.rateLimiter, pageBudget: this.pageBudget, settings: this.settings },
      { runId: String(ctx.job.runId), siteDomain, adapterKey, signal: ctx.signal, log: (message, data) => void ctx.log(message, data) },
    );
  }

  private context(site: SiteLean, ctx: StageContext, loader: PageLoader): WebsiteContext {
    const seed = new URL(site.seedUrl);
    return {
      site: { id: String(site._id), domain: site.domain, homepageUrl: `${seed.protocol}//${seed.host}/` },
      runId: String(ctx.job.runId),
      checkedAt: ctx.job.startedAt ?? new Date(),
      signal: ctx.signal,
      loadPage: (url) => loader.load(url),
      log: (message, data) => void ctx.log(message, data),
    };
  }

  // The homepage plus the most promising offer pages, with generic extraction run while the DOM is in memory.
  private async examplePages(site: SiteLean, ctx: StageContext, limit: number): Promise<{ pages: ExamplePage[]; markers: SiteMarker[] }> {
    const loader = this.loader(ctx, site.domain);
    const wctx = this.context(site, ctx, loader);
    await this.gate.assertSiteCrawlable(site.domain);
    const discovery = await this.generic.discover(wctx);
    const plan = discovery.pages.filter((p) => p.roles.includes('home') || p.roles.includes('offers')).slice(0, limit);
    const pages: ExamplePage[] = [];
    const markers: SiteMarker[][] = [];
    for (const planned of plan) {
      const page = await loader.load(planned.url);
      if (!page) continue;
      const roles: PageRole[] = planned.roles.length ? planned.roles : ['home'];
      const extraction = this.generic.extractFromPage(page, roles, wctx);
      pages.push({ page, offers: extraction.offers, businesses: extraction.businesses });
      markers.push(extractMarkers(page));
    }
    if (pages.length === 0) throw new StageAbortedError(`No usable pages on ${site.domain}`);
    return { pages, markers: mergeMarkers(...markers) };
  }

  private async storeMarkers(siteId: Types.ObjectId, markers: SiteMarker[]) {
    await this.sites.updateOne({ _id: siteId }, { $set: { siteMarkers: markers, markersExtractedAt: new Date() } });
  }

  // ---------- create_fingerprint ----------

  private async createFingerprint(ctx: StageContext): Promise<StageOutcome> {
    const fingerprint = await this.fingerprints.findById(this.payload(ctx, 'fingerprintId'));
    if (!fingerprint) throw new StageAbortedError('The fingerprint no longer exists');

    const analysed: { pages: ExamplePage[]; markers: SiteMarker[] }[] = [];
    const examples: WebsiteFingerprint['examples'] = [];
    for (const [index, domain] of fingerprint.exampleDomains.entries()) {
      await ctx.progress(index, fingerprint.exampleDomains.length, `Analysing ${domain}`);
      const site = await this.sites.findOne({ domain }).lean<SiteLean>();
      if (!site) {
        examples.push({ domain, pages: [], markers: 0, offersFound: [], error: 'Not a registered website' });
        continue;
      }
      try {
        const result = await this.examplePages(site, ctx, NETWORK_LIMITS.examplePagesPerSite);
        await this.storeMarkers(site._id, result.markers);
        analysed.push(result);
        examples.push({
          domain,
          websiteRef: site._id,
          pages: result.pages.map((p) => p.page.finalUrl),
          markers: result.markers.length,
          offersFound: result.pages.flatMap((p) =>
            p.offers.map((o) => ({ title: o.offer.title, excerpt: truncate(o.offer.sources[0]?.excerpt ?? '', 200), pageUrl: o.pageUrl })),
          ),
        });
      } catch (err) {
        if (!(err instanceof CrawlDeniedError || err instanceof StageAbortedError)) throw err;
        examples.push({ domain, websiteRef: site._id, pages: [], markers: 0, offersFound: [], error: err.message });
      }
    }
    if (analysed.length < 2) {
      await this.fingerprints.updateOne(
        { _id: fingerprint._id },
        { $set: { examples, analysedAt: new Date(), lastJobRef: ctx.job._id }, $unset: { excerptsRedactedAt: 1 } },
      );
      throw new StageAbortedError(`Only ${analysed.length} of ${fingerprint.exampleDomains.length} examples could be analysed; a fingerprint needs two`);
    }

    const others = await this.fingerprints.find({ _id: { $ne: fingerprint._id }, active: true }).select('markers').lean<FingerprintLean[]>();
    const suggestion = suggestFingerprint(analysed.map((a) => a.markers), others);
    const selectors = suggestSelectorConfig(analysed.map((a) => a.pages));
    await this.fingerprints.updateOne(
      { _id: fingerprint._id },
      {
        $set: {
          markers: suggestion.markers,
          examples,
          suggestedConfig: { config: selectors.config ?? null, notes: selectors.notes },
          analysedAt: new Date(),
          lastJobRef: ctx.job._id,
        },
        $unset: { excerptsRedactedAt: 1 },
      },
    );
    await ctx.log(`Fingerprint suggested from ${analysed.length} examples`, { markers: suggestion.markers.length, selectorNotes: selectors.notes });
    return {
      resultCounts: {
        examples: analysed.length,
        markers: suggestion.markers.length,
        sharedTraits: suggestion.sharedByAll,
        selectorConfigSuggested: selectors.config ? 1 : 0,
      },
    };
  }

  // ---------- match_fingerprint ----------

  private async matchFingerprint(ctx: StageContext): Promise<StageOutcome> {
    const site = await this.sites.findById(this.payload(ctx, 'websiteId')).lean<SiteLean>();
    if (!site) throw new StageAbortedError('The website record no longer exists');
    // Stored traits would let an opted-out site be matched without a request; it's dropped from matching instead.
    if (site.authorisationStatus === DomainAuthorisationStatus.OPTED_OUT || (await this.domains.activeOptOutFor(site.domain))) {
      await this.sites.updateOne({ _id: site._id }, { $unset: OPTED_OUT_MATCH_FIELDS });
      await ctx.log(`${site.domain} has opted out and is not matched`);
      return { resultCounts: { fingerprints: 0, matched: 0, skippedOptedOut: 1 } };
    }

    let markers = site.siteMarkers as SiteMarker[] | undefined;
    const fresh = site.markersExtractedAt && Date.now() - new Date(site.markersExtractedAt).getTime() < NETWORK_LIMITS.markersFreshMs;
    if (!markers?.length || !fresh || (ctx.job.payload as { refetch?: boolean } | undefined)?.refetch) {
      await ctx.progress(0, 2, 'Reading the homepage');
      markers = (await this.examplePages(site, ctx, 2)).markers;
      await this.storeMarkers(site._id, markers);
    }

    await ctx.progress(1, 2, 'Scoring against fingerprints');
    const fingerprints = await this.fingerprints.find({ active: true }).lean<FingerprintLean[]>();
    const corpus = await this.sites
      .find({ 'siteMarkers.0': { $exists: true } })
      .select('siteMarkers')
      .limit(NETWORK_LIMITS.rarityCorpus)
      .lean<SiteLean[]>();
    const rarity = classRarity(corpus.map((s) => (s.siteMarkers ?? []) as SiteMarker[]));

    let best: { fingerprint: FingerprintLean; result: FingerprintScore } | null = null;
    for (const fingerprint of fingerprints) {
      best = betterMatch(best, { fingerprint, result: scoreFingerprint(fingerprint, markers, rarity) });
    }
    const category = best?.result.category ?? FingerprintMatchCategory.NONE;
    const matched = best && category !== FingerprintMatchCategory.NONE;
    await this.sites.updateOne(
      { _id: site._id },
      matched
        ? { $set: { fingerprintRef: best!.fingerprint._id, matchScore: best!.result.score, matchCategory: category, fingerprintMatchedAt: new Date() } }
        : { $set: { matchScore: best?.result.score ?? 0, matchCategory: FingerprintMatchCategory.NONE, fingerprintMatchedAt: new Date() }, $unset: { fingerprintRef: 1 } },
    );

    // A confident match to a provider's template links the site to that provider, and the provider gate applies.
    let held = 0;
    if (matched && categoryAtLeast(category, FingerprintMatchCategory.HIGH_CONFIDENCE) && best!.fingerprint.providerRef && !site.providerRef) {
      const policy = await this.policies.findById(best!.fingerprint.providerRef).lean();
      await this.sites.updateOne({ _id: site._id }, { $set: { providerRef: best!.fingerprint.providerRef }, $addToSet: { providerSignals: `fingerprint ${best!.fingerprint.name}` } });
      const reviewRequired = !!(await this.settings.get()).providerReviewRequired;
      if (policy && !providerPermitsCrawling(policy.status, reviewRequired) && site.authorisationStatus === DomainAuthorisationStatus.AUTHORISED) {
        await this.sites.updateOne(
          { _id: site._id },
          { $set: { authorisationStatus: DomainAuthorisationStatus.AWAITING_PROVIDER_REVIEW, lastError: `Matches ${policy.name}'s template (${policy.status})` } },
        );
        held = 1;
      }
    }
    await ctx.log(matched ? `Matched ${best!.fingerprint.name}: ${category} (${best!.result.score})` : 'No fingerprint matched', {
      score: best?.result.score,
      matchedCategories: best?.result.matchedCategories,
      missingRequired: best?.result.missingRequired,
    });
    return { resultCounts: { fingerprints: fingerprints.length, matched: matched ? 1 : 0, score: Math.round(best?.result.score ?? 0), heldForProvider: held } };
  }

  // ---------- test_adapter ----------

  private async testAdapter(ctx: StageContext): Promise<StageOutcome> {
    const record = await this.adapters.findById(this.payload(ctx, 'adapterId')).lean<ScraperAdapter & { _id: Types.ObjectId }>();
    if (!record) throw new StageAbortedError('The adapter version no longer exists');
    // A dry run behaves like a version under test: it only handles its example websites.
    const adapter = await this.registry.fromRecord({ ...record, status: ScraperAdapterStatus.TESTING });

    const domains: Record<string, unknown>[] = [];
    let handled = 0;
    let offersFound = 0;
    for (const [index, domain] of record.exampleDomains.entries()) {
      await ctx.progress(index, record.exampleDomains.length, `Testing on ${domain}`);
      const site = await this.sites.findOne({ domain }).lean<SiteLean>();
      if (!site) {
        domains.push({ domain, canHandle: false, reasons: ['Not a registered website'], offers: [], businesses: [], errors: [] });
        continue;
      }
      const loader = this.loader(ctx, site.domain);
      const wctx = this.context(site, ctx, loader);
      try {
        await this.gate.assertSiteCrawlable(site.domain);
        const match = await adapter.canHandle(wctx);
        const discovery = await adapter.discover(wctx);
        const plan = discovery.pages.slice(0, NETWORK_LIMITS.testPagesPerSite);
        const extractions = await adapter.extractOfferDetails(wctx, plan);
        const businesses = await adapter.extractBusiness({ ...wctx, plan });
        if (match.canHandle) handled += 1;
        offersFound += extractions.length;
        domains.push({
          domain,
          canHandle: match.canHandle,
          templateScore: match.score,
          reasons: match.reasons,
          pages: plan.map((p) => p.url),
          offers: extractions.map(({ offer, flags }) => {
            const validation = validateExtractedOffer(offer, wctx.checkedAt);
            return {
              title: offer.title,
              offerType: offer.offerType,
              discountPercentage: offer.discountPercentage,
              discountAmount: offer.discountAmount,
              promoCode: offer.promoCode,
              minimumOrder: offer.minimumOrder,
              endDate: offer.endDate,
              pageUrl: offer.sources[0]?.url,
              excerpt: truncate(offer.sources[0]?.excerpt ?? '', 300),
              fields: Object.fromEntries(Object.entries(offer.evidence).map(([field, e]) => [field, { text: truncate(e.text, 200), method: e.method }])),
              valid: validation.valid,
              errors: validation.errors,
              flags,
            };
          }),
          businesses: businesses.map((b) => ({ branchPath: b.branchPath, name: b.name, telephone: b.telephone, address: b.address, postcode: b.postcode })),
          errors: [],
        });
      } catch (err) {
        if (!(err instanceof CrawlDeniedError || err instanceof StageAbortedError)) throw err;
        domains.push({ domain, canHandle: false, reasons: [], offers: [], businesses: [], errors: [err.message] });
      }
    }
    const testResults = { ranAt: new Date(), jobId: String(ctx.job._id), summary: { domains: record.exampleDomains.length, handled, offers: offersFound }, domains };
    await this.adapters.updateOne({ _id: record._id }, { $set: { testResults, testedAt: new Date(), lastTestJobRef: ctx.job._id } });
    return { resultCounts: { examples: record.exampleDomains.length, handled, offers: offersFound } };
  }

  // ---------- discover_authorised_domains ----------

  private async discoverDomains(ctx: StageContext): Promise<StageOutcome> {
    const network = await this.networks.findById(this.payload(ctx, 'networkId')).lean<AuthorisedNetwork & { _id: Types.ObjectId }>();
    if (!network || !network.active) throw new StageAbortedError('The network no longer exists or is inactive');
    const settings = await this.settings.get();

    const listed = new Map<string, string>();
    for (const sitemapUrl of network.sitemapUrls) {
      const host = siteDomainOf(new URL(sitemapUrl).hostname);
      const loader = this.loader(ctx, host);
      await ctx.log(`Reading sitemap ${sitemapUrl}`);
      const sites = await this.sitemaps.collectListedSites([sitemapUrl], host, (url) => loader.fetchText(url, 'sitemap'), NETWORK_LIMITS.maxDomainsPerDiscovery - listed.size);
      for (const site of sites) if (!listed.has(site.domain)) listed.set(site.domain, site.seedUrl);
      if (listed.size >= NETWORK_LIMITS.maxDomainsPerDiscovery) break;
    }

    const counts = { listed: listed.size, registered: 0, promoted: 0, linked: 0, skippedNeverCrawl: 0, skippedOptedOut: 0, unchanged: 0 };
    for (const [domain, seedUrl] of listed) {
      if (neverCrawlReason(domain, settings.extraNeverCrawlDomains)) {
        counts.skippedNeverCrawl += 1;
        continue;
      }
      if (await this.domains.activeOptOutFor(domain)) {
        counts.skippedOptedOut += 1;
        continue;
      }
      const existing = await this.sites.findOne({ domain }).lean<SiteLean>();
      const networkFields = { networkRef: network._id, ...(network.providerRef ? { providerRef: network.providerRef } : {}) };
      if (!existing) {
        await this.sites.create({
          domain,
          registrableDomain: registrableDomainOf(domain),
          seedUrl,
          authorisationStatus: DomainAuthorisationStatus.AUTHORISED,
          authorisationSource: AuthorisationSource.NETWORK_SITEMAP,
          authorisedAt: new Date(),
          authorisationNote: `Listed in the ${network.name} network sitemap`,
          businesses: [],
          ...networkFields,
        });
        counts.registered += 1;
      } else if (existing.authorisationStatus === DomainAuthorisationStatus.PENDING_AUTHORISATION) {
        await this.sites.updateOne(
          { _id: existing._id, authorisationStatus: DomainAuthorisationStatus.PENDING_AUTHORISATION },
          {
            $set: {
              authorisationStatus: DomainAuthorisationStatus.AUTHORISED,
              authorisationSource: AuthorisationSource.NETWORK_SITEMAP,
              authorisedAt: new Date(),
              authorisationNote: `Listed in the ${network.name} network sitemap`,
              ...networkFields,
            },
          },
        );
        counts.promoted += 1;
      } else if (existing.authorisationStatus === DomainAuthorisationStatus.AUTHORISED && !existing.networkRef) {
        await this.sites.updateOne({ _id: existing._id }, { $set: { networkRef: network._id } });
        counts.linked += 1;
      } else {
        // Opted-out and provider-held websites stay as they are: a sitemap listing never overrides them.
        counts.unchanged += 1;
      }
    }
    await this.networks.updateOne(
      { _id: network._id },
      { $set: { lastDiscoveredAt: new Date(), lastJobRef: ctx.job._id }, $inc: { domainsRegistered: counts.registered + counts.promoted } },
    );
    return { resultCounts: counts };
  }
}
