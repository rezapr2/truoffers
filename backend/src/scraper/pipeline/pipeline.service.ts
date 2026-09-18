import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { canonicalUkPostcode, normaliseUkPhone } from '../../common/business-identity';
import {
  BranchMatchStatus,
  CandidateStatus,
  ConfidenceBand,
  DomainAuthorisationStatus,
  DuplicateKind,
  ImportJobType,
  OPEN_CANDIDATE_STATUSES,
  OfferManagedBy,
  OfferOrigin,
  RESOLVED_BRANCH_STATUSES,
} from '../../common/scraper.enums';
import { Business, BusinessDocument } from '../../schemas/business.schema';
import {
  candidateOpenKey,
  ExtractedOfferCandidate,
  ExtractedOfferCandidateDocument,
} from '../../schemas/extracted-offer-candidate.schema';
import type { ImportJobDocument } from '../../schemas/import-job.schema';
import { Offer, OfferDocument } from '../../schemas/offer.schema';
import { ScrapedWebsite, ScrapedWebsiteDocument, WebsiteBranch } from '../../schemas/scraped-website.schema';
import type {
  DiscoveredPage,
  ExtractedBusiness,
  LoadedPage,
  OfferExtraction,
  PageRole,
  WebsiteContext,
} from '../extraction/adapter.types';
import { AdapterRegistry } from '../extraction/adapter-registry.service';
import { BuiltinAdapter, mergeBusinesses } from '../extraction/adapters/builtin-adapter';
import type { AiOfferExtractor } from '../extraction/ai/ai-offer-extractor';
import { promotionalTextBlocks } from '../extraction/html-blocks';
import { classifyPage, isCrawlablePath, pagePriority } from '../extraction/page-classifier';
import { validateExtractedOffer } from '../extraction/validate-offer';
import { comparableOfPublished } from '../lifecycle/offer-mapping';
import { RecheckService } from '../lifecycle/recheck.service';
import { RECHECKED_STATUSES } from '../lifecycle/recheck-rules';
import { BusinessMatcherService } from '../matching/business-matcher.service';
import { dedupeDecision, ExistingOfferView, MergedExtraction, mergeRunExtractions } from '../matching/offer-dedupe';
import type { LogLevel } from '../queue/import-jobs.service';
import { ImportJobsService } from '../queue/import-jobs.service';
import { ScraperSettingsService } from '../review/scraper-settings.service';
import { CrawlGateService } from '../safety/crawl-gate.service';
import { DomainRegistryService, ScrapedWebsiteLean } from '../safety/domain-registry.service';
import { PageBudget } from '../safety/page-budget.service';
import { ProviderDetectionService, ProviderMatch } from '../safety/provider-detection.service';
import { providerPermitsCrawling } from '../safety/provider-permission';
import { DomainRateLimiter } from '../safety/rate-limiter.service';
import { RobotsService } from '../safety/robots.service';
import { SafeFetchService } from '../safety/safe-fetch.service';
import { SitemapService } from '../safety/sitemap.service';
import { normaliseUrl, pageKey, registrableDomainOf, siteDomainOf } from '../safety/url';
import { AI_LIMITS, INTAKE_LIMITS, RETENTION } from '../scraper.constants';
import { AI_OFFER_EXTRACTOR } from '../scraper.tokens';
import { computeConfidence } from '../scoring/confidence';
import { RENDER } from '../render/render.constants';
import { BlockedBySiteError, RenderService } from '../render/render.service';
import { RENDER_WORKER_HEARTBEAT_PREFIX } from '../queue/queue.constants';
import { REDIS_CLIENT } from '../scraper.tokens';
import type Redis from 'ioredis';
import { neverCrawlReason } from '../safety/never-crawl';
import { CrawlDeniedError } from '../safety/crawl-gate.service';
import { PageLoader } from './page-loader';

export interface StageContext {
  job: ImportJobDocument;
  signal: AbortSignal;
  log(message: string, data?: Record<string, unknown>, level?: LogLevel): Promise<void>;
  progress(current: number, total: number, message?: string): Promise<void>;
  checkpoint(partial: Record<string, unknown>): Promise<void>;
}

export interface StageOutcome {
  output?: Record<string, unknown>;
  resultCounts?: Record<string, number>;
  next?: ImportJobType;
  // The run stopped on purpose (e.g. provider review, homepage not usable); not a failure.
  held?: string;
}

export class StageAbortedError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = 'StageAbortedError';
  }
}

interface PageExtractionOutput {
  processedUrls: string[];
  // For rechecks: page keys read successfully, and page keys that no longer exist.
  readPages: string[];
  gonePages: string[];
  businesses: ExtractedBusiness[];
  offers: OfferExtraction[];
  aiPages?: { url: string; title?: string; blocks: string[] }[];
}

interface AnalyseOutput extends PageExtractionOutput {
  adapterId: string;
  adapterVersion: string;
  homepageUrl: string;
  plan: DiscoveredPage[];
}

type RunOutputs = Partial<Record<ImportJobType, Record<string, any>>>;

const BUSINESS_PAGE_ROLES: PageRole[] = ['business', 'branch'];
const OFFER_PAGE_ROLES: PageRole[] = ['offers', 'menu', 'branch', 'home'];
const MAX_DISCOVERED_DOMAINS_PER_RUN = 50;
const MAX_SOURCES_PER_OFFER = 10;

/**
 * The Phase 1 stages. Each stage fetches what it needs through one PageLoader, runs every extractor
 * on pages while their DOM is in memory, and hands structured results (never page bodies) to the next.
 */
