import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import * as cheerio from 'cheerio';
import type { Browser, BrowserContext, BrowserServer, Route } from 'playwright-core';
import { registrableDomainOf, siteDomainOf } from '../safety/url';
import { botUserAgent } from '../scraper.constants';
import type { LoadedPage } from '../extraction/adapter.types';
import { FetchAbortedError, FetchDeniedError, FetchFailedError } from '../safety/errors';
import { HOST_RESOLVER, NETWORK_POLICY } from '../scraper.tokens';
import type { HostResolver } from '../safety/pinned-lookup';
import type { NetworkPolicy } from '../safety/ssrf-policy';
import { BLOCKED_RESOURCE_TYPES, CHALLENGE_MARKERS, LOGIN_MARKERS, RENDER, TRACKER_HOSTS } from './render.constants';
import { processTreeRssMb } from './process-memory';
import { ProxyChecks, ValidatingProxy } from './validating-proxy';

// The site answered with a challenge, CAPTCHA or login wall: stop and leave it alone (spec §3).
export class BlockedBySiteError extends Error {
  readonly retryable = false;
  constructor(readonly url: string, reason: string) {
    super(`${url} answered with ${reason}`);
    this.name = 'BlockedBySiteError';
  }
}

export interface RenderRequest {
  siteDomain: string;
  urls: string[];
  signal: AbortSignal;
  log: (message: string, data?: Record<string, unknown>) => void;
  /** Host-level checks for every connection the browser makes, including each hop of a redirect chain. */
  assertHostAllowed: ProxyChecks['assertAllowed'];
  /** The crawl gate for a full URL the browser is about to request: robots.txt, blocked paths, authorisation. */
  assertUrlAllowed(url: URL, navigation: boolean): Promise<void>;
}

export interface RenderResult {
  pages: LoadedPage[];
  blockedRequests: number;
  memoryMb: number;
}

export function isTrackerHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return TRACKER_HOSTS.some((tracker) => host === tracker || host.endsWith(`.${tracker}`));
}

function challengeReason(html: string, status: number): string | null {
  if (status === 401) return 'a login wall';
  if (status === 403 || status === 429) return `HTTP ${status}`;
  if (CHALLENGE_MARKERS.some((pattern) => pattern.test(html))) return 'a bot challenge';
  if (LOGIN_MARKERS.some((pattern) => pattern.test(html))) return 'a login form';
  return null;
}

/**
 * Spec §3/§5: renders a page with Chromium when the static adapters found no offer content, so the same
 * adapters can read the DOM the visitor sees. Every request goes through a validating proxy, images, media,
 * fonts and trackers never load, and the browser is restarted if it goes over its memory ceiling.
 */
@Injectable()
export class RenderService implements OnApplicationShutdown {
  private readonly logger = new Logger(RenderService.name);
  // How many times the browser has been restarted for going over its memory ceiling.
  restarts = 0;
  private browser?: Browser;
  private server?: BrowserServer;
  private launching?: Promise<Browser>;

  constructor(
    @Inject(NETWORK_POLICY) private readonly policy: NetworkPolicy,
    @Inject(HOST_RESOLVER) private readonly resolver: HostResolver,
  ) {}

  private async launch(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    // One launch at a time, even if two jobs arrive together.
    this.launching ??= this.startBrowser().finally(() => {
      this.launching = undefined;
    });
    return this.launching;
  }

