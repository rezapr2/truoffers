import * as cheerio from 'cheerio';
import type { LoadedPage } from '../extraction/adapter.types';
import { CrawlDeniedError, CrawlGateService, GateContext, PAGE_LEVEL_DENIALS } from '../safety/crawl-gate.service';
import { FetchFailedError } from '../safety/errors';
import { PageBudget } from '../safety/page-budget.service';
import { DomainRateLimiter } from '../safety/rate-limiter.service';
import { pageDirectives } from '../safety/robots-directives';
import { RobotsService } from '../safety/robots.service';
import { SafeFetchResult, SafeFetchService } from '../safety/safe-fetch.service';
import { pageKey, parseCrawlUrl, registrableDomainOf, siteDomainOf } from '../safety/url';
import type { ScraperSettingsService } from '../review/scraper-settings.service';

export interface PageLoaderDeps {
  fetcher: SafeFetchService;
  gate: CrawlGateService;
  robots: RobotsService;
  rateLimiter: DomainRateLimiter;
  pageBudget: PageBudget;
  settings: ScraperSettingsService;
}

export interface PageLoaderContext {
  runId: string;
  siteDomain: string;
  adapterKey?: string;
  signal: AbortSignal;
  log: (message: string, data?: Record<string, unknown>) => void;
}

// Failures that rule out one page but say nothing about the rest of the site.
const PAGE_LEVEL_FETCH_FAILURES = new Set(['content_type', 'too_large', 'decompression_ratio', 'unsupported_encoding', 'bad_encoding']);

/**
 * Loads pages for one job. Every hop passes the crawl gate and the per-domain rate limiter; each page
 * is fetched at most once per job and counts towards the run's page cap. Page bodies stay in memory.
 */
export class PageLoader {
  private readonly memo = new Map<string, Promise<LoadedPage | null>>();
  private readonly loaded = new Map<string, LoadedPage>();
  readonly skipped = new Map<string, string>();
  fetchedCount = 0;

  // Pages loaded so far in this job, keyed by page key; their DOMs are still in memory.
  loadedPages(): Map<string, LoadedPage> {
    return new Map(this.loaded);
  }

  // A non-page document (sitemap) through the same gate and rate limit; not counted against the page cap.
  async fetchText(url: string, purpose: 'sitemap'): Promise<string | null> {
    const settings = await this.deps.settings.get();
    try {
      const response = await this.deps.fetcher.fetch(url, {
        purpose,
        signal: this.ctx.signal,
        extraNeverCrawlDomains: settings.extraNeverCrawlDomains,
        beforeRequest: async (hop) => {
          await this.deps.gate.assertRequestAllowed(hop, this.gateContext());
          await this.throttle(hop, true);
        },
      });
      return response.status >= 200 && response.status < 300 ? response.body : null;
    } catch (err) {
      if (err instanceof CrawlDeniedError && PAGE_LEVEL_DENIALS.has(err.denial)) return this.skip(url, err.message);
      if (err instanceof FetchFailedError && (PAGE_LEVEL_FETCH_FAILURES.has(err.code) || !err.retryable)) return this.skip(url, err.message);
      throw err;
    }
  }

  constructor(
    private readonly deps: PageLoaderDeps,
    private readonly ctx: PageLoaderContext,
  ) {}

  load(url: string): Promise<LoadedPage | null> {
    let key: string;
    try {
      key = pageKey(url);
    } catch {
      this.skip(url, 'invalid URL');
      return Promise.resolve(null);
    }
    let pending = this.memo.get(key);
    if (!pending) {
      pending = this.fetchPage(url, key);
      this.memo.set(key, pending);
    }
    return pending;
  }

  private skip(url: string, reason: string): null {
    this.skipped.set(url, reason);
    this.ctx.log(`Skipped ${url}: ${reason}`);
    return null;
  }

  private gateContext(): GateContext {
    return {
      runId: this.ctx.runId,
      siteDomain: this.ctx.siteDomain,
      adapterKey: this.ctx.adapterKey,
      checkRobots: true,
      signal: this.ctx.signal,
      throttle: (hop) => this.throttle(hop),
    };
  }

  // robots.txt requests use the plain rate limit; page requests also honour a stricter Crawl-delay,
  // read from the cache the gate has just filled (never fetched here, which would recurse).
  private async throttle(url: URL, withCrawlDelay = false): Promise<void> {
    const policy = await this.deps.gate.crawlPolicyFor(url.hostname);
    let interval = policy.rateLimitMs;
    if (withCrawlDelay) {
      const robots = await this.deps.robots.cachedRulesFor(url);
      if (robots) interval = Math.max(interval, this.deps.robots.crawlDelayMs(robots) ?? 0);
    }
    await this.deps.rateLimiter.acquire(DomainRateLimiter.key(registrableDomainOf(url.hostname)), interval, {
      signal: this.ctx.signal,
    });
  }

  private async fetchPage(url: string, key: string): Promise<LoadedPage | null> {
    let target: URL;
    try {
      target = parseCrawlUrl(url);
    } catch (err) {
      return this.skip(url, (err as Error).message);
    }
    if (siteDomainOf(target.hostname) !== this.ctx.siteDomain) return this.skip(url, 'outside this website');

    const policy = await this.deps.gate.crawlPolicyFor(target.hostname);
    if (!(await this.deps.pageBudget.consume(this.ctx.runId, this.ctx.siteDomain, key, policy.pageCap))) {
      return this.skip(url, `page cap of ${policy.pageCap} reached`);
    }

    const settings = await this.deps.settings.get();
    let response: SafeFetchResult;
    try {
      response = await this.deps.fetcher.fetch(target.toString(), {
        purpose: 'page',
        signal: this.ctx.signal,
        extraNeverCrawlDomains: settings.extraNeverCrawlDomains,
        beforeRequest: async (hop) => {
          await this.deps.gate.assertRequestAllowed(hop, this.gateContext());
          await this.throttle(hop, true);
        },
      });
    } catch (err) {
      if (err instanceof CrawlDeniedError && PAGE_LEVEL_DENIALS.has(err.denial)) return this.skip(url, err.message);
      if (err instanceof FetchFailedError && PAGE_LEVEL_FETCH_FAILURES.has(err.code)) return this.skip(url, err.message);
      throw err;
    }
    this.fetchedCount++;

    if (response.status === 429 || response.status >= 500) {
      throw new FetchFailedError('http_status', `${url} returned HTTP ${response.status}`, true, response.status, response.retryAfterMs);
    }
    if (response.status >= 400) return this.skip(url, `HTTP ${response.status}`);

    const $ = cheerio.load(response.body);
    const directives = pageDirectives(response.headers, $);
    if (directives.noindex) return this.skip(url, 'noindex: page content may not be used');

    const page: LoadedPage = {
      url: target.toString(),
      finalUrl: response.finalUrl,
      status: response.status,
      title: $('title').first().text().trim() || undefined,
      html: response.body,
      $,
      nofollow: directives.nofollow,
      lastModified: response.lastModified && !Number.isNaN(response.lastModified.getTime()) ? response.lastModified : undefined,
      fetchedAt: new Date(),
    };
    this.loaded.set(key, page);
    return page;
  }
}