@Injectable()
export class PipelineService {
  constructor(
    @InjectModel(ScrapedWebsite.name) private readonly sites: Model<ScrapedWebsiteDocument>,
    @InjectModel(Offer.name) private readonly offers: Model<OfferDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(ExtractedOfferCandidate.name) private readonly candidates: Model<ExtractedOfferCandidateDocument>,
    private readonly jobs: ImportJobsService,
    private readonly fetcher: SafeFetchService,
    private readonly gate: CrawlGateService,
    private readonly robots: RobotsService,
    private readonly sitemaps: SitemapService,
    private readonly rateLimiter: DomainRateLimiter,
    private readonly pageBudget: PageBudget,
    private readonly settings: ScraperSettingsService,
    private readonly providers: ProviderDetectionService,
    private readonly domains: DomainRegistryService,
    private readonly registry: AdapterRegistry,
    private readonly matcher: BusinessMatcherService,
    private readonly recheck: RecheckService,
    private readonly renderer: RenderService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(AI_OFFER_EXTRACTOR) private readonly ai: AiOfferExtractor,
  ) {}

  run(type: ImportJobType, ctx: StageContext): Promise<StageOutcome> {
    switch (type) {
      case ImportJobType.ANALYSE_SEED_WEBSITE:
        return this.analyse(ctx);
      case ImportJobType.DISCOVER_OFFER_PAGES:
        return this.discover(ctx);
      case ImportJobType.EXTRACT_BUSINESS:
        return this.extractPages(ctx, BUSINESS_PAGE_ROLES, ImportJobType.EXTRACT_OFFERS);
      case ImportJobType.EXTRACT_OFFERS:
        return this.extractPages(ctx, OFFER_PAGE_ROLES, ImportJobType.MATCH_BUSINESS);
      case ImportJobType.MATCH_BUSINESS:
        return this.matchBusinesses(ctx);
      case ImportJobType.DEDUPLICATE_OFFERS:
        return this.deduplicate(ctx);
      case ImportJobType.RENDER_PAGES:
        return this.renderPages(ctx);
      case ImportJobType.RECHECK_OFFER:
        return this.applyCheck(ctx);
      default:
        throw new StageAbortedError(`${type} is not a website import stage`);
    }
  }

  // ---------- helpers ----------

  private async site(ctx: StageContext): Promise<ScrapedWebsiteLean> {
    const site = await this.sites.findById(ctx.job.scrapedWebsiteRef).lean<ScrapedWebsiteLean>();
    if (!site) throw new StageAbortedError('The website record no longer exists');
    return site;
  }

  private async outputs(ctx: StageContext): Promise<RunOutputs> {
    const stages = await this.jobs.stagesOf(ctx.job.runId).lean();
    const outputs: RunOutputs = {};
    for (const stage of stages) if (stage.output) outputs[stage.type] = stage.output;
    return outputs;
  }

  private loader(ctx: StageContext, siteDomain: string, adapterKey?: string): PageLoader {
    return new PageLoader(
      {
        fetcher: this.fetcher,
        gate: this.gate,
        robots: this.robots,
        rateLimiter: this.rateLimiter,
        pageBudget: this.pageBudget,
        settings: this.settings,
      },
      {
        runId: String(ctx.job.runId),
        siteDomain,
        adapterKey,
        signal: ctx.signal,
        log: (message, data) => void ctx.log(message, data),
      },
    );
  }

  private websiteContext(site: ScrapedWebsiteLean, ctx: StageContext, loader: PageLoader, homepageUrl: string, plan?: DiscoveredPage[]): WebsiteContext {
    return {
      site: { id: String(site._id), domain: site.domain, homepageUrl },
      runId: String(ctx.job.runId),
      checkedAt: ctx.job.startedAt ?? new Date(),
      signal: ctx.signal,
      plan,
      loadPage: (url) => loader.load(url),
      log: (message, data) => void ctx.log(message, data),
    };
  }

  private async adapterFor(analyse: Record<string, any> | undefined): Promise<BuiltinAdapter> {
    const adapter = analyse?.adapterId ? await this.registry.resolve(analyse.adapterId, analyse.adapterVersion) : undefined;
    if (!adapter) throw new StageAbortedError('The adapter chosen for this run is no longer available');
    return adapter;
  }

  private async holdForProvider(site: ScrapedWebsiteLean, match: ProviderMatch): Promise<string | null> {
    await this.sites.updateOne({ _id: site._id }, { $set: { providerRef: match.policyId, providerSignals: match.signals } });
    if (providerPermitsCrawling(match.status, !!(await this.settings.get()).providerReviewRequired)) return null;
    // Held websites aren't checked again until the provider permits crawling and a run is started.
    await this.sites.updateOne(
      { _id: site._id },
      { $set: { authorisationStatus: DomainAuthorisationStatus.AWAITING_PROVIDER_REVIEW, lastError: `Hosted by ${match.name} (${match.status})` }, $unset: { nextCheckAt: 1 } },
    );
    return `${site.domain} is hosted by ${match.name}, whose policy is ${match.status}; held for provider review`;
  }

  private async aiBlocksWanted(): Promise<boolean> {
    return this.ai.available && (await this.settings.get()).aiExtractionEnabled;
  }

  // ---------- analyse_seed_website ----------

