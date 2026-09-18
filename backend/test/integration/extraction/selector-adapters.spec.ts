import { ScraperAdapterStatus, ScraperAdapterType } from '../../../src/common/scraper.enums';
import type { WebsiteContext } from '../../../src/scraper/extraction/adapter.types';
import { AdapterRegistry } from '../../../src/scraper/extraction/adapter-registry.service';
import { GenericHtmlAdapter } from '../../../src/scraper/extraction/adapters/generic-html.adapter';
import { OrderNestAdapter } from '../../../src/scraper/extraction/adapters/ordernest.adapter';
import { SelectorAdapter } from '../../../src/scraper/extraction/adapters/selector-adapter';
import { parseSelectorConfig, pathMatches, SelectorAdapterConfig } from '../../../src/scraper/extraction/selector-config';
import { ExamplePage, suggestSelectorConfig } from '../../../src/scraper/extraction/selector-suggestion';
import { suggestFingerprint } from '../../../src/scraper/fingerprinting/builder';
import { extractMarkers, mergeMarkers } from '../../../src/scraper/fingerprinting/markers';
import { FixtureServer, startFixtureServer } from '../../helpers/fixture-server';
import { createSafetyHarness, SafetyHarness } from '../../helpers/safety-harness';

const CHECKED_AT = new Date('2026-09-14T10:00:00Z');
const SAFFRON = ['saffron-spice.test', 'lotus-garden.test', 'kings-grill.test'];
const SITES = [...SAFFRON, 'panda-noodles.test', 'dragon-wok.test', 'luigis.ordernest.test'];
let runCounter = 0;

