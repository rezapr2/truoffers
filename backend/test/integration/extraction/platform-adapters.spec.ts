import * as cheerio from 'cheerio';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import type { LoadedPage, WebsiteContext } from '../../../src/scraper/extraction/adapter.types';
import { FoodhubAdapter } from '../../../src/scraper/extraction/adapters/foodhub.adapter';
import { Grub24Adapter } from '../../../src/scraper/extraction/adapters/grub24.adapter';
import { JsonLdAdapter } from '../../../src/scraper/extraction/adapters/jsonld.adapter';
import { OrderNestAdapter } from '../../../src/scraper/extraction/adapters/ordernest.adapter';
import { validateExtractedOffer } from '../../../src/scraper/extraction/validate-offer';
import { FOODHUB_DISCOUNT, foodhubMenuResponse, foodhubStoreResponse } from '../../helpers/foodhub-app';

const SITES = path.join(__dirname, '..', '..', 'fixtures', 'sites');
const checkedAt = new Date('2026-09-18T12:00:00Z');

function pageOf(host: string): LoadedPage {
  const html = readFileSync(path.join(SITES, host, 'index.html'), 'utf8');
  const url = `https://${host}/`;
  const $ = cheerio.load(html);
  return { url, finalUrl: url, status: 200, title: $('title').text(), html, $, nofollow: false, fetchedAt: checkedAt };
}

function contextFor(page: LoadedPage): WebsiteContext {
  return {
    site: { id: 'site', domain: new URL(page.url).hostname, homepageUrl: page.url },
    runId: 'run',
    checkedAt,
    signal: new AbortController().signal,
    loadPage: async () => page,
    log: () => undefined,
  } as WebsiteContext;
}

