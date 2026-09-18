import * as cheerio from 'cheerio';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { LoadedPage, WebsiteContext } from '../../../src/scraper/extraction/adapter.types';
import { FoodhubAdapter } from '../../../src/scraper/extraction/adapters/foodhub.adapter';
import { Grub24Adapter } from '../../../src/scraper/extraction/adapters/grub24.adapter';
import { JsonLdAdapter } from '../../../src/scraper/extraction/adapters/jsonld.adapter';
import { OrderNestAdapter } from '../../../src/scraper/extraction/adapters/ordernest.adapter';
import { validateExtractedOffer } from '../../../src/scraper/extraction/validate-offer';

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
      expect(thirtyFive.evidence.discountPercentage.method).toBe('provider:provider-foodhub@1.0.0:discountPercentage');
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
