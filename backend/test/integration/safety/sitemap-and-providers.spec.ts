import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { ProviderPolicyStatus } from '../../../src/common/scraper.enums';
import { ProviderDetectionService } from '../../../src/scraper/safety/provider-detection.service';
import { SitemapService } from '../../../src/scraper/safety/sitemap.service';
import { testModels, TestModels } from '../../helpers/models';
import { connectTestMongo, disconnectTestMongo, resetTestMongo } from '../../helpers/mongo';

describe('sitemaps', () => {
  const sitemaps = new SitemapService();
  const urlset = (locs: string[]) =>
    `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs
      .map((l) => `<url><loc>${l}</loc></url>`)
      .join('')}</urlset>`;
  const index = (locs: string[]) =>
    `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs
      .map((l) => `<sitemap><loc>${l}</loc></sitemap>`)
      .join('')}</sitemapindex>`;

  it('collects same-site URLs and drops other sites', async () => {
    const docs: Record<string, string> = {
      'https://pizza.test/sitemap.xml': urlset([
        'https://pizza.test/offers?utm_source=x',
        'https://www.pizza.test/menu',
        'https://elsewhere.test/offers',
        'ftp://pizza.test/file',
      ]),
    };
    const urls = await sitemaps.collectUrls(['https://pizza.test/sitemap.xml'], 'pizza.test', async (u) => docs[u] ?? null);
    expect(urls).toEqual(['https://pizza.test/offers', 'https://www.pizza.test/menu']);
  });

  it('follows sitemap indexes to depth 2 and ignores deeper nesting', async () => {
    const docs: Record<string, string> = {
      'https://pizza.test/root.xml': index(['https://pizza.test/level1.xml']),
      'https://pizza.test/level1.xml': index(['https://pizza.test/level2.xml', 'https://pizza.test/pages1.xml']),
      'https://pizza.test/pages1.xml': urlset(['https://pizza.test/a']),
      'https://pizza.test/level2.xml': index(['https://pizza.test/pages-too-deep.xml']),
      'https://pizza.test/pages-too-deep.xml': urlset(['https://pizza.test/deep']),
    };
    const fetched: string[] = [];
    const urls = await sitemaps.collectUrls(['https://pizza.test/root.xml'], 'pizza.test', async (u) => {
      fetched.push(u);
      return docs[u] ?? null;
    });
    expect(urls).toEqual(['https://pizza.test/a']);
    expect(fetched).not.toContain('https://pizza.test/pages-too-deep.xml');
  });

  it('stops at 5,000 URLs', async () => {
    const locs = Array.from({ length: 6_000 }, (_, i) => `https://pizza.test/p${i}`);
    const urls = await sitemaps.collectUrls(['https://pizza.test/big.xml'], 'pizza.test', async () => urlset(locs));
    expect(urls).toHaveLength(5_000);
  });

  it('survives malformed XML', async () => {
    await expect(
      sitemaps.collectUrls(['https://pizza.test/bad.xml'], 'pizza.test', async () => '<urlset><url><loc>'),
    ).resolves.toEqual([]);
  });
});