  private async analyse(ctx: StageContext): Promise<StageOutcome> {
    const site = await this.site(ctx);
    await this.gate.assertSiteCrawlable(site.domain);

    const seed = new URL(site.seedUrl);
    const before = await this.providers.detectBeforeFetch(seed.hostname);
    if (before) {
      const held = await this.holdForProvider(site, before);
      if (held) return { held };
    }

    const homepageUrl = normaliseUrl(`${seed.protocol}//${seed.host}/`);
    const loader = this.loader(ctx, site.domain);
    await ctx.progress(0, 3, 'Fetching homepage');
    const homepage = await loader.load(homepageUrl);
    if (!homepage) {
      const reason = loader.skipped.get(homepageUrl) ?? 'unavailable';
      await this.sites.updateOne({ _id: site._id }, { $set: { lastFailedCheckAt: new Date(), lastError: `Homepage not usable: ${reason}` }, $inc: { failureCount: 1 } });
      await this.recheck.scheduleAfterFailure(site._id);
      return { held: `The homepage could not be used: ${reason}` };
    }

    const after = await this.providers.detectFromPage(homepage.$);
    if (after) {
      const held = await this.holdForProvider(site, after);
      if (held) return { held };
    }

    const wctx = this.websiteContext(site, ctx, loader, homepageUrl);
    const selection = await this.registry.select(wctx);
    const adapter = selection.adapter;
    await ctx.log(`Selected ${adapter.id}@${adapter.version}`, { considered: selection.considered });
    const robots = await this.robots.cachedRulesFor(new URL(homepageUrl));
    const crawlDelayMs = robots ? this.robots.crawlDelayMs(robots) : undefined;
    await this.sites.updateOne(
      { _id: site._id },
      {
        $set: {
          adapterId: adapter.id,
          adapterVersion: adapter.version,
          ...(robots ? { robots: { status: robots.status, crawlDelaySec: crawlDelayMs ? crawlDelayMs / 1000 : undefined, fetchedAt: robots.fetchedAt } } : {}),
        },
      },
    );

    await ctx.progress(1, 3, 'Discovering pages');
    const discovery = await adapter.discover(wctx);
    let registered = 0;
    for (const url of discovery.offsite.slice(0, MAX_DISCOVERED_DOMAINS_PER_RUN)) {
      if (await this.domains.registerDiscovered(url, site.domain)) registered++;
    }

    // Seed URLs deeper than the homepage are always part of the plan.
    const plan = [...discovery.pages];
    const seedUrl = normaliseUrl(site.seedUrl);
    if (!plan.some((p) => pageKey(p.url) === pageKey(seedUrl))) {
      const roles = classifyPage(new URL(seedUrl));
      plan.push({ url: seedUrl, roles: roles.length ? roles : ['offers'], priority: pagePriority(roles) + 500, source: 'seed' });
    }

    await ctx.progress(2, 3, 'Reading loaded pages');
    const extracted = await this.extractLoaded(loader, plan, adapter, wctx);
    const output: AnalyseOutput = { ...extracted, adapterId: adapter.id, adapterVersion: adapter.version, homepageUrl, plan };
    return {
      output: output as unknown as Record<string, unknown>,
      resultCounts: {
        pagesFetched: loader.fetchedCount,
        pagesPlanned: plan.length,
        domainsDiscovered: registered,
        businesses: extracted.businesses.length,
        offers: extracted.offers.length,
      },
      next: ImportJobType.DISCOVER_OFFER_PAGES,
    };
  }

  // Runs the adapter over every page the loader holds in memory.
  private async extractLoaded(loader: PageLoader, plan: DiscoveredPage[], adapter: BuiltinAdapter, wctx: WebsiteContext): Promise<PageExtractionOutput> {
    const wantAi = await this.aiBlocksWanted();
    const out: PageExtractionOutput = { processedUrls: [], readPages: [], gonePages: [...loader.gone], businesses: [], offers: [], aiPages: wantAi ? [] : undefined };
    for (const [key, page] of loader.loadedPages()) {
      const roles = plan.find((p) => pageKey(p.url) === key)?.roles ?? classifyPage(new URL(page.finalUrl));
      this.collect(out, key, page, roles.length ? roles : ['home'], adapter, wctx, wantAi);
    }
    return out;
  }

  private collect(out: PageExtractionOutput, key: string, page: LoadedPage, roles: PageRole[], adapter: BuiltinAdapter, wctx: WebsiteContext, wantAi: boolean) {
    if (!out.processedUrls.includes(key)) out.processedUrls.push(key);
    for (const read of [key, pageKey(page.finalUrl)]) if (!out.readPages.includes(read)) out.readPages.push(read);
    const result = adapter.extractFromPage(page, roles, wctx);
    out.businesses.push(...result.businesses);
    out.offers.push(...result.offers);
    if (wantAi && out.aiPages && roles.some((r) => r === 'offers' || r === 'home' || r === 'menu')) {
      const blocks = promotionalTextBlocks(page.$);
      if (blocks.length) out.aiPages.push({ url: page.finalUrl, title: page.title, blocks });
    }
  }

  // ---------- discover_offer_pages ----------

  private async discover(ctx: StageContext): Promise<StageOutcome> {
    const site = await this.site(ctx);
    const outputs = await this.outputs(ctx);
    const analyse = outputs[ImportJobType.ANALYSE_SEED_WEBSITE] as AnalyseOutput | undefined;
    if (!analyse) throw new StageAbortedError('Analysis output is missing');
    await this.gate.assertSiteCrawlable(site.domain, analyse.adapterId);

    const loader = this.loader(ctx, site.domain, analyse.adapterId);
    const homepage = new URL(analyse.homepageUrl);
    const robots = await this.robots.cachedRulesFor(homepage);
    const declared = robots ? this.robots.sitemaps(robots) : [];
    const sitemapUrls = declared.filter((u) => {
      try {
        return siteDomainOf(new URL(u).hostname) === site.domain;
      } catch {
        return false;
      }
    });
    if (sitemapUrls.length === 0) sitemapUrls.push(`${homepage.origin}/sitemap.xml`);

    await ctx.progress(0, 1, 'Reading sitemaps');
    const fromSitemaps = await this.sitemaps.collectUrls(sitemapUrls, site.domain, (url) => loader.fetchText(url, 'sitemap'));

    const plan = new Map(analyse.plan.map((p) => [pageKey(p.url), p]));
    let added = 0;
    for (const url of fromSitemaps) {
      const key = pageKey(url);
      if (plan.has(key)) continue;
      const parsed = new URL(url);
      if (!isCrawlablePath(parsed)) continue;
      const roles = classifyPage(parsed);
      if (roles.length === 0) continue;
      plan.set(key, { url, roles, priority: pagePriority(roles), source: 'sitemap' });
      added++;
    }

    const policy = await this.gate.crawlPolicyFor(site.domain);
    const ordered = [...plan.values()].sort((a, b) => b.priority - a.priority).slice(0, policy.pageCap);
    return {
      output: { plan: ordered },
      resultCounts: { sitemapUrls: fromSitemaps.length, pagesAdded: added, pagesPlanned: ordered.length },
      next: ImportJobType.EXTRACT_BUSINESS,
    };
  }

