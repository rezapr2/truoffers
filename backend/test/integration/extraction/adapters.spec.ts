import { ScraperAdapterStatus } from '../../../src/common/scraper.enums';
import {
  EVIDENCED_OFFER_FIELDS,
  OfferExtraction,
  WebsiteContext,
} from '../../../src/scraper/extraction/adapter.types';
import { AdapterRegistry } from '../../../src/scraper/extraction/adapter-registry.service';
import { JsonLdAdapter } from '../../../src/scraper/extraction/adapters/jsonld.adapter';
import { GenericHtmlAdapter } from '../../../src/scraper/extraction/adapters/generic-html.adapter';
import { FixtureServer, startFixtureServer } from '../../helpers/fixture-server';
import { createSafetyHarness, SafetyHarness } from '../../helpers/safety-harness';

const CHECKED_AT = new Date('2026-09-14T10:00:00Z');
const SITES = ['pizza-palace.test', 'curry-house.test', 'kebab-king.test', 'noindex.test', 'spa-only.test', 'robots-blocked.test'];
const RUN = '64b000000000000000000002';

describe('built-in adapters on fixture sites', () => {
  let server: FixtureServer;
  let h: SafetyHarness;
  let registry: AdapterRegistry;

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
    await registry.ensureRegistered();
    for (const domain of SITES) await h.authorise(domain);
  });

  const contextFor = (domain: string): WebsiteContext => {
    const loader = h.loader({ runId: RUN, siteDomain: domain });
    return {
      site: { id: domain, domain, homepageUrl: server.url(domain, '/') },
      runId: RUN,
      checkedAt: CHECKED_AT,
      signal: new AbortController().signal,
      loadPage: (url) => loader.load(url),
      log: () => undefined,
    };
  };

  const byTitle = (offers: OfferExtraction[], fragment: string) => {
    const found = offers.find((o) => o.offer.title.toLowerCase().includes(fragment.toLowerCase()));
    if (!found) throw new Error(`No offer titled like "${fragment}" in: ${offers.map((o) => o.offer.title).join(' | ')}`);
    return found;
  };

  const expectFullyEvidenced = (offers: OfferExtraction[], domain: string) => {
    for (const { offer } of offers) {
      for (const field of EVIDENCED_OFFER_FIELDS) {
        const value = (offer as any)[field];
        if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
        expect(offer.evidence[field]).toBeDefined();
        expect(offer.evidence[field].sourceUrl).toContain(domain);
        expect(offer.evidence[field].text.length).toBeGreaterThan(0);
        expect(offer.evidence[field].text.length).toBeLessThanOrEqual(500);
      }
      expect(offer.sources[0].excerpt.length).toBeLessThanOrEqual(500);
    }
  };

  describe('adapter selection', () => {
    it('prefers JSON-LD when the site has structured data', async () => {
      const selection = await registry.select(contextFor('pizza-palace.test'));
      expect(selection.adapter).toBeInstanceOf(JsonLdAdapter);
      expect(selection.considered.map((c) => c.id)).toEqual(['provider-ordernest', 'provider-foodhub', 'provider-grub24', 'generic-jsonld', 'generic-html']);
    });

    it('falls back to generic HTML without structured data', async () => {
      const selection = await registry.select(contextFor('curry-house.test'));
      expect(selection.adapter.id).toBe('generic-html');
      expect(selection.considered.find((c) => c.id === 'generic-jsonld')?.match.canHandle).toBe(false);
    });

    it('never selects a paused adapter', async () => {
      await h.models.adapters.updateOne({ key: 'generic-jsonld' }, { status: ScraperAdapterStatus.PAUSED });
      const selection = await registry.select(contextFor('pizza-palace.test'));
      expect(selection.adapter.id).toBe('generic-html');
      expect(selection.considered.map((c) => c.id)).toEqual(['provider-ordernest', 'provider-foodhub', 'provider-grub24', 'generic-html']);
    });
  });

  describe('Pizza Palace (JSON-LD template)', () => {
    it('discovers useful same-site pages but not private, off-site or duplicate ones', async () => {
      const discovery = await new JsonLdAdapter().discover(contextFor('pizza-palace.test'));
      const paths = discovery.pages.map((p) => new URL(p.url).pathname);
      expect(paths).toEqual(expect.arrayContaining(['/', '/offers', '/menu', '/contact']));
      expect(paths).not.toContain('/login');
      expect(paths).not.toContain('/basket');
      expect(paths.filter((p) => p === '/offers')).toHaveLength(1);
      expect(discovery.offsite.map((u) => u.hostname)).toEqual(expect.arrayContaining(['pizza-palace-friends.test', 'www.facebook.com']));
    });

    it('extracts the business from structured data and the contact page', async () => {
      const ctx = contextFor('pizza-palace.test');
      const adapter = new JsonLdAdapter();
      const businesses = await adapter.extractBusiness({ ...ctx, plan: await adapter.discoverPages(ctx) });
      expect(businesses).toHaveLength(1);
      expect(businesses[0]).toMatchObject({
        branchPath: '/',
        name: 'Pizza Palace',
        telephone: '+441134960123',
        postcode: 'LS1 4AP',
        town: 'Leeds',
        orderUrl: 'https://order.pizza-palace.test/start',
      });
      expect(businesses[0].evidence.name.method).toBe('jsonld:Restaurant.name');
    });

    it('extracts structured and visible offers with their terms', async () => {
      const ctx = contextFor('pizza-palace.test');
      const adapter = new JsonLdAdapter();
      const offers = await adapter.extractOfferDetails(ctx, await adapter.discoverPages(ctx));

      expect(byTitle(offers, '20% off online orders').offer).toMatchObject({
        offerType: 'percentage_discount',
        discountPercentage: 20,
        promoCode: 'PIZZA20',
        minimumOrder: 20,
        endDate: '2026-12-31',
        extractionMethod: 'jsonld',
        adapterId: 'generic-jsonld',
        adapterVersion: '1.0.0',
      });
      expect(byTitle(offers, '20% off online orders').signals.structuredData).toBe(true);

      expect(byTitle(offers, '2 for 1').offer).toMatchObject({
        offerType: 'buy_one_get_one_free',
        eligibleWeekdays: ['tue'],
        dailyStartTime: '17:00',
        dailyEndTime: '22:00',
        applicableProducts: ['large pizzas'],
      });
      expect(byTitle(offers, 'Lunch Special').offer).toMatchObject({
        offerType: 'custom',
        promotionalPrice: 7.99,
        eligibleWeekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
        dailyEndTime: '15:00',
        collectionEligible: true,
        deliveryEligible: false,
      });
      expect(byTitle(offers, 'First order').offer).toMatchObject({
        offerType: 'fixed_discount',
        discountAmount: 5,
        promoCode: 'HELLO5',
        newCustomersOnly: true,
        minimumOrder: 15,
        endDate: '2026-10-31',
      });
      const christmas = byTitle(offers, 'mince pie');
      expect(christmas.signals.stale).toBe(true);
      expect((await adapter.validateOffer(christmas.offer)).valid).toBe(false);

      // Plain menu prices, struck-through prices and dietary notes are not offers.
      expect(offers.filter((o) => o.pageUrl.includes('/menu'))).toHaveLength(0);
      expectFullyEvidenced(offers, 'pizza-palace.test');
    });
  });

  describe('Curry House (static HTML template)', () => {
    it('extracts every deal and ignores menu items', async () => {
      const ctx = contextFor('curry-house.test');
      const adapter = new GenericHtmlAdapter();
      const offers = await adapter.extractOfferDetails(ctx, await adapter.discoverPages(ctx));

      expect(byTitle(offers, 'free delivery').offer).toMatchObject({
        offerType: 'free_delivery',
        minimumOrder: 20,
        eligibleWeekdays: ['mon', 'tue', 'wed', 'thu'],
      });
      expect(byTitle(offers, 'Collection discount').offer).toMatchObject({
        offerType: 'collection_discount',
        discountPercentage: 15,
        minimumOrder: 25,
        promoCode: 'COLLECT15',
        endDate: '2026-11-30',
      });
      expect(byTitle(offers, 'onion bhaji').offer).toMatchObject({ offerType: 'free_item', freeItem: 'onion bhaji', minimumOrder: 30 });
      expect(byTitle(offers, 'Family Feast').offer).toMatchObject({
        offerType: 'meal_deal',
        promotionalPrice: 34.99,
        eligibleWeekdays: ['fri', 'sat'],
      });
      expect(byTitle(offers, 'first online order').offer).toMatchObject({
        offerType: 'percentage_discount',
        discountPercentage: 10,
        promoCode: 'WELCOME10',
        newCustomersOnly: true,
      });
      expect(byTitle(offers, 'Meal deal for one').offer).toMatchObject({ offerType: 'meal_deal', promotionalPrice: 12.95 });

      const titles = offers.map((o) => o.offer.title).join(' | ');
      expect(titles).not.toMatch(/Tikka|Rogan|Balti|Gluten|Open Monday/i);
      expectFullyEvidenced(offers, 'curry-house.test');
    });

    it('never requests private pages', async () => {
      const ctx = contextFor('curry-house.test');
      const adapter = new GenericHtmlAdapter();
      await adapter.extractOfferDetails(ctx, await adapter.discoverPages(ctx));
      expect(server.requestsFor('curry-house.test').map((r) => r.path)).not.toContain('/my-account/orders');
    });
  });

  describe('Kebab King (multi-branch template)', () => {
    it('finds each branch and attributes branch-page offers to it', async () => {
      const ctx = contextFor('kebab-king.test');
      const adapter = new GenericHtmlAdapter();
      const plan = await adapter.discoverPages(ctx);
      expect(plan.map((p) => new URL(p.url).pathname)).toEqual(expect.arrayContaining(['/locations', '/leeds', '/manchester']));

      const businesses = await adapter.extractBusiness({ ...ctx, plan });
      expect(businesses.map((b) => b.branchPath).sort()).toEqual(['/leeds', '/manchester']);
      expect(businesses.find((b) => b.branchPath === '/leeds')).toMatchObject({
        postcode: 'LS1 6HD',
        telephone: '+441134960789',
        town: 'Leeds',
      });
      expect(businesses.find((b) => b.branchPath === '/manchester')).toMatchObject({
        postcode: 'M1 1JG',
        telephone: '+441614960321',
      });

      const offers = await adapter.extractOfferDetails(ctx, plan);
      expect(byTitle(offers, 'wraps')).toMatchObject({ branchPath: '/leeds' });
      expect(byTitle(offers, 'Free chips')).toMatchObject({ branchPath: '/manchester' });
      expect(byTitle(offers, 'Half price kebabs').branchPath).toBeUndefined();
    });
  });

  describe('sites the static adapters must not use', () => {
    it('does not use noindex pages', async () => {
      const ctx = contextFor('noindex.test');
      const adapter = new GenericHtmlAdapter();
      await expect(adapter.extractOfferDetails(ctx, await adapter.discoverPages(ctx))).resolves.toEqual([]);
    });

    it('never fetches pages robots.txt disallows', async () => {
      const ctx = contextFor('robots-blocked.test');
      const adapter = new GenericHtmlAdapter();
      await expect(adapter.extractOfferDetails(ctx, await adapter.discoverPages(ctx))).resolves.toEqual([]);
      expect(server.requestsFor('robots-blocked.test').map((r) => r.path)).toEqual(['/robots.txt']);
    });

    it('finds nothing on a JavaScript-only page', async () => {
      const ctx = contextFor('spa-only.test');
      const adapter = new GenericHtmlAdapter();
      await expect(adapter.extractOfferDetails(ctx, await adapter.discoverPages(ctx))).resolves.toEqual([]);
    });
  });
});
