import * as cheerio from 'cheerio';
import {
  DomainAuthorisationStatus,
  OptOutSource,
  ProviderPolicyBasis,
  ProviderPolicyStatus,
  RobotsStatus,
  ScraperAdapterStatus,
  ScraperAdapterType,
} from '../../../src/common/scraper.enums';
import { JobStoppedError } from '../../../src/scraper/queue/scraper-control.service';
import { CrawlDeniedError } from '../../../src/scraper/safety/crawl-gate.service';
import { pageDirectives } from '../../../src/scraper/safety/robots-directives';
import { FixtureServer, startFixtureServer } from '../../helpers/fixture-server';
import { createSafetyHarness, SafetyHarness } from '../../helpers/safety-harness';

const SITE = 'robots-lab.test';
const OTHER = 'elsewhere.test';
const RUN = '64b000000000000000000001';

const page = (body: string, head = '') => `<!doctype html><html><head><title>Lab</title>${head}</head><body>${body}</body></html>`;

describe('robots, page directives and the crawl gate', () => {
  let server: FixtureServer;
  let h: SafetyHarness;

  beforeAll(async () => {
    server = await startFixtureServer();
    h = await createSafetyHarness({ fixtureHosts: [SITE, `www.${SITE}`, OTHER, 'sub.robots-lab.test'] });
  });
  afterAll(async () => {
    await h.close();
    await server.close();
  });
  beforeEach(async () => {
    server.reset();
    await h.reset();
  });

  const url = (path: string, host = SITE) => new URL(server.url(host, path));
  const html = (body: string, head?: string) => (_req: unknown, res: any) =>
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(page(body, head));

  describe('robots.txt (RFC 9309)', () => {
    it('applies the TruOffersBot group over the wildcard group', async () => {
      server.route(SITE, '/robots.txt', (_req, res) =>
        res
          .writeHead(200, { 'Content-Type': 'text/plain' })
          .end('User-agent: *\nDisallow: /private\n\nUser-agent: TruOffersBot\nDisallow: /offers\nCrawl-delay: 5\n'),
      );
      const rules = await h.robots.rulesFor(url('/'));
      expect(rules.status).toBe(RobotsStatus.OK);
      expect(h.robots.isAllowed(rules, url('/offers').toString())).toBe(false);
      expect(h.robots.isAllowed(rules, url('/private').toString())).toBe(true);
      expect(h.robots.crawlDelayMs(rules)).toBe(5_000);
    });

    it('allows everything when robots.txt is missing (4xx)', async () => {
      const rules = await h.robots.rulesFor(url('/'));
      expect(rules.status).toBe(RobotsStatus.UNAVAILABLE);
      expect(h.robots.isAllowed(rules, url('/anything').toString())).toBe(true);
    });

    it.each([500, 503, 429])('disallows everything when robots.txt returns %i, and retries sooner', async (status) => {
      server.route(SITE, '/robots.txt', (_req, res) => res.writeHead(status).end());
      const rules = await h.robots.rulesFor(url('/'));
      expect(rules.status).toBe(RobotsStatus.UNREACHABLE);
      expect(h.robots.isAllowed(rules, url('/').toString())).toBe(false);
      const cached = await h.models.robots.findOne({ origin: url('/').origin }).lean();
      expect(cached!.expiresAt.getTime() - cached!.fetchedAt.getTime()).toBe(60 * 60 * 1000);
    });

    it('caches robots.txt for 24 hours', async () => {
      server.route(SITE, '/robots.txt', (_req, res) => res.writeHead(200).end('User-agent: *\nDisallow:\n'));
      await h.robots.rulesFor(url('/'));
      await h.robots.rulesFor(url('/menu'));
      expect(server.requestsFor(SITE).filter((r) => r.path === '/robots.txt')).toHaveLength(1);
      const cached = await h.models.robots.findOne({ origin: url('/').origin }).lean();
      expect(cached!.expiresAt.getTime() - cached!.fetchedAt.getTime()).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe('page directives', () => {
    const $ = (head: string) => cheerio.load(page('', head));

    it.each([
      [{ 'x-robots-tag': 'noindex' }, '', { noindex: true, nofollow: false }],
      [{ 'x-robots-tag': 'none' }, '', { noindex: true, nofollow: true }],
      [{ 'x-robots-tag': 'TruOffersBot: nofollow' }, '', { noindex: false, nofollow: true }],
      [{ 'x-robots-tag': 'googlebot: noindex' }, '', { noindex: false, nofollow: false }],
      [{ 'x-robots-tag': ['googlebot: noindex', 'truoffersbot: noindex'] }, '', { noindex: true, nofollow: false }],
      [{}, '<meta name="robots" content="noindex, nofollow">', { noindex: true, nofollow: true }],
      [{}, '<meta name="TruOffersBot" content="noindex">', { noindex: true, nofollow: false }],
      [{}, '<meta name="googlebot" content="noindex">', { noindex: false, nofollow: false }],
      [{ 'x-robots-tag': 'unavailable_after: 1 Jan 2020 00:00:00 GMT' }, '', { noindex: true, nofollow: false }],
    ])('%j %s -> %j', (headers, head, expected) => {
      expect(pageDirectives(headers as any, $(head))).toEqual(expected);
    });
  });

  describe('the crawl gate', () => {
    const ctx = { runId: RUN, siteDomain: SITE, checkRobots: true };

    it('never requests anything from a pending_authorisation domain', async () => {
      server.route(SITE, '/', html('offer'));
      await h.authorise(SITE, { authorisationStatus: DomainAuthorisationStatus.PENDING_AUTHORISATION });
      await expect(h.loader({ runId: RUN, siteDomain: SITE }).load(server.url(SITE))).rejects.toMatchObject({
        denial: 'pending_authorisation',
      });
      expect(server.requests).toHaveLength(0);
    });

    it('denies unregistered domains without contacting them', async () => {
      await expect(h.gate.assertRequestAllowed(url('/'), ctx)).rejects.toMatchObject({ denial: 'not_registered' });
      expect(server.requests).toHaveLength(0);
    });

    it('denies opted-out domains, including their subdomains', async () => {
      await h.authorise(SITE);
      await h.models.optOuts.create({ domain: SITE, activeKey: SITE, source: OptOutSource.PUBLIC_FORM });
      await expect(h.gate.assertRequestAllowed(url('/'), ctx)).rejects.toMatchObject({ denial: 'opted_out' });
      await expect(h.gate.assertSiteCrawlable('sub.robots-lab.test')).rejects.toMatchObject({ denial: 'opted_out' });
      expect(server.requests).toHaveLength(0);
    });

    it('does not let a subdomain opt-out block its parent', async () => {
      await h.authorise(SITE);
      await h.models.optOuts.create({ domain: 'sub.robots-lab.test', activeKey: 'sub.robots-lab.test', source: OptOutSource.ADMIN });
      await expect(h.gate.assertSiteCrawlable(SITE)).resolves.toBeDefined();
    });

    it('never crawls a blocked provider’s sites, and an unknown provider’s only while provider review is off', async () => {
      const policy = await h.models.policies.create({ name: 'OrderNest', status: ProviderPolicyStatus.UNKNOWN });
      await h.authorise(SITE, { providerRef: policy._id });
      await expect(h.gate.assertSiteCrawlable(SITE)).resolves.toBeDefined();

      await h.models.policies.updateOne({ _id: policy._id }, { status: ProviderPolicyStatus.BLOCKED });
      await expect(h.gate.assertSiteCrawlable(SITE)).rejects.toMatchObject({ denial: 'provider_not_allowed', message: expect.stringMatching(/which is blocked/) });

      await h.settings.update({ providerReviewRequired: true });
      await h.models.policies.updateOne({ _id: policy._id }, { status: ProviderPolicyStatus.UNKNOWN });
      await expect(h.gate.assertSiteCrawlable(SITE)).rejects.toMatchObject({ denial: 'provider_not_allowed', message: expect.stringMatching(/not allowed/) });

      policy.set({ status: ProviderPolicyStatus.ALLOWED, basis: ProviderPolicyBasis.WRITTEN_AGREEMENT, agreementReference: 'DSA-2026-014' });
      await policy.save();
      await expect(h.gate.assertSiteCrawlable(SITE)).resolves.toBeDefined();
    });

    it('refuses to mark a provider allowed without a recorded basis', async () => {
      await expect(h.models.policies.create({ name: 'Foodbell', status: ProviderPolicyStatus.ALLOWED })).rejects.toThrow(
        /needs a recorded basis/,
      );
      await expect(
        h.models.policies.create({
          name: 'Foodbell',
          status: ProviderPolicyStatus.ALLOWED,
          basis: ProviderPolicyBasis.WRITTEN_AGREEMENT,
        }),
      ).rejects.toThrow(/agreement reference/);
    });

    it('parks paused domains and paused adapters', async () => {
      await h.authorise(SITE);
      await h.models.configs.create({ domain: SITE, paused: true, pausedReason: 'owner asked us to wait' });
      await expect(h.gate.assertSiteCrawlable(SITE)).rejects.toMatchObject({ denial: 'domain_paused' });
      await h.models.configs.deleteMany({});
      await h.models.adapters.create({
        key: 'generic-html',
        name: 'Generic HTML',
        type: ScraperAdapterType.BUILTIN_HTML,
        version: '1.0.0',
        priority: 100,
        status: ScraperAdapterStatus.PAUSED,
      });
      await expect(h.gate.assertSiteCrawlable(SITE, 'generic-html')).rejects.toMatchObject({ denial: 'adapter_paused' });
    });

    describe('a robots.txt exception, on the website owner’s written consent', () => {
      const CLOSED = 'User-agent: *\nDisallow: /\n';
      const consent = { note: 'Owner replied "yes" to our message on 2026-09-19', recordedBy: '64b0000000000000000000aa', recordedAt: new Date() };
      const closedSite = (extra: Record<string, unknown> = {}) => {
        server.route(SITE, '/robots.txt', (_req, res) => res.writeHead(200, { 'Content-Type': 'text/plain' }).end(CLOSED));
        server.route(SITE, '/', html('10% off collection'));
        return h.authorise(SITE, extra);
      };

      it('reads a website that disallows all bots only while the exception is recorded', async () => {
        await closedSite();
        await expect(h.gate.assertRequestAllowed(url('/'), ctx)).rejects.toMatchObject({ denial: 'robots_disallowed' });

        await h.models.sites.updateOne({ domain: SITE }, { $set: { robotsOverride: consent } });
        await expect(h.gate.assertRequestAllowed(url('/'), ctx)).resolves.toBeUndefined();
        const page = await h.loader({ runId: RUN, siteDomain: SITE }).load(server.url(SITE));
        expect(page?.html).toContain('10% off collection');

        await h.models.sites.updateOne({ domain: SITE }, { $unset: { robotsOverride: 1 } });
        await expect(h.gate.assertRequestAllowed(url('/'), ctx)).rejects.toMatchObject({ denial: 'robots_disallowed' });
      });

      it('is also what lets it through when robots.txt cannot be fetched at all', async () => {
        server.route(SITE, '/robots.txt', (_req, res) => res.writeHead(503).end());
        await h.authorise(SITE, { robotsOverride: consent });
        await expect(h.gate.assertRequestAllowed(url('/'), ctx)).resolves.toBeUndefined();
      });

      it('never overrides an opt-out, the never-crawl list, a pause or a blocked provider', async () => {
        await closedSite({ robotsOverride: consent });
        await h.models.optOuts.create({ domain: SITE, activeKey: SITE, source: OptOutSource.PUBLIC_FORM });
        await expect(h.gate.assertRequestAllowed(url('/'), ctx)).rejects.toMatchObject({ denial: 'opted_out' });
        await h.models.optOuts.deleteMany({});

        await h.models.configs.create({ domain: SITE, paused: true });
        await expect(h.gate.assertRequestAllowed(url('/'), ctx)).rejects.toMatchObject({ denial: 'domain_paused' });
        await h.models.configs.deleteMany({});

        await h.models.configs.create({ domain: SITE, blockedPaths: ['/private'] });
        await expect(h.gate.assertRequestAllowed(url('/private/menu'), ctx)).rejects.toMatchObject({ denial: 'blocked_path' });
        await h.models.configs.deleteMany({});

        const policy = await h.models.policies.create({ name: 'OrderNest', status: ProviderPolicyStatus.BLOCKED });
        await h.models.sites.updateOne({ domain: SITE }, { $set: { providerRef: policy._id } });
        await expect(h.gate.assertRequestAllowed(url('/'), ctx)).rejects.toMatchObject({ denial: 'provider_not_allowed' });

        await h.models.sites.updateOne({ domain: SITE }, { $set: { authorisationStatus: DomainAuthorisationStatus.PENDING_AUTHORISATION }, $unset: { providerRef: 1 } });
        await expect(h.gate.assertRequestAllowed(url('/'), ctx)).rejects.toMatchObject({ denial: 'pending_authorisation' });
      });

      it('applies only to the website it was recorded on', async () => {
        await closedSite({ robotsOverride: consent });
        server.route(OTHER, '/robots.txt', (_req, res) => res.writeHead(200, { 'Content-Type': 'text/plain' }).end(CLOSED));
        await h.authorise(OTHER);
        await expect(h.gate.assertRequestAllowed(url('/', OTHER), { ...ctx, siteDomain: OTHER })).rejects.toMatchObject({ denial: 'robots_disallowed' });
      });

      it('keeps the page-level directives: a noindex page is still not used', async () => {
        await closedSite({ robotsOverride: consent });
        server.route(SITE, '/hidden', html('secret 50% off', '<meta name="robots" content="noindex">'));
        const loaded = await h.loader({ runId: RUN, siteDomain: SITE }).load(server.url(SITE, '/hidden'));
        expect(loaded?.html ?? '').not.toContain('secret');
      });
    });

    it('stops immediately on emergency stop or cancellation', async () => {
      await h.authorise(SITE);
      await h.control.halt();
      await expect(h.gate.assertRequestAllowed(url('/'), ctx)).rejects.toBeInstanceOf(JobStoppedError);
      await h.control.resume();
      await h.control.cancelRun(RUN);
      await expect(h.gate.assertRequestAllowed(url('/'), ctx)).rejects.toMatchObject({ reason: 'cancelled' });
    });

    it('records cross-site redirect targets as pending authorisation and does not follow them', async () => {
      await h.authorise(SITE);
      server.route(SITE, '/moved', (_req, res) => res.writeHead(301, { Location: server.url(OTHER, '/') }).end());
      const loader = h.loader({ runId: RUN, siteDomain: SITE });
      await expect(loader.load(server.url(SITE, '/moved'))).resolves.toBeNull();
      expect(server.requestsFor(OTHER)).toHaveLength(0);
      const discovered = await h.models.sites.findOne({ domain: OTHER }).lean();
      expect(discovered).toMatchObject({
        authorisationStatus: DomainAuthorisationStatus.PENDING_AUTHORISATION,
        discoveredFrom: SITE,
      });
    });
  });

  describe('the page loader', () => {
    beforeEach(() => h.authorise(SITE));

    it('loads a permitted page', async () => {
      server.route(SITE, '/', html('<p>20% off</p>'));
      const loaded = await h.loader({ runId: RUN, siteDomain: SITE }).load(server.url(SITE));
      expect(loaded?.$('p').text()).toBe('20% off');
      expect(loaded?.title).toBe('Lab');
    });

    it('skips pages robots.txt disallows without requesting them', async () => {
      server.route(SITE, '/robots.txt', (_req, res) => res.writeHead(200).end('User-agent: TruOffersBot\nDisallow: /secret\n'));
      server.route(SITE, '/secret', html('x'));
      await expect(h.loader({ runId: RUN, siteDomain: SITE }).load(server.url(SITE, '/secret'))).resolves.toBeNull();
      expect(server.requestsFor(SITE).map((r) => r.path)).toEqual(['/robots.txt']);
    });

    it('does not use noindex pages but honours nofollow as a flag', async () => {
      server.route(SITE, '/hidden', html('<p>offer</p>', '<meta name="robots" content="noindex">'));
      server.route(SITE, '/nofollow', (_req, res) =>
        res.writeHead(200, { 'Content-Type': 'text/html', 'X-Robots-Tag': 'nofollow' }).end(page('<a href="/x">x</a>')),
      );
      const loader = h.loader({ runId: RUN, siteDomain: SITE });
      await expect(loader.load(server.url(SITE, '/hidden'))).resolves.toBeNull();
      expect((await loader.load(server.url(SITE, '/nofollow')))?.nofollow).toBe(true);
    });

    it('fetches each page once per job and stops at the page cap', async () => {
      await h.models.configs.create({ domain: SITE, pageCap: 3, rateLimitMs: 250 });
      for (let i = 0; i < 6; i++) server.route(SITE, `/p${i}`, html(`page ${i}`));
      const loader = h.loader({ runId: RUN, siteDomain: SITE });
      const results: unknown[] = [];
      for (let i = 0; i < 6; i++) results.push(await loader.load(server.url(SITE, `/p${i}`)));
      await loader.load(server.url(SITE, '/p0#again'));
      expect(results.filter(Boolean)).toHaveLength(3);
      expect(server.requestsFor(SITE).filter((r) => r.path.startsWith('/p'))).toHaveLength(3);
      expect(loader.skipped.size).toBe(3);
    });

    it('spaces requests to one domain by the rate limit', async () => {
      await h.models.configs.create({ domain: SITE, rateLimitMs: 400 });
      for (let i = 0; i < 3; i++) server.route(SITE, `/r${i}`, html('x'));
      const loader = h.loader({ runId: RUN, siteDomain: SITE });
      const started = Date.now();
      for (let i = 0; i < 3; i++) await loader.load(server.url(SITE, `/r${i}`));
      // robots.txt + 3 pages = 4 requests, at least 3 intervals apart.
      expect(Date.now() - started).toBeGreaterThanOrEqual(3 * 400 - 50);
    });

    it('treats server errors as retryable failures of the job', async () => {
      server.route(SITE, '/down', (_req, res) => res.writeHead(502).end());
      await expect(h.loader({ runId: RUN, siteDomain: SITE }).load(server.url(SITE, '/down'))).rejects.toMatchObject({
        code: 'http_status',
        retryable: true,
      });
    });

    it('surfaces site-level denials that appear mid-run', async () => {
      server.route(SITE, '/a', html('a'));
      const loader = h.loader({ runId: RUN, siteDomain: SITE });
      await loader.load(server.url(SITE, '/a'));
      await h.models.optOuts.create({ domain: SITE, activeKey: SITE, source: OptOutSource.PUBLIC_FORM });
      await expect(loader.load(server.url(SITE, '/b'))).rejects.toBeInstanceOf(CrawlDeniedError);
    });
  });
});