  // ---------- extract_business / extract_offers ----------

  private async extractPages(ctx: StageContext, roles: PageRole[], next: ImportJobType): Promise<StageOutcome> {
    const site = await this.site(ctx);
    const outputs = await this.outputs(ctx);
    const analyse = outputs[ImportJobType.ANALYSE_SEED_WEBSITE] as AnalyseOutput | undefined;
    const plan = (outputs[ImportJobType.DISCOVER_OFFER_PAGES]?.plan ?? analyse?.plan ?? []) as DiscoveredPage[];
    const adapter = await this.adapterFor(analyse);
    await this.gate.assertSiteCrawlable(site.domain, adapter.id);

    const partial = (ctx.job.output?.partial ?? {}) as Partial<PageExtractionOutput>;
    const done = new Set<string>([
      ...(analyse?.processedUrls ?? []),
      ...((outputs[ImportJobType.EXTRACT_BUSINESS]?.processedUrls as string[] | undefined) ?? []),
      ...(partial.processedUrls ?? []),
    ]);
    const wantAi = await this.aiBlocksWanted();
    const out: PageExtractionOutput = {
      processedUrls: partial.processedUrls ?? [],
      readPages: partial.readPages ?? [],
      gonePages: partial.gonePages ?? [],
      businesses: partial.businesses ?? [],
      offers: partial.offers ?? [],
      aiPages: wantAi ? (partial.aiPages ?? []) : undefined,
    };

    const loader = this.loader(ctx, site.domain, adapter.id);
    const wctx = this.websiteContext(site, ctx, loader, analyse!.homepageUrl, plan);
    const targets = plan.filter((p) => p.roles.some((r) => roles.includes(r)) && !done.has(pageKey(p.url)));
    for (const [index, page] of targets.entries()) {
      await ctx.progress(index, targets.length, `Fetching ${page.url}`);
      const loaded = await loader.load(page.url);
      const key = pageKey(page.url);
      if (loaded) this.collect(out, key, loaded, page.roles, adapter, wctx, wantAi);
      else if (!out.processedUrls.includes(key)) out.processedUrls.push(key);
      if (loader.gone.has(key) && !out.gonePages.includes(key)) out.gonePages.push(key);
      await ctx.checkpoint(out as unknown as Record<string, unknown>);
    }
    await ctx.progress(targets.length, targets.length, 'Pages read');

    // Spec §5: a site whose offers only exist after JavaScript runs is rendered before anything else is tried.
    if (next === ImportJobType.MATCH_BUSINESS && this.staticOffersIn(outputs, out) === 0 && (await this.renderingAvailable())) {
      await ctx.log('No offers in the static HTML: queueing a Chromium render');
      return {
        output: out as unknown as Record<string, unknown>,
        resultCounts: { pagesFetched: loader.fetchedCount, pagesSkipped: loader.skipped.size, businesses: out.businesses.length, offers: 0 },
        next: ImportJobType.RENDER_PAGES,
      };
    }

    let aiCounts: Record<string, number> = {};
    if (next === ImportJobType.MATCH_BUSINESS) aiCounts = await this.aiFallback(ctx, outputs, out, adapter);

    return {
      output: out as unknown as Record<string, unknown>,
      resultCounts: { pagesFetched: loader.fetchedCount, pagesSkipped: loader.skipped.size, businesses: out.businesses.length, offers: out.offers.length, ...aiCounts },
      next,
    };
  }

  private staticOffersIn(outputs: RunOutputs, current: PageExtractionOutput): number {
    const earlier = [outputs[ImportJobType.ANALYSE_SEED_WEBSITE], outputs[ImportJobType.EXTRACT_BUSINESS]] as (PageExtractionOutput | undefined)[];
    return current.offers.length + earlier.reduce((n, o) => n + (o?.offers?.length ?? 0), 0);
  }

  // Rendering needs an admin to have enabled it and a render worker to be running (only its image has Chromium).
  private async renderingAvailable(): Promise<boolean> {
    if (!(await this.settings.get()).renderingEnabled) return false;
    try {
      const workers = await this.redis.keys(`${RENDER_WORKER_HEARTBEAT_PREFIX}*`);
      return workers.length > 0;
    } catch {
      return false;
    }
  }

