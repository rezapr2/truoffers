import { EVIDENCED_OFFER_FIELDS } from '../../../../src/scraper/extraction/adapter.types';
import { contentFingerprint } from '../../../../src/scraper/extraction/content-fingerprint';
import { BlockContext, parseOfferBlock } from '../../../../src/scraper/extraction/offer-text-parser';
import { validateExtractedOffer } from '../../../../src/scraper/extraction/validate-offer';

const CHECKED_AT = new Date('2026-09-14T10:00:00Z');
const ctx = (overrides: Partial<BlockContext> = {}): BlockContext => ({
  sourceUrl: 'https://curry-house.test/deals',
  pageTitle: 'Deals | Curry House',
  checkedAt: CHECKED_AT,
  adapterId: 'generic-html',
  adapterVersion: '1.0.0',
  extractionMethod: 'html_pattern',
  methodPrefix: 'html',
  offerContext: true,
  ...overrides,
});

describe('parseOfferBlock', () => {
  it('builds a collection discount with code, minimum order and dates, all evidenced', () => {
    const [result] = parseOfferBlock(
      '15% off collection orders over £20',
      '15% off collection orders over £20. Use code COLLECT15 at checkout. Valid until 31st October. Not valid with other offers.',
      ctx({ heading: 'Collection Special' }),
    );
    const { offer, signals, flags } = result;
    expect(offer).toMatchObject({
      offerType: 'collection_discount',
      discountPercentage: 15,
      minimumOrder: 20,
      promoCode: 'COLLECT15',
      endDate: '2026-10-31',
      collectionEligible: true,
      deliveryEligible: false,
      currency: 'GBP',
      title: 'Collection Special: 15% off collection orders over £20',
    });
    expect(offer.terms).toContain('Not valid with other offers');
    expect(flags).toContain('year_inferred');
    expect(signals).toMatchObject({ promotionalLanguage: true, benefitParsed: true, termsParsed: true, promoCodeFound: true, datesIdentified: true });

    const populated = EVIDENCED_OFFER_FIELDS.filter((f) => (offer as any)[f] !== undefined);
    for (const field of populated) {
      expect(offer.evidence[field]).toMatchObject({ sourceUrl: 'https://curry-house.test/deals' });
      expect(offer.evidence[field].text.length).toBeGreaterThan(0);
      expect(offer.evidence[field].text.length).toBeLessThanOrEqual(500);
    }
    expect(offer.evidence.promoCode.text).toContain('COLLECT15');
    expect(offer.evidence.endDate.method).toBe('html:end_date');
    expect(offer.contentFingerprint).toBe(contentFingerprint(offer));
    expect(validateExtractedOffer(offer, CHECKED_AT)).toMatchObject({ valid: true, errors: [] });
  });

  it('reads a weekday BOGOF with products and a time window', () => {
    const [{ offer }] = parseOfferBlock(
      '2 for 1 on large pizzas every Tuesday',
      'Two-for-Tuesday. 2 for 1 on large pizzas every Tuesday, 5-9pm. Cheapest pizza free.',
      ctx(),
    );
    expect(offer).toMatchObject({
      offerType: 'buy_one_get_one_free',
      applicableProducts: ['large pizzas'],
      eligibleWeekdays: ['tue'],
      dailyStartTime: '17:00',
      dailyEndTime: '21:00',
    });
  });

  it('splits a card with two benefits into two offers sharing its terms', () => {
    const results = parseOfferBlock(
      'Free delivery and 10% off your first order',
      'Free delivery and 10% off your first order with code WELCOME10. New customers only.',
      ctx(),
    );
    expect(results.map((r) => r.offer.offerType)).toEqual(['free_delivery', 'percentage_discount']);
    for (const { offer, flags } of results) {
      expect(offer.newCustomersOnly).toBe(true);
      expect(offer.promoCode).toBe('WELCOME10');
      expect(flags).toContain('split_from_combined_block');
    }
    expect(results[0].offer.contentFingerprint).not.toBe(results[1].offer.contentFingerprint);
  });

  it('extracts a free item with a spend threshold', () => {
    const [{ offer }] = parseOfferBlock('Free onion bhaji when you spend £25', 'Free onion bhaji when you spend £25 or more.', ctx());
    expect(offer).toMatchObject({ offerType: 'free_item', freeItem: 'onion bhaji', minimumOrder: 25 });
  });

  it('only treats meal deals and price points as offers in an offer context', () => {
    expect(parseOfferBlock('Family Feast £34.99', 'Family Feast £34.99 — 2 large pizzas, 2 sides, 1.5L drink', ctx())[0].offer).toMatchObject({
      offerType: 'meal_deal',
      promotionalPrice: 34.99,
    });
    expect(parseOfferBlock('Family Feast £34.99', 'Family Feast £34.99', ctx({ offerContext: false }))).toHaveLength(0);
    expect(parseOfferBlock('Any large pizza just £9.99', 'Any large pizza just £9.99 on Mondays', ctx())[0].offer).toMatchObject({
      offerType: 'custom',
      promotionalPrice: 9.99,
      applicableProducts: ['large pizza'],
    });
  });

  it.each([
    ['Chicken Tikka Masala £9.95', 'Mains'],
    ['Call us on 0113 496 0101', 'Contact'],
    ['Visit us at 241 High Street, LS1 4AP', 'Find us'],
    ['Gluten free bases available on request', 'Dietary'],
    ['Open Monday to Sunday 5pm - 11pm', 'Opening hours'],
  ])('ignores non-offers: %s', (text, heading) => {
    expect(parseOfferBlock(text, text, ctx({ offerContext: false, heading }))).toHaveLength(0);
  });

  it('marks expired offers so validation rejects them', () => {
    const [{ offer, signals }] = parseOfferBlock('20% off everything', '20% off everything. Offer ended 31 March 2025.', ctx());
    expect(signals.stale).toBe(true);
    expect(validateExtractedOffer(offer, CHECKED_AT)).toMatchObject({ valid: false, errors: ['The offer has already ended'] });
  });

  it('does not reuse a generic section heading as the title', () => {
    const [{ offer }] = parseOfferBlock('£5 off orders over £30', '£5 off orders over £30', ctx({ heading: 'Special Offers' }));
    expect(offer.title).toBe('£5 off orders over £30');
  });

  it('caps sources and evidence at 500 characters', () => {
    const long = `20% off all orders this weekend. ${'Lots of extra detail about our kitchen. '.repeat(40)}`;
    const [{ offer }] = parseOfferBlock('20% off all orders this weekend', long, ctx());
    expect(offer.sources[0].excerpt.length).toBeLessThanOrEqual(500);
    for (const entry of Object.values(offer.evidence)) expect(entry.text.length).toBeLessThanOrEqual(500);
  });
});

describe('content fingerprint', () => {
  const base = {
    offerType: 'percentage_discount' as const,
    discountPercentage: 20,
    promoCode: 'SAVE20',
    minimumOrder: 15,
    applicableProducts: ['Pizzas'],
    title: '20% off pizzas over £15',
  };

  it('ignores title word order, case and stopwords', () => {
    expect(contentFingerprint(base)).toBe(contentFingerprint({ ...base, title: 'PIZZAS: 20% off, over £15!', applicableProducts: ['pizzas '] }));
  });

  it.each([
    [{ discountPercentage: 25 }],
    [{ promoCode: 'SAVE25' }],
    [{ minimumOrder: 20 }],
    [{ offerType: 'collection_discount' as const }],
    [{ applicableProducts: ['kebabs'] }],
  ])('changes when terms change: %j', (change) => {
    expect(contentFingerprint({ ...base, ...change })).not.toBe(contentFingerprint(base));
  });
});