describe('ordering platform adapters (spec §2.3/§5)', () => {
  describe('Foodhub', () => {
    const page = pageOf('fh-sultan.test');
    const adapter = new FoodhubAdapter();

    it('recognises a Foodhub page, and only a Foodhub page', async () => {
      expect((await adapter.canHandle(contextFor(page))).canHandle).toBe(true);
      expect((await adapter.canHandle(contextFor(pageOf('g24-caspian.test')))).canHandle).toBe(false);
      expect((await adapter.canHandle(contextFor(pageOf('pizza-palace.test')))).canHandle).toBe(false);
    });

    it('reads the discounts from the page data, with verbatim evidence', () => {
      const { offers, businesses } = adapter.extractFromPage(page, ['home'], { checkedAt });
      expect(businesses[0]).toMatchObject({ name: 'Sultan Grill', postcode: 'B45 9ZZ' });
      // The zero-value discount is not an offer.
      expect(offers.map((o) => o.offer.title)).toEqual(['10% off orders over £20', '35% off orders over £20']);
      const [ten, thirtyFive] = offers.map((o) => o.offer);
      expect(ten).toMatchObject({ offerType: 'percentage_discount', discountPercentage: 10, minimumOrder: 20, terms: 'Up to £25 off', adapterId: 'provider-foodhub' });
      expect(thirtyFive).toMatchObject({ discountPercentage: 35, endDate: '2031-03-31' });
      expect(thirtyFive.evidence.discountPercentage.method).toBe('provider:provider-foodhub@1.1.0:discountPercentage');
      expect(thirtyFive.evidence.discountPercentage.text).toContain('"value":35');
      expect(thirtyFive.sources[0].excerpt).toContain('"min_order":"20.00"');
      for (const offer of offers) expect(validateExtractedOffer(offer.offer, checkedAt).valid).toBe(true);
    });

    it('leaves collection or delivery for the reviewer, because the page does not say which is which', () => {
      const { offers } = adapter.extractFromPage(page, ['home'], { checkedAt });
      for (const { offer, flags } of offers) {
        expect(flags).toContain('order_type_unconfirmed');
        expect(offer.collectionEligible).toBeUndefined();
        expect(offer.deliveryEligible).toBeUndefined();
      }
    });

    it('tells a render which data to wait for: the store, not the menu or other requests', () => {
      const expects = adapter.renderExpects!;
      expect(expects.test('/api/consumer/store')).toBe(true);
      expect(expects.test('/api/consumer/store/9002/menu/foodhub/friday.json')).toBe(false);
      expect(expects.test('/api/consumer/offer/banner')).toBe(false);
      expect(new Grub24Adapter().renderExpects).toBeUndefined();
    });

    it('reads the discounts whatever the store’s offer_status says', () => {
      // A live Foodhub site showed its discount to visitors while its data said INACTIVE.
      const { offers } = adapter.extractFromPage(pageOf('fh-app.test'), ['home'], { checkedAt });
      expect(offers.map((o) => o.offer.title)).toEqual(['10% off orders over £15']);
    });

    describe('from what the app loaded while the page was rendered', () => {
      // The page's own data is empty, as a Foodhub site's sometimes is; the app fetched the store and menu itself.
      function renderedPage(dataResponses: LoadedPage['dataResponses']): LoadedPage {
        const empty = Buffer.from(JSON.stringify({ initConfig: '{}', store: {} })).toString('base64');
        const html = `<html><head><link rel="preconnect" href="https://assets.foodhub.com"></head><body><input type="hidden" id="prerender-data" value="${empty}"></body></html>`;
        const url = 'https://fh-app.test/';
        return { url, finalUrl: url, status: 200, html, $: cheerio.load(html), nofollow: false, fetchedAt: checkedAt, dataResponses };
      }
      const store = { url: 'https://fh-app.test/api/consumer/store', json: foodhubStoreResponse() };
      const menu = { url: 'https://fh-app.test/api/consumer/store/9002/menu/foodhub/friday.json', json: foodhubMenuResponse() };

      it('reads the store’s discounts, once each', () => {
        const again = { url: 'https://fh-app.test/api/consumer/store/9002/advanced_discounts', json: { advanced_discounts: [FOODHUB_DISCOUNT, { ...FOODHUB_DISCOUNT, value: 20, menu_item_id: 777 }] } };
        const { offers } = adapter.extractFromPage(renderedPage([store, again]), ['home'], { checkedAt });
        expect(offers.map((o) => o.offer.title)).toEqual(['10% off orders over £15', '20% off orders over £15']);
        expect(offers[0].offer).toMatchObject({ discountPercentage: 10, minimumOrder: 15, terms: 'Up to £20 off' });
        expect(offers[0].offer.evidence.discountPercentage.text).toContain('"value":10');
        // A discount tied to a menu item it doesn't name waits for the reviewer.
        expect(offers[1].flags).toContain('single_item_unconfirmed');
      });

      it('does not report the store’s discount a second time when the page’s structured data restates it', () => {
        const ld = JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Restaurant',
          name: 'Marco Pizza',
          makesOffer: [
            { '@type': 'Offer', name: 'Get 10% Off', description: 'Order online today' },
            { '@type': 'Offer', name: '15% off orders over £40', description: 'Weekends only' },
          ],
        });
        const html = `<html><head><link rel="preconnect" href="https://assets.foodhub.com/"><script type="application/ld+json">${ld}</script></head><body></body></html>`;
        const url = 'https://fh-app.test/';
        const page: LoadedPage = { url, finalUrl: url, status: 200, html, $: cheerio.load(html), nofollow: false, fetchedAt: checkedAt, dataResponses: [store] };
        const titles = adapter.extractFromPage(page, ['home'], { checkedAt }).offers.map((o) => o.offer.title);
        // The store's 10% is reported once; a different percentage the page mentions still is.
        expect(titles).toEqual(['10% off orders over £15', '15% off orders over £40']);
      });

      it('reads the deals in the menu’s offer categories, with the order types and days the menu states', () => {
        const { offers } = adapter.extractFromPage(renderedPage([store, menu]), ['home'], { checkedAt });
        const byTitle = Object.fromEntries(offers.map((o) => [o.offer.title, o.offer]));
        // Ordinary dishes, items not shown online and hidden categories are not offers.
        expect(Object.keys(byTitle).sort()).toEqual([
          '10" Double Saver: Any 2 X 10" Pizzas',
          '10% off orders over £15',
          'Meal Deal 1: Any 10" Pizza, Fries & Can of Drink',
          'Offer 1: Any 8" pizza',
          'Weekday Saver: Any 12" Pizza',
        ]);
        expect(byTitle['10" Double Saver: Any 2 X 10" Pizzas']).toMatchObject({ offerType: 'multi_buy', promotionalPrice: 15.99 });
        expect(byTitle['Meal Deal 1: Any 10" Pizza, Fries & Can of Drink']).toMatchObject({ offerType: 'meal_deal', promotionalPrice: 11.99 });
        expect(byTitle['Offer 1: Any 8" pizza']).toMatchObject({ promotionalPrice: 4.99, collectionEligible: true, deliveryEligible: false });
        expect(byTitle['Weekday Saver: Any 12" Pizza'].eligibleWeekdays).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
        const deal = byTitle['Meal Deal 1: Any 10" Pizza, Fries & Can of Drink'];
        expect(deal.evidence.promotionalPrice.method).toBe('provider:provider-foodhub@1.1.0:promotionalPrice');
        expect(deal.sources[0].excerpt).toContain('"price":"11.99"');
        for (const { offer } of offers) expect(validateExtractedOffer(offer, checkedAt).valid).toBe(true);
      });

      it('ignores a menu that would expand past its size limit, and categories outside a menu response', () => {
        const bomb = { url: menu.url, json: { data: [deflateSync(Buffer.alloc(20 * 1024 * 1024, 32)).toString('base64')] } };
        const elsewhere = { url: 'https://fh-app.test/api/consumer/menu-preview', json: foodhubMenuResponse() };
        const stray = { url: 'https://fh-app.test/api/featured', json: JSON.parse(JSON.stringify(foodhubMenuResponse())) as unknown };
        expect(adapter.extractFromPage(renderedPage([bomb, elsewhere, stray]), ['home'], { checkedAt }).offers).toEqual([]);
      });
    });
  });

  describe('Grub24', () => {
    const page = pageOf('g24-caspian.test');
    const adapter = new Grub24Adapter();

    it('recognises a Grub24 page', async () => {
      expect((await adapter.canHandle(contextFor(page))).canHandle).toBe(true);
      expect((await adapter.canHandle(contextFor(pageOf('fh-sultan.test')))).canHandle).toBe(false);
    });

    it('reads the offers list and the deals in offer categories from the streamed page data', () => {
      const { offers, businesses } = adapter.extractFromPage(page, ['home'], { checkedAt });
      expect(businesses[0]).toMatchObject({ name: 'Caspian Slice', postcode: 'B17 9ZZ' });
      const byTitle = Object.fromEntries(offers.map((o) => [o.offer.title, o.offer]));
      expect(Object.keys(byTitle).sort()).toEqual(
        ['15% Off over £20.00 if delivery', 'Any Small 8" Pizza', 'Buy One 16inch Pizza Get One 8inch For Free', 'Family Special - 12"'].sort(),
      );
      // An ordinary menu item is never an offer.
      expect(byTitle.Margherita).toBeUndefined();

      expect(byTitle['15% Off over £20.00 if delivery']).toMatchObject({
        offerType: 'percentage_discount',
        discountPercentage: 15,
        minimumOrder: 20,
        deliveryEligible: true,
        collectionEligible: false,
        endDate: '2029-09-25',
      });
      expect(byTitle['Buy One 16inch Pizza Get One 8inch For Free'].offerType).toBe('buy_one_get_one_free');
      expect(byTitle['Family Special - 12"']).toMatchObject({ offerType: 'meal_deal', promotionalPrice: 39.99 });
      expect(byTitle['Any Small 8" Pizza']).toMatchObject({ promotionalPrice: 5.99, collectionEligible: true, deliveryEligible: false });

      const special = byTitle['Buy One 16inch Pizza Get One 8inch For Free'];
      expect(special.evidence.title.method).toBe('provider:provider-grub24@1.0.0:title');
      expect(special.evidence.title.text).toContain('"item_name":"Buy One 16inch Pizza Get One 8inch For Free"');
      for (const offer of offers) expect(validateExtractedOffer(offer.offer, checkedAt).valid).toBe(true);
    });
  });

  it('takes precedence over JSON-LD, like every provider adapter', async () => {
    for (const [Adapter, host] of [[FoodhubAdapter, 'fh-sultan.test'], [Grub24Adapter, 'g24-caspian.test']] as const) {
      const provider = new Adapter();
      expect(provider.priority).toBe(new OrderNestAdapter().priority);
      expect(provider.priority).toBeGreaterThan(new JsonLdAdapter().priority);
      // JSON-LD alone reads the business but none of the offers.
      expect(new JsonLdAdapter().extractFromPage(pageOf(host), ['home'], { checkedAt }).offers).toEqual([]);
    }
  });
});