  // Only when the static adapters found no offers anywhere on the site, and only if an admin enabled it.
  private async aiFallback(ctx: StageContext, outputs: RunOutputs, out: PageExtractionOutput, adapter: BuiltinAdapter): Promise<Record<string, number>> {
    if (!(await this.aiBlocksWanted())) return {};
    const earlier = [outputs[ImportJobType.ANALYSE_SEED_WEBSITE], outputs[ImportJobType.EXTRACT_BUSINESS]] as (PageExtractionOutput | undefined)[];
    const staticOffers = out.offers.length + earlier.reduce((n, o) => n + (o?.offers?.length ?? 0), 0);
    if (staticOffers > 0) return {};

    const pages = [...earlier.flatMap((o) => o?.aiPages ?? []), ...(out.aiPages ?? [])].slice(0, AI_LIMITS.maxPagesPerRun);
    let found = 0;
    let dropped = 0;
    for (const page of pages) {
      const result = await this.ai.extract(
        { pageUrl: page.url, pageTitle: page.title, blocks: page.blocks, checkedAt: ctx.job.startedAt ?? new Date(), adapterId: adapter.id, adapterVersion: adapter.version },
        ctx.signal,
      );
      out.offers.push(...result.extractions);
      found += result.extractions.length;
      dropped += result.droppedFields.length;
      await ctx.log(`AI extraction on ${page.url}: ${result.extractions.length} offer(s)`, {
        model: result.model,
        refused: result.refused ?? false,
        droppedFields: result.droppedFields,
        usage: result.usage,
      });
    }
    return { aiPages: pages.length, aiOffers: found, aiFieldsDropped: dropped };
  }

  // One navigation at a time per domain, at the domain's rate limit; a page's own assets aren't throttled.
  private async throttleRendered(hop: URL, signal: AbortSignal): Promise<void> {
    const policy = await this.gate.crawlPolicyFor(hop.hostname);
    await this.rateLimiter.acquire(DomainRateLimiter.key(registrableDomainOf(hop.hostname)), policy.rateLimitMs, { signal });
  }

  // ---------- render_pages ----------

  /**
   * Spec §3/§5: renders the site's offer pages with Chromium and reads the result with the same adapter.
   * Runs in a render worker; every request the browser makes goes through the same permission checks.
   */
  private async renderPages(ctx: StageContext): Promise<StageOutcome> {
    const site = await this.site(ctx);
    const outputs = await this.outputs(ctx);
    const analyse = outputs[ImportJobType.ANALYSE_SEED_WEBSITE] as AnalyseOutput | undefined;
    const plan = (outputs[ImportJobType.DISCOVER_OFFER_PAGES]?.plan ?? analyse?.plan ?? []) as DiscoveredPage[];
    const adapter = await this.adapterFor(analyse);
    await this.gate.assertSiteCrawlable(site.domain, adapter.id);

    const targets = plan
      .filter((p) => p.roles.some((role) => role === 'offers' || role === 'home' || role === 'menu'))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, RENDER.pagesPerRun);
    const out: PageExtractionOutput = { processedUrls: [], readPages: [], gonePages: [], businesses: [], offers: [] };
    if (targets.length === 0) return { output: out as unknown as Record<string, unknown>, resultCounts: { rendered: 0 }, next: ImportJobType.MATCH_BUSINESS };

    const gateContext = {
      runId: String(ctx.job.runId),
      siteDomain: site.domain,
      adapterKey: adapter.id,
      signal: ctx.signal,
    };
    const settings = await this.settings.get();
    let rendered;
    try {
      rendered = await this.renderer.render({
        siteDomain: site.domain,
        urls: targets.map((p) => p.url),
        signal: ctx.signal,
        log: (message, data) => void ctx.log(message, data),
        // Host-level, for everything the browser connects to, including redirect hops it follows itself.
        assertHostAllowed: async (url) => {
          const blocked = neverCrawlReason(url.hostname, settings.extraNeverCrawlDomains);
          if (blocked) throw new CrawlDeniedError('never_crawl', blocked);
        },
        // Full URLs, for the website's own pages: robots.txt, blocked paths, authorisation and the rate limit.
        assertUrlAllowed: async (url, navigation) => {
          await this.gate.assertRequestAllowed(url, {
            ...gateContext,
            checkRobots: true,
            throttle: navigation ? (hop) => this.throttleRendered(hop, ctx.signal) : undefined,
          });
        },
      });
    } catch (err) {
      if (err instanceof BlockedBySiteError) {
        // Spec §3: a challenge or login wall stops the job and the site is left alone for a while.
        await this.sites.updateOne(
          { _id: site._id },
          { $set: { renderBlockedAt: new Date(), lastError: err.message, nextCheckAt: new Date(Date.now() + RENDER.blockedBackoffHours * 60 * 60 * 1000) } },
        );
        return { held: err.message };
      }
      throw err;
    }