describe('selector adapters, the suggestion engine and adapter precedence', () => {
  let server: FixtureServer;
  let h: SafetyHarness;
  let registry: AdapterRegistry;
  const generic = new GenericHtmlAdapter();

  beforeAll(async () => {
    server = await startFixtureServer();
    h = await createSafetyHarness({ fixtureHosts: SITES });
    registry = new AdapterRegistry(h.models.adapters as any, h.models.fingerprints as any);
  });
  afterAll(async () => {
    await h.close();
    await server.close();
  });
  beforeEach(async () => {
    server.reset();
    await h.reset();
    registry.invalidate();
    await registry.ensureRegistered();
    for (const domain of SITES) await h.authorise(domain);
    await h.settings.update({ defaultRateLimitMs: 250 });
  });

  const contextFor = (domain: string): WebsiteContext => {
    const runId = `64b0000000000000000${String(++runCounter).padStart(5, '0')}`;
    const loader = h.loader({ runId, siteDomain: domain });
    return {
      site: { id: domain, domain, homepageUrl: server.url(domain, '/') },
      runId,
      checkedAt: CHECKED_AT,
      signal: new AbortController().signal,
      loadPage: (url) => loader.load(url),
      log: () => undefined,
    };
  };

  async function examplePages(domain: string): Promise<ExamplePage[]> {
    const ctx = contextFor(domain);
    const pages: ExamplePage[] = [];
    for (const path of ['/', '/offers']) {
      const page = await ctx.loadPage(server.url(domain, path));
      if (!page) continue;
      const roles = path === '/' ? (['home'] as const) : (['offers'] as const);
      const extraction = generic.extractFromPage(page, [...roles], ctx);
      pages.push({ page, offers: extraction.offers, businesses: extraction.businesses });
    }
    return pages;
  }

  async function saffronFingerprint() {
    const markers = await Promise.all(
      ['saffron-spice.test', 'lotus-garden.test'].map(async (domain) => mergeMarkers(...(await examplePages(domain)).map((p) => extractMarkers(p.page)))),
    );
    const suggestion = suggestFingerprint(markers);
    return h.models.fingerprints.create({ name: 'Saffron Theme', key: 'saffron-theme', markers: suggestion.markers, exampleDomains: ['saffron-spice.test', 'lotus-garden.test'] });
  }

  async function suggestedConfig(): Promise<SelectorAdapterConfig> {
    const result = suggestSelectorConfig([await examplePages('saffron-spice.test'), await examplePages('lotus-garden.test')]);
    if (!result.config) throw new Error(`No config suggested: ${result.notes.join('; ')}`);
    return result.config;
  }

  it('validates selector configs without accepting regex or unknown parsers', () => {
    expect(parseSelectorConfig({ offers: { container: 'article.card', fields: { title: { selector: 'h3' } } } }).errors).toEqual([]);
    const bad = parseSelectorConfig({
      offers: { container: 'article[', fields: { title: { selector: 'h3', parser: 'regex' }, promoCode: { selector: '.code', source: 'attribute' } } },
      pages: { offers: ['^/offers$'] },
    });
    expect(bad.errors.join(' | ')).toMatch(/Not a valid CSS selector/);
    expect(bad.errors.join(' | ')).toMatch(/offers.fields.title.parser/);
    expect(bad.errors.join(' | ')).toMatch(/Choose the attribute/);
    expect(bad.errors.join(' | ')).toMatch(/Use a path such as/);
    expect(pathMatches('/deals/*', '/deals/tuesday')).toBe(true);
    expect(pathMatches('/deals/*', '/deals')).toBe(false);
  });

  it('suggests a shared card and field selectors from two example sites', async () => {
    const config = await suggestedConfig();
    expect(config.offers.container).toBe('article.sf-offer-card');
    expect(config.offers.fields.title.selector).toBe('h3.sf-offer-title');
    expect(config.offers.fields.description?.selector).toBe('p.sf-offer-desc');
    expect(config.offers.fields.minimumOrder?.selector).toBe('span.sf-offer-min');
    expect(config.offers.fields.expiry?.selector).toBe('span.sf-offer-expiry');
    expect(config.offers.fields.promoCode?.selector).toBe('span.sf-offer-code');
    expect(config.pages?.offers).toEqual(['/offers']);
    expect(config.business?.telephone?.selector).toBe('a.sf-phone');
  });

  it('extracts every offer on a third site of the template, with selector evidence', async () => {
    const fingerprint = await saffronFingerprint();
    const adapter = new SelectorAdapter({
      key: 'saffron',
      name: 'Saffron Theme',
      version: '1',
      status: ScraperAdapterStatus.APPROVED,
      exampleDomains: ['saffron-spice.test', 'lotus-garden.test'],
      config: await suggestedConfig(),
      fingerprint: { id: String(fingerprint._id), name: fingerprint.name, markers: fingerprint.markers },
    });
    const ctx = contextFor('kings-grill.test');
    expect((await adapter.canHandle(ctx)).canHandle).toBe(true);
    const pages = await adapter.discoverPages(ctx);
    expect(pages.find((p) => p.url.endsWith('/offers'))?.roles).toContain('offers');

    const offers = await adapter.extractOfferDetails(ctx, pages);
    const titles = offers.map((o) => o.offer.title);
    expect(titles).toEqual(expect.arrayContaining(['2 for 1 on all burgers every Tuesday', '10% off collection orders']));
    const tenPercent = offers.find((o) => o.offer.title === '10% off collection orders')!.offer;
    expect(tenPercent).toMatchObject({ promoCode: 'KINGS10', minimumOrder: 12, endDate: '2030-12-31', adapterId: 'saffron', adapterVersion: '1', extractionMethod: 'selector' });
    for (const [field, evidence] of Object.entries(tenPercent.evidence)) {
      expect(evidence.method).toBe(`selector:saffron@1:${field}`);
      expect(evidence.text.length).toBeLessThanOrEqual(500);
    }

    const businesses = await adapter.extractBusiness({ ...ctx, plan: pages });
    expect(businesses[0]).toMatchObject({ telephone: '0114 496 0333', postcode: 'S1 4GF' });
    expect(businesses[0].evidence.telephone.method).toBe('selector:saffron@1:telephone');

    // Other templates are not handled.
    expect((await adapter.canHandle(contextFor('dragon-wok.test'))).canHandle).toBe(false);
    expect((await adapter.canHandle(contextFor('panda-noodles.test'))).canHandle).toBe(false);
  });

  it('reads OrderNest promotion widgets with the provider adapter', async () => {
    const adapter = new OrderNestAdapter();
    const ctx = contextFor('luigis.ordernest.test');
    expect((await adapter.canHandle(ctx)).canHandle).toBe(true);
    const offers = await adapter.extractOfferDetails(ctx, [{ url: server.url('luigis.ordernest.test', '/'), roles: ['home'], priority: 1, source: 'seed' }]);
    const garlic = offers.find((o) => /garlic bread/i.test(o.offer.title))!.offer;
    expect(garlic).toMatchObject({ offerType: 'free_item', promoCode: 'GARLIC30', adapterId: 'provider-ordernest' });
    expect(garlic.evidence.title.method).toBe('provider:provider-ordernest@1.0.0:title');
    // The same widgets read as visible text by the fallback extractors aren't reported a second time.
    expect(offers.map((o) => o.offer.title)).toEqual(['25% off pizzas on Mondays', 'Free garlic bread over £30']);
    expect((await adapter.canHandle(contextFor('saffron-spice.test'))).canHandle).toBe(false);
  });

  describe('precedence: provider > selector > JSON-LD > HTML', () => {
    async function storeSaffronAdapter(status: ScraperAdapterStatus) {
      const fingerprint = await saffronFingerprint();
      await h.models.adapters.create({
        key: 'saffron',
        name: 'Saffron Theme',
        type: ScraperAdapterType.SELECTOR,
        version: '1',
        priority: 300,
        status,
        isCurrent: true,
        fingerprintRef: fingerprint._id,
        exampleDomains: ['saffron-spice.test', 'lotus-garden.test'],
        configuration: await suggestedConfig(),
      });
      registry.invalidate();
    }

    it('picks the provider adapter, then an approved selector adapter, then JSON-LD, then HTML', async () => {
      await storeSaffronAdapter(ScraperAdapterStatus.APPROVED);
      expect((await registry.select(contextFor('luigis.ordernest.test'))).adapter.id).toBe('provider-ordernest');

      const kings = await registry.select(contextFor('kings-grill.test'));
      expect(kings.adapter.id).toBe('saffron');
      expect(kings.considered.map((c) => c.id)).toEqual(['saffron', 'provider-ordernest', 'provider-foodhub', 'provider-grub24', 'generic-jsonld', 'generic-html']);

      await h.models.adapters.updateOne({ key: 'saffron' }, { $set: { status: ScraperAdapterStatus.PAUSED } });
      registry.invalidate();
      expect((await registry.select(contextFor('kings-grill.test'))).adapter.id).toBe('generic-jsonld');

      await h.models.adapters.updateOne({ key: 'generic-jsonld' }, { $set: { status: ScraperAdapterStatus.PAUSED } });
      expect((await registry.select(contextFor('kings-grill.test'))).adapter.id).toBe('generic-html');
    });

    it('runs a selector adapter under test only on its example websites', async () => {
      await storeSaffronAdapter(ScraperAdapterStatus.TESTING);
      expect((await registry.select(contextFor('saffron-spice.test'))).adapter.id).toBe('saffron');
      const kings = await registry.select(contextFor('kings-grill.test'));
      expect(kings.adapter.id).toBe('generic-jsonld');
      expect(kings.considered.find((c) => c.id === 'saffron')?.match.reasons[0]).toMatch(/example websites only/);
    });

    it('resolves the exact version a run chose, and never a withdrawn one', async () => {
      await storeSaffronAdapter(ScraperAdapterStatus.APPROVED);
      expect((await registry.resolve('saffron', '1'))?.version).toBe('1');
      expect(await registry.resolve('saffron', '2')).toBeUndefined();
      await h.models.adapters.updateOne({ key: 'saffron' }, { $set: { status: ScraperAdapterStatus.WITHDRAWN, isCurrent: false } });
      expect(await registry.resolve('saffron', '1')).toBeUndefined();
      expect((await registry.resolve('generic-html'))?.id).toBe('generic-html');
    });
  });
});