describe('provider detection', () => {
  let models: TestModels;
  let cnames: Record<string, string[]>;
  let detector: ProviderDetectionService;

  beforeAll(async () => {
    await connectTestMongo();
    models = testModels();
  });
  afterAll(disconnectTestMongo);
  beforeEach(async () => {
    await resetTestMongo();
    cnames = {};
    detector = new ProviderDetectionService(models.policies as any, async (host) => cnames[host] ?? []);
    await models.policies.create({
      name: 'OrderNest',
      status: ProviderPolicyStatus.UNKNOWN,
      detection: {
        hostSuffixes: ['ordernest.test'],
        cnameSuffixes: ['sites.ordernest-cdn.test'],
        footerPatterns: ['Powered by OrderNest'],
        generatorPatterns: ['OrderNest Sites'],
        assetHosts: ['static.ordernest-cdn.test'],
      },
    });
  });

  it('recognises provider-hosted subdomains before fetching anything', async () => {
    expect(await detector.detectBeforeFetch('bella.ordernest.test')).toMatchObject({ name: 'OrderNest' });
    expect(await detector.detectBeforeFetch('bella.test')).toBeNull();
  });

  it('decides on the policy as it is now, not as cached, so an admin’s change applies to the next run', async () => {
    expect(await detector.detectBeforeFetch('bella.ordernest.test')).toMatchObject({ status: ProviderPolicyStatus.UNKNOWN });
    // Another process (the API) allows the provider while this detector's pattern cache is still warm.
    await models.policies.updateOne({ name: 'OrderNest' }, { $set: { status: ProviderPolicyStatus.ALLOWED, basis: 'written_agreement', agreementReference: 'ON-1' } });
    expect(await detector.detectBeforeFetch('bella.ordernest.test')).toMatchObject({ status: ProviderPolicyStatus.ALLOWED });
    const $ = cheerio.load('<html><head><meta name="generator" content="OrderNest Sites 4.2"></head><body></body></html>');
    expect(await detector.detectFromPage($)).toMatchObject({ status: ProviderPolicyStatus.ALLOWED });

    await models.policies.deleteOne({ name: 'OrderNest' });
    expect(await detector.detectBeforeFetch('bella.ordernest.test')).toBeNull();
  });

  it('follows CNAME chains to the provider', async () => {
    cnames['order.kebab-king.test'] = ['kebab-king.sites.ordernest-cdn.test'];
    expect(await detector.detectBeforeFetch('order.kebab-king.test')).toMatchObject({
      name: 'OrderNest',
      signals: ['CNAME kebab-king.sites.ordernest-cdn.test'],
    });
  });

  it.each([
    ['<meta name="generator" content="OrderNest Sites 4.2">', ''],
    ['', '<footer>© Curry House · Powered by OrderNest</footer>'],
    ['<script src="https://static.ordernest-cdn.test/app.js"></script>', ''],
  ])('recognises provider markers on the homepage (%s%s)', async (head, body) => {
    const $ = cheerio.load(`<html><head>${head}</head><body><main>Menu</main>${body}</body></html>`);
    expect(await detector.detectFromPage($)).toMatchObject({ name: 'OrderNest', status: ProviderPolicyStatus.UNKNOWN });
  });

  it('records an unrecognised ordering platform as unknown for review', async () => {
    const $ = cheerio.load('<html><body><footer>Online ordering by TakeawayCloud. All rights reserved.</footer></body></html>');
    const match = await detector.detectFromPage($);
    expect(match).toMatchObject({ name: 'TakeawayCloud', status: ProviderPolicyStatus.UNKNOWN });
    expect(await models.policies.findOne({ name: 'TakeawayCloud' }).lean()).toMatchObject({ autoCreated: true });
  });

  it('recognises the ordering platforms it knows even before an admin has a policy for them (spec §2.3)', async () => {
    const fixture = (host: string) => cheerio.load(readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'sites', host, 'index.html'), 'utf8'));
    // Foodhub's page has no footer or generator tag: its asset host is in a preconnect link and the JSON-LD.
    const foodhub = await detector.detectFromPage(fixture('fh-sultan.test'));
    expect(foodhub).toMatchObject({ name: 'Foodhub', status: ProviderPolicyStatus.UNKNOWN, signals: ['assets from assets.foodhub.com'] });
    expect(await models.policies.findOne({ name: 'Foodhub' }).lean()).toMatchObject({ autoCreated: true, detection: { assetHosts: ['foodhub.com', 'foodhub.co.uk'] } });

    const grub24 = await detector.detectFromPage(fixture('g24-caspian.test'));
    expect(grub24).toMatchObject({ name: 'Grub24', status: ProviderPolicyStatus.UNKNOWN });

    // Once recorded, the policy itself matches, whatever an admin has decided since.
    await models.policies.updateOne({ name: 'Foodhub' }, { $set: { status: ProviderPolicyStatus.ALLOWED, basis: 'written_agreement', agreementReference: 'FH-1' } });
    detector.invalidate();
    expect(await detector.detectFromPage(fixture('fh-sultan.test'))).toMatchObject({ name: 'Foodhub', status: ProviderPolicyStatus.ALLOWED });
    expect(await models.policies.countDocuments({ name: /foodhub/i })).toBe(1);

    // An independent takeaway that merely links to a platform is not treated as hosted by it.
    const independent = cheerio.load('<html><body><a href="https://foodhub.co.uk/rubery/sultan-grill">Order on Foodhub</a><footer>© Sultan Grill</footer></body></html>');
    expect(await detector.detectFromPage(independent)).toBeNull();
  });

  it('ignores website builders and designers', async () => {
    for (const footer of ['Powered by WordPress', 'Website by Joe Bloggs Design', 'Online ordering by Shopify']) {
      const $ = cheerio.load(`<html><body><footer>${footer}</footer></body></html>`);
      expect(await detector.detectFromPage($)).toBeNull();
    }
    expect(await models.policies.countDocuments()).toBe(1);
  });
});