    const loader = this.loader(ctx, site.domain, adapter.id);
    const wctx = this.websiteContext(site, ctx, loader, analyse!.homepageUrl, plan);
    for (const page of rendered.pages) {
      const roles = plan.find((p) => pageKey(p.url) === pageKey(page.url))?.roles ?? classifyPage(new URL(page.finalUrl));
      this.collect(out, pageKey(page.url), page, roles.length ? roles : ['offers'], adapter, wctx, false);
    }
    await ctx.log(`Rendered ${rendered.pages.length} page(s): ${out.offers.length} offer(s), ${rendered.blockedRequests} request(s) blocked`);
    if (rendered.pages.length) await this.sites.updateOne({ _id: site._id }, { $unset: { renderBlockedAt: 1 } });
    return {
      output: out as unknown as Record<string, unknown>,
      resultCounts: { rendered: rendered.pages.length, offers: out.offers.length, blockedRequests: rendered.blockedRequests, browserMemoryMb: rendered.memoryMb },
      next: ImportJobType.MATCH_BUSINESS,
    };
  }

  // ---------- match_business ----------

  private async matchBusinesses(ctx: StageContext): Promise<StageOutcome> {
    const site = await this.site(ctx);
    const outputs = await this.outputs(ctx);
    const found = mergeBusinesses(
      [ImportJobType.ANALYSE_SEED_WEBSITE, ImportJobType.EXTRACT_BUSINESS, ImportJobType.EXTRACT_OFFERS, ImportJobType.RENDER_PAGES].flatMap(
        (type) => (outputs[type]?.businesses as ExtractedBusiness[] | undefined) ?? [],
      ),
    ).slice(0, INTAKE_LIMITS.maxBranchesPerSite);

    const counts = { branches: found.length, autoMatched: 0, needsReview: 0, newProposed: 0, keptDecisions: 0 };
    const now = new Date();
    for (const [index, business] of found.entries()) {
      await ctx.progress(index, found.length, `Matching ${business.branchPath}`);
      const snapshot = {
        name: business.name,
        telephone: business.telephone,
        phoneE164: normaliseUkPhone(business.telephone) ?? undefined,
        address: business.address,
        postcode: canonicalUkPostcode(business.postcode) ?? undefined,
        town: business.town,
        website: business.website,
        orderUrl: business.orderUrl,
        sourceUrl: business.sourceUrl,
        evidence: business.evidence,
      };
      const existing = site.businesses.find((b) => b.branchPath === business.branchPath);
      if (existing && (existing.matchStatus === BranchMatchStatus.CONFIRMED || existing.matchStatus === BranchMatchStatus.REJECTED)) {
        // An admin already decided this branch; only refresh what the site says.
        await this.sites.updateOne(
          { _id: site._id, 'businesses.branchPath': business.branchPath },
          { $set: { 'businesses.$.extracted': snapshot, 'businesses.$.lastSeenAt': now } },
        );
        counts.keptDecisions++;
        continue;
      }

      const decision = await this.matcher.match(business, site.domain);
      if (decision.status === BranchMatchStatus.AUTO_MATCHED) counts.autoMatched++;
      else if (decision.status === BranchMatchStatus.NEEDS_REVIEW) counts.needsReview++;
      else counts.newProposed++;

      const entry: Partial<WebsiteBranch> = {
        branchPath: business.branchPath,
        branchLabel: business.branchLabel,
        businessRef: decision.businessId,
        matchStatus: decision.status,
        matchScore: decision.score,
        matchSignals: decision.signals,
        suggestions: decision.suggestions.map((s) => ({ businessRef: s.businessId, score: s.score, signals: s.signals })),
        extracted: snapshot,
        lastSeenAt: now,
      };
      if (existing) {
        await this.sites.updateOne(
          { _id: site._id, 'businesses.branchPath': business.branchPath },
          { $set: Object.fromEntries(Object.entries(entry).map(([k, v]) => [`businesses.$.${k}`, v])) },
        );
      } else {
        // Conditional push keeps branchPath unique within the site document.
        await this.sites.updateOne({ _id: site._id, 'businesses.branchPath': { $ne: business.branchPath } }, { $push: { businesses: entry } });
      }
      if (decision.businessId) {
        await this.businesses.updateOne(
          { _id: decision.businessId, 'importSource.scrapedWebsiteRef': site._id },
          { $set: { 'importSource.lastCheckedAt': now } },
        );
      }
    }
    return { output: { branches: found.map((b) => b.branchPath) }, resultCounts: counts, next: ImportJobType.DEDUPLICATE_OFFERS };
  }

  // ---------- deduplicate_offers ----------

  private async deduplicate(ctx: StageContext): Promise<StageOutcome> {
    const site = await this.sites.findById(ctx.job.scrapedWebsiteRef).lean<ScrapedWebsiteLean>();
    if (!site) throw new StageAbortedError('The website record no longer exists');
    const outputs = await this.outputs(ctx);
    const analyse = outputs[ImportJobType.ANALYSE_SEED_WEBSITE] as AnalyseOutput | undefined;
    const extractions = [ImportJobType.ANALYSE_SEED_WEBSITE, ImportJobType.EXTRACT_BUSINESS, ImportJobType.EXTRACT_OFFERS, ImportJobType.RENDER_PAGES].flatMap(
      (type) => (outputs[type]?.offers as OfferExtraction[] | undefined) ?? [],
    );
    const merged = mergeRunExtractions(extractions);
    const checkedAt = ctx.job.startedAt ?? new Date();

    const branches = site.businesses.filter((b) => b.matchStatus !== BranchMatchStatus.REJECTED);
    const resolvedIds = branches.filter((b) => b.businessRef && RESOLVED_BRANCH_STATUSES.includes(b.matchStatus)).map((b) => b.businessRef!);
    const [existingOffers, matchedBusinesses] = await Promise.all([
      this.offers
        .find({ businessId: { $in: resolvedIds } })
        .select('businessId contentFingerprint status origin managedBy title discountType value code minOrder freeItem promotionalPrice applicableProducts endsAt')
        .lean(),
      this.businesses.find({ _id: { $in: resolvedIds } }).select('postcodeCanonical').lean(),
    ]);
    const offersByBusiness = new Map<string, ExistingOfferView[]>();
    for (const offer of existingOffers) {
      const list = offersByBusiness.get(String(offer.businessId)) ?? [];
      list.push({
        ...comparableOfPublished(offer as unknown as Offer),
        id: offer._id,
        contentFingerprint: offer.contentFingerprint,
        status: offer.status,
        origin: offer.origin,
        managedBy: offer.managedBy,
      });
      offersByBusiness.set(String(offer.businessId), list);
    }

    const counts = { offersSeen: merged.length, candidatesCreated: 0, candidatesMerged: 0, offersRefreshed: 0, merchantOwned: 0, suppressed: 0, failedExtractions: 0, revisionsProposed: 0, merchantSourceChanged: 0 };
    // Published offers found again (spec §9 rechecks), and those found with changed terms.
    const seenOfferIds = new Set<string>();
    const revisedOfferIds = new Set<string>();
    const viewOf = (id: Types.ObjectId) => [...offersByBusiness.values()].flat().find((o) => String(o.id) === String(id));
    for (const [index, extraction] of merged.entries()) {
      await ctx.progress(index, merged.length, 'Checking duplicates');
      const targetPaths = extraction.branchPaths ?? (branches.length ? branches.map((b) => b.branchPath) : ['/']);
      const candidatePaths: string[] = [];
      const flags = [...extraction.flags];
      let duplicate: ExtractedOfferCandidate['duplicate'];
      let previousOfferRef: Types.ObjectId | undefined;

      for (const path of targetPaths) {
        const branch = branches.find((b) => b.branchPath === path);
        const resolved = branch?.businessRef && RESOLVED_BRANCH_STATUSES.includes(branch.matchStatus);
        if (!resolved) {
          candidatePaths.push(path);
          continue;
        }
        const decision = dedupeDecision(extraction.offer, offersByBusiness.get(String(branch!.businessRef)) ?? [], []);
        switch (decision.kind) {
          case 'refresh_offer':
            await this.refreshOffer(decision.offerId, extraction, checkedAt);
            seenOfferIds.add(String(decision.offerId));
            counts.offersRefreshed++;
            break;
          case 'merchant_owned':
            seenOfferIds.add(String(decision.offerId));
            counts.merchantOwned++;
            break;
          case 'suppressed':
            counts.suppressed++;
            await ctx.log(`Suppressed "${extraction.offer.title}": ${decision.reason}`);
            break;
          case 'changed_terms': {
            const view = viewOf(decision.offerId);
            // Spec §9: the business manages its offer, so the recheck may only tell it the website changed.
            if (view && (view.origin === OfferOrigin.MERCHANT || view.managedBy === OfferManagedBy.MERCHANT)) {
              await this.recheck.flagSourceChanged(decision.offerId);
              seenOfferIds.add(String(decision.offerId));
              counts.merchantSourceChanged++;
              break;
            }
            // Spec §9: changed terms on a published imported offer become an OfferRevision; the public offer stays.
            if (view && RECHECKED_STATUSES.includes(view.status)) {
              const proposal = await this.recheck.proposeRevision(decision.offerId, extraction, ctx.job.runId, site.domain);
              if (proposal !== 'not_applicable') {
                seenOfferIds.add(String(decision.offerId));
                if (proposal === 'opened' || proposal === 'updated') {
                  revisedOfferIds.add(String(decision.offerId));
                  counts.revisionsProposed++;
                  await ctx.log(`Changed terms found for "${extraction.offer.title}": revision ${proposal}`);
                }
                break;
              }
            }
            candidatePaths.push(path);
            duplicate = { kind: DuplicateKind.CHANGED_TERMS, offerRef: decision.offerId, diff: decision.diff };
            break;
          }
          case 'reappeared':
            candidatePaths.push(path);
            duplicate = { kind: DuplicateKind.REAPPEARED, offerRef: decision.offerId };
            previousOfferRef = decision.offerId;
            break;
          case 'merge_candidate':
          case 'new':
            candidatePaths.push(path);
            if (decision.kind === 'new' && decision.previouslyRemovedByAdmin) flags.push('previously_removed_by_admin');
            break;
        }
      }
      if (candidatePaths.length === 0) continue;

      const targetBranches = candidatePaths.map((p) => branches.find((b) => b.branchPath === p));
      const businessIdentityMatched = targetBranches.every((b) => b?.businessRef && RESOLVED_BRANCH_STATUSES.includes(b.matchStatus));
      const addressMatched = targetBranches.some(
        (b) => !!b?.extracted?.postcode && matchedBusinesses.some((m) => String(m._id) === String(b.businessRef) && m.postcodeCanonical === b.extracted!.postcode),
      );
      const validation = validateExtractedOffer(extraction.offer, checkedAt);
      const confidence = computeConfidence({
        extraction,
        validation,
        specificAdapter: (analyse?.adapterId ?? extraction.offer.adapterId) !== 'generic-html',
        businessIdentityMatched,
        addressMatched,
        seenOnPages: extraction.pageUrls.length,
        conflicts: extraction.conflicts,
        corroboratedByStatic: !extraction.signals.aiOnly,
        checkedAt,
      });
      if (duplicate?.kind === DuplicateKind.CHANGED_TERMS) flags.push('changed_terms');
      if (extraction.conflicts.length) duplicate ??= { kind: DuplicateKind.CONFLICT };

      const outcome = await this.upsertCandidate(ctx, site, extraction, candidatePaths, {
        confidence,
        validationErrors: validation.errors,
        flags,
        duplicate,
        previousOfferRef,
      });
      if (outcome === 'suppressed') {
        counts.suppressed++;
        continue;
      }
      if (outcome === 'merged') counts.candidatesMerged++;
      else counts.candidatesCreated++;
      if (confidence.band === ConfidenceBand.FAILED) counts.failedExtractions++;
    }

    await this.sites.updateOne(
      { _id: site._id },
      { $set: { lastSuccessfulCheckAt: new Date(), failureCount: 0, lastRunRef: ctx.job.runId }, $unset: { lastError: 1 } },
    );
    return {
      output: { seenOfferIds: [...seenOfferIds], revisedOfferIds: [...revisedOfferIds] },
      resultCounts: counts,
      next: ImportJobType.RECHECK_OFFER,
    };
  }

  // ---------- recheck_offer ----------

  private async applyCheck(ctx: StageContext): Promise<StageOutcome> {
    const site = await this.site(ctx);
    const outputs = await this.outputs(ctx);
    const pageStages = [ImportJobType.ANALYSE_SEED_WEBSITE, ImportJobType.EXTRACT_BUSINESS, ImportJobType.EXTRACT_OFFERS, ImportJobType.RENDER_PAGES].map(
      (type) => outputs[type] as Partial<PageExtractionOutput> | undefined,
    );
    const dedupe = outputs[ImportJobType.DEDUPLICATE_OFFERS] as { seenOfferIds?: string[]; revisedOfferIds?: string[] } | undefined;
    if (!dedupe) throw new StageAbortedError('Duplicate check output is missing');
    const counts = await this.recheck.applyCheck(
      site._id,
      {
        seenOfferIds: new Set(dedupe.seenOfferIds ?? []),
        readPages: new Set(pageStages.flatMap((o) => o?.readPages ?? [])),
        gonePages: new Set(pageStages.flatMap((o) => o?.gonePages ?? [])),
      },
      new Set(dedupe.revisedOfferIds ?? []),
      ctx.job.startedAt ?? new Date(),
    );
    if (counts.possiblyRemoved || counts.expiryReview || counts.republished) {
      await ctx.log(`Recheck: ${counts.possiblyRemoved} possibly removed, ${counts.expiryReview} to expiry review, ${counts.republished} republished`);
    }
    return { resultCounts: counts };
  }

  private async refreshOffer(offerId: Types.ObjectId, extraction: MergedExtraction, checkedAt: Date) {
    const current = await this.offers.findById(offerId).select('sources').lean();
    const known = new Set((current?.sources ?? []).map((s) => s.url));
    const additions = extraction.offer.sources.filter((s) => !known.has(s.url));
    await this.offers.updateOne(
      { _id: offerId, managedBy: { $ne: OfferManagedBy.MERCHANT } },
      {
        $set: { lastCheckedAt: checkedAt },
        ...(additions.length ? { $push: { sources: { $each: additions, $slice: -MAX_SOURCES_PER_OFFER } } } : {}),
      },
    );
  }

  private async upsertCandidate(
    ctx: StageContext,
    site: ScrapedWebsiteLean,
    extraction: MergedExtraction,
    branchPaths: string[],
    extra: {
      confidence: ReturnType<typeof computeConfidence>;
      validationErrors: string[];
      flags: string[];
      duplicate?: ExtractedOfferCandidate['duplicate'];
      previousOfferRef?: Types.ObjectId;
    },
  ): Promise<'created' | 'merged' | 'suppressed'> {
    const { offer } = extraction;
    const failed = extra.confidence.band === ConfidenceBand.FAILED;
    const status = failed ? CandidateStatus.FAILED_EXTRACTION : CandidateStatus.PENDING_REVIEW;
    const flags = [...new Set([...extra.flags, ...extra.confidence.caps.map((c) => `cap:${c}`)])];
    branchPaths = [...new Set(branchPaths)].sort();
    const openKey = candidateOpenKey({ scrapedWebsiteRef: site._id, branchPaths, contentFingerprint: offer.contentFingerprint, status: CandidateStatus.PENDING_REVIEW });

    let existing = openKey
      ? await this.candidates.findOne({ openKey, status: { $in: OPEN_CANDIDATE_STATUSES } })
      : null;
    if (!existing) {
      // The same offer seen before: a rejected one stays rejected, a failed one is updated in place.
      const closed = await this.candidates
        .findOne({
          scrapedWebsiteRef: site._id,
          contentFingerprint: offer.contentFingerprint,
          branchPaths,
          status: { $in: [CandidateStatus.REJECTED, CandidateStatus.FAILED_EXTRACTION] },
        })
        .sort({ updatedAt: -1 });
      if (closed?.status === CandidateStatus.REJECTED) return 'suppressed';
      existing = closed;
    }
    if (existing) {
      const known = new Set(existing.sources.map((s) => s.url));
      existing.sources.push(...offer.sources.filter((s) => !known.has(s.url)));
      existing.sources.splice(0, Math.max(0, existing.sources.length - MAX_SOURCES_PER_OFFER));
      existing.set({
        runRef: ctx.job.runId,
        lastCheckedAt: offer.lastCheckedAt,
        confidenceScore: extra.confidence.score,
        confidenceBand: extra.confidence.band,
        confidenceSignals: extra.confidence.signals,
        flags: [...new Set([...existing.flags, ...flags])],
        conflicts: extraction.conflicts,
        status:
          existing.status === CandidateStatus.AWAITING_MERCHANT_CONFIRMATION
            ? existing.status
            : failed
              ? CandidateStatus.FAILED_EXTRACTION
              : CandidateStatus.PENDING_REVIEW,
        excerptsRedactAfter: failed ? new Date(Date.now() + RETENTION.excerptDays * 24 * 60 * 60 * 1000) : existing.excerptsRedactAfter,
      });
      await existing.save();
      return 'merged';
    }

    const { sources, evidence, confidenceScore: _score, lastCheckedAt, ...fields } = offer;
    try {
      await this.candidates.create({
        ...fields,
        runRef: ctx.job.runId,
        scrapedWebsiteRef: site._id,
        domain: site.domain,
        branchPaths,
        sources,
        evidence,
        lastCheckedAt,
        confidenceScore: extra.confidence.score,
        confidenceBand: extra.confidence.band,
        confidenceSignals: extra.confidence.signals,
        flags,
        conflicts: extraction.conflicts,
        duplicate: extra.duplicate,
        previousOfferRef: extra.previousOfferRef,
        status,
        reviewNote: failed ? extra.validationErrors.join('; ') || undefined : undefined,
        excerptsRedactAfter: failed ? new Date(Date.now() + RETENTION.excerptDays * 24 * 60 * 60 * 1000) : undefined,
      });
      return 'created';
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      return 'merged';
    }
  }
}