  private async startBrowser(): Promise<Browser> {
    const { chromium } = await import('playwright-core');
    // A browser server rather than a plain launch: it exposes the process to sample and to restart.
    this.server = await chromium.launchServer({
      args: [
        // Nothing may leave through a path the proxy cannot see.
        '--dns-prefetch-disable',
        '--disable-quic',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--disable-features=WebRtcHideLocalIpsWithMdns,PreconnectToSearch,NetworkPrediction',
        '--disable-background-networking',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    this.browser = await chromium.connect(this.server.wsEndpoint());
    this.logger.log(`Chromium ${this.browser.version()} ready (pid ${this.server.process().pid})`);
    return this.browser;
  }

  async render(request: RenderRequest): Promise<RenderResult> {
    const proxy = await ValidatingProxy.start({
      policy: this.policy,
      resolver: this.resolver,
      assertAllowed: async (url, kind) => {
        if (isTrackerHost(url.hostname)) throw new FetchDeniedError('gate', `${url.hostname} is an analytics or advertising host`);
        await request.assertHostAllowed(url, kind);
      },
    });
    const browser = await this.launch();
    const context = await browser.newContext({
      userAgent: botUserAgent(),
      proxy: { server: `http://127.0.0.1:${proxy.port}` },
      javaScriptEnabled: true,
      serviceWorkers: 'block',
      viewport: { width: 1280, height: 1024 },
    });
    context.setDefaultNavigationTimeout(RENDER.navigationTimeoutMs);

    // Cancellation and the emergency stop close the pages at once, not at the next checkpoint.
    const abort = () => void context.close().catch(() => undefined);
    request.signal.addEventListener('abort', abort, { once: true });
    const watcher = this.watchMemory(browser, request.log);

    try {
      await context.route('**/*', (route) => this.filter(route, request));
      const pages: LoadedPage[] = [];
      for (const url of request.urls.slice(0, RENDER.pagesPerRun)) {
        if (request.signal.aborted) throw new FetchAbortedError('Rendering was cancelled');
        const page = await this.renderOne(context, url, request);
        if (page) pages.push(page);
      }
      if (request.signal.aborted) throw new FetchAbortedError('Rendering was cancelled');
      if (watcher.restarted) throw this.overMemory(watcher.peakMb);
      return { pages, blockedRequests: proxy.records.filter((r) => !r.allowed).length, memoryMb: watcher.peakMb };
    } catch (err) {
      // A restart for memory closes everything mid-render; the job is retried with a fresh browser.
      if (watcher.restarted && !(err instanceof FetchAbortedError)) throw this.overMemory(watcher.peakMb);
      throw err;
    } finally {
      request.signal.removeEventListener('abort', abort);
      watcher.stop();
      await context.close().catch(() => undefined);
      await proxy.close();
    }
  }

  /**
   * The browser sees every full URL, so this is where path-level rules are applied: resource types that are
   * never offer content, analytics hosts, navigations off the website, and the crawl gate for its own pages.
   */
  private async filter(route: Route, request: RenderRequest) {
    const browserRequest = route.request();
    const url = new URL(browserRequest.url());
    const navigation = browserRequest.isNavigationRequest();
    if (BLOCKED_RESOURCE_TYPES.includes(browserRequest.resourceType() as (typeof BLOCKED_RESOURCE_TYPES)[number])) return route.abort();
    if (isTrackerHost(url.hostname)) return route.abort();
    // Scripts and styles from anywhere are needed to render; navigations stay on the website being crawled.
    const sameSite = siteDomainOf(url.hostname) === request.siteDomain || registrableDomainOf(url.hostname) === registrableDomainOf(request.siteDomain);
    if (navigation && !sameSite) return route.abort();
    if (sameSite) {
      try {
        await request.assertUrlAllowed(url, navigation);
      } catch (err) {
        request.log(`Blocked ${url.pathname}: ${(err as Error).message}`);
        return route.abort();
      }
    }
    return route.continue();
  }

  private async renderOne(context: BrowserContext, url: string, request: RenderRequest): Promise<LoadedPage | null> {
    const page = await context.newPage();
    try {
      let response;
      try {
        response = await page.goto(url, { waitUntil: 'domcontentloaded' });
      } catch (err) {
        if (request.signal.aborted) throw new FetchAbortedError('Rendering was cancelled');
        // The gate refused the page, or it would not load: that page is skipped, like a failed fetch.
        request.log(`Could not render ${url}: ${(err as Error).message.split('\n')[0]}`);
        return null;
      }
      if (!response) {
        request.log(`Rendered nothing for ${url}`);
        return null;
      }
      // Give client-side rendering a moment to put the content in, without waiting for trackers.
      await page.waitForLoadState('networkidle', { timeout: RENDER.settleMs }).catch(() => undefined);
      const html = await page.content();
      const status = response.status();
      const reason = challengeReason(html, status);
      if (reason) throw new BlockedBySiteError(url, reason);
      if (status >= 400) {
        request.log(`Rendered ${url}: HTTP ${status}`);
        return null;
      }
      const finalUrl = page.url();
      request.log(`Rendered ${url}`, { status, finalUrl, bytes: html.length });
      return {
        url,
        finalUrl,
        status,
        title: (await page.title()) || undefined,
        html,
        $: cheerio.load(html),
        nofollow: false,
        fetchedAt: new Date(),
      };
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private overMemory(peakMb: number) {
    return new FetchFailedError('connection', `Chromium was restarted after using too much memory (${peakMb}MB)`, true);
  }

  // Spec §3: sample the browser's process tree and restart it if it goes over the ceiling.
  private watchMemory(_browser: Browser, log: RenderRequest['log']) {
    const pid = this.server?.process().pid;
    const state = { peakMb: 0, restarted: false, stop: () => clearInterval(timer) };
    const sample = () => {
      if (!pid) return;
      void processTreeRssMb(pid)
        .then(async (mb) => {
          state.peakMb = Math.max(state.peakMb, mb);
          if (mb <= RENDER.memoryCeilingMb) return;
          log(`Chromium used ${mb}MB, over the ${RENDER.memoryCeilingMb}MB ceiling: restarting it`);
          this.logger.warn(`Chromium over the memory ceiling at ${mb}MB; restarting`);
          clearInterval(timer);
          state.restarted = true;
          this.restarts += 1;
          await this.restart();
        })
        .catch(() => undefined);
    };
    const timer = setInterval(sample, RENDER.memorySampleMs);
    if (typeof timer.unref === 'function') timer.unref();
    sample();
    return state;
  }

  async restart(): Promise<void> {
    const browser = this.browser;
    const server = this.server;
    this.browser = undefined;
    this.server = undefined;
    await browser?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.restart();
  }
}
