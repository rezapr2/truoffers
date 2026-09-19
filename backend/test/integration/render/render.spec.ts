import { RENDER } from '../../../src/scraper/render/render.constants';
import { BlockedBySiteError, isTrackerHost, RenderService } from '../../../src/scraper/render/render.service';
import { processTreeRssMb } from '../../../src/scraper/render/process-memory';
import { fixtureNetworkPolicy, STRICT_NETWORK_POLICY } from '../../../src/scraper/safety/ssrf-policy';
import { FixtureServer, startFixtureServer, testResolver } from '../../helpers/fixture-server';

const HOST = 'spa-only.test';
const page = (body: string) => `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>Sushi Stop</title></head><body>${body}</body></html>`;

describe('Chromium rendering (spec §3/§5)', () => {
  let server: FixtureServer;
  let renderer: RenderService;

  const request = (path: string, extra: Partial<Parameters<RenderService['render']>[0]> = {}) => ({
    siteDomain: HOST,
    urls: [server.url(HOST, path)],
    signal: new AbortController().signal,
    log: () => undefined,
    assertHostAllowed: async () => undefined,
    assertUrlAllowed: async () => undefined,
    ...extra,
  });

  beforeAll(async () => {
    server = await startFixtureServer();
    renderer = new RenderService(fixtureNetworkPolicy(new Set([HOST, 'elsewhere.test'])), testResolver());
  }, 60_000);

  afterAll(async () => {
    await renderer.onApplicationShutdown();
    await server.close();
  });

  beforeEach(() => server.reset());

  it('reads offers that only exist after JavaScript runs', async () => {
    const result = await renderer.render(request('/'));
    expect(result.pages).toHaveLength(1);
    const html = result.pages[0].html;
    expect(html).toContain('Sushi Sunday');
    expect(result.pages[0].$('.offer-banner h2').text()).toBe('Sushi Sunday');
    // The same DOM the adapters read: the static HTML has none of this.
    expect(result.pages[0].$('body').text()).toContain('25% off all platters every Sunday');
  }, 60_000);

  it('keeps the JSON the page’s own scripts load from the website, and nothing else', async () => {
    const json = (body: unknown, headers: Record<string, string> = {}) => (_req: unknown, res: import('node:http').ServerResponse) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...headers });
      res.end(JSON.stringify(body));
    };
    server.route(HOST, '/app', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      // The data arrives two seconds after the page, as a client-side ordering app's does.
      res.end(
        page(`<div id="root">Loading</div><script>setTimeout(async () => {
          const store = await fetch('/api/store').then((r) => r.json());
          await fetch('/api/notes').then((r) => r.text());
          await fetch('/api/private').catch(() => null);
          await fetch('${server.url('elsewhere.test', '/api/menu')}').catch(() => null);
          document.getElementById('root').textContent = store.name;
        }, 2000);</script>`),
      );
    });
    server.route(HOST, '/api/store', json({ name: 'Sushi Stop', deals: ['Sushi Sunday'] }));
    server.route(HOST, '/api/notes', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('not data');
    });
    server.route(HOST, '/api/private', json({ secret: true }));
    server.route('elsewhere.test', '/api/menu', json({ other: 'site' }));

    const result = await renderer.render(
      request('/app', {
        // What robots.txt disallows is never requested, so it can't be kept either.
        assertUrlAllowed: async (url: URL) => {
          if (url.pathname === '/api/private') throw new Error('Disallowed by robots.txt');
        },
      }),
    );
    expect(result.pages[0].$('#root').text()).toBe('Sushi Stop');
    expect(result.pages[0].dataResponses).toEqual([{ url: server.url(HOST, '/api/store'), json: { name: 'Sushi Stop', deals: ['Sushi Sunday'] } }]);
    expect(server.requestsFor(HOST).map((r) => r.path)).not.toContain('/api/private');
  }, 60_000);

  describe('an app that spends a while loading before it asks for its data', () => {
    const original = { settleMs: RENDER.settleMs, patientMs: RENDER.patientMs, quietMs: RENDER.quietMs, giveUpQuietMs: RENDER.giveUpQuietMs };
    const limits = RENDER as unknown as Record<string, number>;
    beforeEach(() => Object.assign(limits, { settleMs: 2_000, patientMs: 20_000, quietMs: 800, giveUpQuietMs: 3_000 }));
    afterEach(() => Object.assign(limits, original));

    const json = (body: unknown) => (_req: unknown, res: import('node:http').ServerResponse) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    // Twelve small requests half a second apart (its script bundles), then, unless told otherwise, the store.
    const app = (asksForStore: boolean) => (_req: unknown, res: import('node:http').ServerResponse) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        page(`<div id="root">Loading</div><script>
          let n = 0;
          const tick = () => {
            fetch('/api/chunk?' + n).catch(() => null);
            if (++n < 12) return setTimeout(tick, 500);
            ${asksForStore ? "fetch('/api/consumer/store').then((r) => r.json()).then((s) => { document.getElementById('root').textContent = s.name; });" : ''}
          };
          tick();
        </script>`),
      );
    };
    const STORE = /\/api\/consumer\/store$/;

    it('stops waiting at the ordinary settle time when it is not told what to wait for', async () => {
      server.route(HOST, '/app', app(true));
      server.route(HOST, '/api/chunk', json({ chunk: true }));
      server.route(HOST, '/api/consumer/store', json({ name: 'Marco Pizza' }));
      const logs: string[] = [];
      const result = await renderer.render(request('/app', { log: (m) => void logs.push(m) }));
      expect(result.pages[0].$('#root').text()).toBe('Loading');
      expect(result.pages[0].dataResponses?.some((d) => d.url.endsWith('/api/consumer/store'))).toBe(false);
      expect(logs.join(' ')).toMatch(/was still loading after \d+s/);
    }, 60_000);

    it('waits for the data an adapter expects, however long the app spends loading first', async () => {
      server.route(HOST, '/app', app(true));
      server.route(HOST, '/api/chunk', json({ chunk: true }));
      server.route(HOST, '/api/consumer/store', json({ name: 'Marco Pizza' }));
      const logs: string[] = [];
      const result = await renderer.render(request('/app', { expectData: STORE, log: (m) => void logs.push(m) }));
      expect(result.pages[0].$('#root').text()).toBe('Marco Pizza');
      expect(result.pages[0].dataResponses).toEqual(expect.arrayContaining([{ url: server.url(HOST, '/api/consumer/store'), json: { name: 'Marco Pizza' } }]));
      expect(logs.join(' ')).not.toMatch(/never loaded|still loading/);
    }, 60_000);

    it('says so, and gives up once the page goes quiet, when the expected data never comes', async () => {
      server.route(HOST, '/app', app(false));
      server.route(HOST, '/api/chunk', json({ chunk: true }));
      const logs: string[] = [];
      const started = Date.now();
      const result = await renderer.render(request('/app', { expectData: STORE, log: (m) => void logs.push(m) }));
      expect(result.pages).toHaveLength(1);
      expect(logs.join(' ')).toMatch(/never loaded the data this platform normally loads/);
      // It gave up when the page went quiet, well before the 20 seconds it was allowed.
      expect(Date.now() - started).toBeLessThan(15_000);
    }, 60_000);
  });

  it('never requests images, media or fonts, and blocks analytics hosts', async () => {
    server.route(HOST, '/with-assets', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        page(
          `<h1>Deals</h1><img src="/banner.png" alt=""><video src="/clip.mp4"></video>` +
            `<link rel="stylesheet" href="/style.css">` +
            `<script src="https://www.google-analytics.com/analytics.js"></script>` +
            `<style>@font-face{font-family:x;src:url(/font.woff2) format('woff2')}body{font-family:x}</style>`,
        ),
      );
    });
    const result = await renderer.render(request('/with-assets'));
    expect(result.pages).toHaveLength(1);
    const paths = server.requestsFor(HOST).map((r) => r.path);
    expect(paths).toContain('/with-assets');
    expect(paths).toContain('/style.css');
    for (const asset of ['/banner.png', '/clip.mp4', '/font.woff2']) expect(paths).not.toContain(asset);
    expect(isTrackerHost('www.google-analytics.com')).toBe(true);
  }, 60_000);

  it('blocks a sub-resource on a host that resolves to a private address', async () => {
    server.route(HOST, '/leaky', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      // internal.test is not a fixture host, so the strict policy applies and loopback is refused.
      res.end(page(`<h1>Deals</h1><script src="http://internal.test/x.js"></script>`));
    });
    const result = await renderer.render(request('/leaky'));
    expect(result.pages).toHaveLength(1);
    expect(result.blockedRequests).toBeGreaterThanOrEqual(1);
    expect(server.requestsFor('internal.test')).toHaveLength(0);
    expect(STRICT_NETWORK_POLICY.isAddressAllowed('127.0.0.1', 'internal.test')).toBe(false);
  }, 60_000);

  it('refuses a redirect to a private address, which the browser follows by itself', async () => {
    server.route(HOST, '/moved', (_req, res) => {
      // Playwright's route handler never sees this hop; the proxy does.
      res.writeHead(302, { Location: 'http://internal.test/admin' }).end();
    });
    const logs: string[] = [];
    const result = await renderer.render(request('/moved', { log: (message: string) => void logs.push(message) }));
    expect(result.pages).toHaveLength(0);
    expect(result.blockedRequests).toBeGreaterThanOrEqual(1);
    expect(server.requestsFor('internal.test')).toHaveLength(0);
    // Our own refusal, not the website's: the page is skipped and the website isn't treated as blocking us.
    expect(logs.join(' ')).toMatch(/Did not render .*internal\.test resolves to 127\.0\.0\.1/);
  }, 60_000);

  it('applies the crawl gate to the pages the browser asks for', async () => {
    server.route(HOST, '/private-deals', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page('<h1>Members only</h1>'));
    });
    const seen: string[] = [];
    const result = await renderer.render(
      request('/private-deals', {
        assertUrlAllowed: async (url: URL) => {
          seen.push(url.pathname);
          if (url.pathname.startsWith('/private')) throw new Error('robots.txt disallows /private');
        },
      }),
    );
    expect(seen).toContain('/private-deals');
    expect(result.pages).toHaveLength(0);
    expect(server.requestsFor(HOST).map((r) => r.path)).not.toContain('/private-deals');
  }, 60_000);

  it('stops on a challenge or login wall instead of pretending to be a browser', async () => {
    server.route(HOST, '/challenge', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page('<h1>Just a moment…</h1><p>Checking your browser before you continue.</p>'));
    });
    await expect(renderer.render(request('/challenge'))).rejects.toThrow(BlockedBySiteError);
  }, 60_000);

  it('closes the pages as soon as the run is cancelled', async () => {
    server.route(HOST, '/slow', (req, res) => {
      const timer = setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page('<h1>Too late</h1>'));
      }, 20_000);
      req.on('close', () => clearTimeout(timer));
    });
    const controller = new AbortController();
    const started = Date.now();
    const rendering = renderer.render(request('/slow', { signal: controller.signal }));
    setTimeout(() => controller.abort(), 500);
    await expect(rendering).rejects.toThrow(/cancelled/);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 60_000);

  it('restarts the browser when it goes over its memory ceiling', async () => {
    const before = renderer.restarts;
    // The ceiling is read from the environment, so a tiny one makes any real browser exceed it.
    process.env.SCRAPER_RENDER_MEMORY_MB = '1';
    jest.resetModules();
    const { RenderService: Restricted } = await import('../../../src/scraper/render/render.service');
    const strict = new Restricted(fixtureNetworkPolicy(new Set([HOST])), testResolver());
    try {
      // The job fails with a retryable error, and the next attempt gets a fresh browser.
      await expect(strict.render(request('/'))).rejects.toThrow(/too much memory/);
      expect(strict.restarts).toBeGreaterThan(0);
    } finally {
      delete process.env.SCRAPER_RENDER_MEMORY_MB;
      await strict.onApplicationShutdown();
    }
    expect(renderer.restarts).toBe(before);
  }, 60_000);

  it('adds up the memory of the whole process tree', async () => {
    const rows = [
      { pid: 1, ppid: 0, rssKb: 1024 },
      { pid: 2, ppid: 1, rssKb: 2048 },
      { pid: 3, ppid: 2, rssKb: 1024 },
      { pid: 9, ppid: 0, rssKb: 999_999 },
    ];
    expect(await processTreeRssMb(1, async () => rows)).toBe(4);
    expect(await processTreeRssMb(2, async () => rows)).toBe(3);
  });
});
