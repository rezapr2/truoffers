import { Types } from 'mongoose';
import { DiscountType, OfferStatus } from '../../../src/common/enums';
import { ConfidenceBand, OfferManagedBy, OfferOrigin } from '../../../src/common/scraper.enums';
import type { OfferExtraction } from '../../../src/scraper/extraction/adapter.types';
import { contentFingerprint } from '../../../src/scraper/extraction/content-fingerprint';
import { BlockContext, parseOfferBlock } from '../../../src/scraper/extraction/offer-text-parser';
import { validateExtractedOffer } from '../../../src/scraper/extraction/validate-offer';
import {
  comparableOfPublished,
  displayLabelFor,
  fingerprintOfPublishedOffer,
  redemptionTypeFor,
} from '../../../src/scraper/lifecycle/offer-mapping';
import { dedupeDecision, ExistingOfferView, mergeRunExtractions } from '../../../src/scraper/matching/offer-dedupe';
import { trigramSimilarity, trigrams } from '../../../src/scraper/matching/trigram';
import { bandFor, computeConfidence, ConfidenceInput } from '../../../src/scraper/scoring/confidence';

const CHECKED_AT = new Date('2026-09-14T10:00:00Z');
const ctx = (overrides: Partial<BlockContext> = {}): BlockContext => ({
  sourceUrl: 'https://pizza-palace.test/offers',
  checkedAt: CHECKED_AT,
  adapterId: 'generic-jsonld',
  adapterVersion: '1.0.0',
  extractionMethod: 'html_pattern',
  methodPrefix: 'html',
  offerContext: true,
  ...overrides,
});
const extract = (text: string, overrides: Partial<BlockContext> = {}): OfferExtraction => parseOfferBlock(text, text, ctx(overrides))[0];

describe('pg_trgm-equivalent similarity', () => {
  it('pads words like pg_trgm', () => {
    expect([...trigrams('word')].sort()).toEqual(['  w', ' wo', 'ord', 'rd ', 'wor'].sort());
  });

  it.each([
    ['word', 'two words', 4 / 11],
    ['bella napoli', 'bella napoli', 1],
    ['pizza palace', 'kebab king', 0],
  ])('similarity(%s, %s)', (a, b, expected) => {
    expect(trigramSimilarity(a, b)).toBeCloseTo(expected, 5);
  });

  it('keeps near-identical listings above the 0.8 threshold and different ones below it', () => {
    expect(trigramSimilarity('bella napoli pizzeria', 'bella napoli pizzeria leeds')).toBeGreaterThanOrEqual(0.7);
    expect(trigramSimilarity('curry house', 'curry house')).toBeGreaterThanOrEqual(0.8);
    expect(trigramSimilarity('curry house', 'curry kingdom')).toBeLessThan(0.5);
  });
});

describe('confidence scoring (spec §7)', () => {
  const base = (extraction: OfferExtraction, overrides: Partial<ConfidenceInput> = {}): ConfidenceInput => ({
    extraction,
    validation: validateExtractedOffer(extraction.offer, CHECKED_AT),
    specificAdapter: true,
    businessIdentityMatched: true,
    addressMatched: true,
    seenOnPages: 2,
    conflicts: [],
    corroboratedByStatic: true,
    checkedAt: CHECKED_AT,
    ...overrides,
  });

  it.each([
    [95, ConfidenceBand.HIGH],
    [90, ConfidenceBand.HIGH],
    [89, ConfidenceBand.REVIEW_RECOMMENDED],
    [70, ConfidenceBand.REVIEW_RECOMMENDED],
    [69, ConfidenceBand.MANUAL_INVESTIGATION],
    [40, ConfidenceBand.MANUAL_INVESTIGATION],
    [39, ConfidenceBand.FAILED],
    [0, ConfidenceBand.FAILED],
  ])('score %i is %s', (score, band) => {
    expect(bandFor(score)).toBe(band);
  });

  it('gives a fully evidenced structured offer on a matched business a high score', () => {
    const structured = extract('20% off online orders over £20. Use code PIZZA20. Valid until 31/12/2026.', {
      structuredData: true,
      methodPrefix: 'jsonld:Offer',
    });
    const result = computeConfidence(base(structured));
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.band).toBe(ConfidenceBand.HIGH);
    expect(result.signals.map((s) => s.name)).toEqual(
      expect.arrayContaining(['offer in structured data', 'promo code found', 'dates identified', 'consistent across pages']),
    );
  });

  it('puts a plain visible-text offer with an unresolved business in manual investigation', () => {
    const plain = extract('Free delivery this week');
    const result = computeConfidence(
      base(plain, { specificAdapter: false, businessIdentityMatched: false, addressMatched: false, seenOnPages: 1 }),
    );
    expect(result.band).toBe(ConfidenceBand.MANUAL_INVESTIGATION);
  });

  it('penalises conflicts and staleness', () => {
    const offer = extract('15% off collection orders over £25 with code COLLECT15. Valid until 30/11/2026.');
    const clean = computeConfidence(base(offer)).score;
    expect(computeConfidence(base(offer, { conflicts: ['15% vs 20%'] })).score).toBe(clean - 25);
    const staleSignals = { ...offer, signals: { ...offer.signals, stale: true } };
    expect(computeConfidence(base(staleSignals)).score).toBe(clean - 15);
  });

  it('caps invalid offers below 40 so they can never be approved', () => {
    const ended = extract('20% off everything. Use code OLD20. Offer ended 31 March 2025.');
    const result = computeConfidence(base(ended));
    expect(result.score).toBeLessThanOrEqual(39);
    expect(result.band).toBe(ConfidenceBand.FAILED);
    expect(result.caps[0]).toMatch(/already ended/);
  });

  it('caps uncorroborated AI-only extractions below high confidence', () => {
    const offer = extract('20% off online orders over £20. Use code PIZZA20. Valid until 31/12/2026.', { structuredData: true });
    const aiOnly = { ...offer, signals: { ...offer.signals, aiOnly: true } };
    expect(computeConfidence(base(aiOnly, { corroboratedByStatic: false })).score).toBeLessThanOrEqual(79);
  });

  it('is deterministic', () => {
    const offer = extract('2 for 1 on large pizzas every Tuesday');
    expect(computeConfidence(base(offer))).toEqual(computeConfidence(base(offer)));
  });
});

describe('offer dedupe (spec §9)', () => {
  const offer = extract('15% off collection orders over £25. Use code COLLECT15.').offer;
  const view = (overrides: Partial<ExistingOfferView>): ExistingOfferView => ({
    id: new Types.ObjectId(),
    offerType: offer.offerType,
    title: offer.title,
    discountPercentage: offer.discountPercentage,
    promoCode: offer.promoCode,
    minimumOrder: offer.minimumOrder,
    contentFingerprint: offer.contentFingerprint,
    status: OfferStatus.ACTIVE,
    origin: OfferOrigin.SCRAPER,
    managedBy: OfferManagedBy.SCRAPER,
    ...overrides,
  });

  it('refreshes a live imported offer instead of creating a new one', () => {
    const live = view({});
    expect(dedupeDecision(offer, [live], [])).toEqual({ kind: 'refresh_offer', offerId: live.id });
  });

  it('leaves merchant-owned offers alone', () => {
    expect(dedupeDecision(offer, [view({ managedBy: OfferManagedBy.MERCHANT })], []).kind).toBe('merchant_owned');
    expect(dedupeDecision(offer, [view({ origin: OfferOrigin.MERCHANT, managedBy: undefined })], []).kind).toBe('merchant_owned');
  });

  it('suppresses offers the business removed', () => {
    const removed = view({ status: OfferStatus.REMOVED, managedBy: OfferManagedBy.MERCHANT });
    expect(dedupeDecision(offer, [removed], [])).toMatchObject({ kind: 'suppressed', offerId: removed.id });
  });

  it('merges into an open candidate with the same fingerprint', () => {
    const candidateId = new Types.ObjectId();
    expect(dedupeDecision(offer, [], [{ id: candidateId, contentFingerprint: offer.contentFingerprint }])).toEqual({
      kind: 'merge_candidate',
      candidateId,
    });
  });

  it('flags changed terms on the same offer with a diff', () => {
    const previous = view({ discountPercentage: 10, contentFingerprint: 'older' });
    const decision = dedupeDecision(offer, [previous], []);
    expect(decision).toMatchObject({
      kind: 'changed_terms',
      offerId: previous.id,
      diff: { discountPercentage: { previous: 10, proposed: 15 } },
    });
  });

  it('starts a new offer period when an expired offer reappears', () => {
    const expired = view({ status: OfferStatus.EXPIRED, title: 'Something else entirely' });
    expect(dedupeDecision(offer, [expired], [])).toMatchObject({ kind: 'reappeared', offerId: expired.id });
  });

  it('notes when an admin removed the same offer before', () => {
    expect(dedupeDecision(offer, [view({ status: OfferStatus.REMOVED, managedBy: OfferManagedBy.SCRAPER, title: 'x' })], [])).toEqual({
      kind: 'new',
      previouslyRemovedByAdmin: true,
    });
  });
});

describe('merging a run', () => {
  it('folds the same offer across pages and keeps every source', () => {
    const home = extract('2 for 1 on large pizzas every Tuesday', { sourceUrl: 'https://pizza-palace.test/' });
    const offers = extract('2 for 1 on large pizzas every Tuesday', { sourceUrl: 'https://pizza-palace.test/offers' });
    const [merged] = mergeRunExtractions([home, offers]);
    expect(merged.pageUrls).toEqual(['https://pizza-palace.test/', 'https://pizza-palace.test/offers']);
    expect(merged.offer.sources.map((s) => s.url)).toEqual(merged.pageUrls);
  });

  it('flags offers that look the same but disagree', () => {
    const a = extract('Welcome offer: 10% off your first order with code WELCOME', { sourceUrl: 'https://c.test/' });
    const b = extract('Welcome offer: 15% off your first order with code WELCOME', { sourceUrl: 'https://c.test/deals' });
    const merged = mergeRunExtractions([a, b]);
    expect(merged).toHaveLength(2);
    expect(merged[0].conflicts[0]).toMatch(/discountPercentage: 10 vs 15/);
    expect(merged[1].conflicts).toHaveLength(1);
  });

  it('keeps branch-specific offers scoped and shared ones unscoped', () => {
    const leeds = { ...extract('2 for 1 wraps on Wednesdays'), branchPath: '/leeds' };
    const shared = extract('Half price kebabs every Monday');
    const merged = mergeRunExtractions([leeds, shared]);
    expect(merged.find((m) => m.offer.title.includes('wraps'))?.branchPaths).toEqual(['/leeds']);
    expect(merged.find((m) => m.offer.title.includes('kebabs'))?.branchPaths).toBeUndefined();
  });
});

describe('publishing helpers', () => {
  it('fingerprints merchant-created offers the same way as extracted ones', () => {
    const extracted = extract('£5 off orders over £30 with code FIVER').offer;
    const published = {
      discountType: DiscountType.FIXED,
      value: 5,
      code: 'FIVER',
      minOrder: 30,
      title: extracted.title,
    };
    expect(fingerprintOfPublishedOffer(published as any)).toBe(contentFingerprint(extracted));
    expect(comparableOfPublished(published as any)).toMatchObject({ offerType: 'fixed_discount', discountAmount: 5, minimumOrder: 30 });
  });

  it.each([
    [{ offerType: 'percentage_discount', discountPercentage: 20 }, '20% off'],
    [{ offerType: 'fixed_discount', discountAmount: 5 }, '£5 off'],
    [{ offerType: 'buy_one_get_one_free' }, '2 for 1'],
    [{ offerType: 'meal_deal', promotionalPrice: 34.99 }, 'Deal £34.99'],
    [{ offerType: 'delivery_discount', discountPercentage: 15 }, '15% delivery'],
  ])('labels %j as %s', (offer, label) => {
    expect(displayLabelFor(offer as any)).toBe(label);
  });

  it('chooses how the offer is redeemed', () => {
    expect(redemptionTypeFor('SAVE10', {})).toBe('code');
    expect(redemptionTypeFor(undefined, { orderUrl: 'https://x.test' })).toBe('direct_link');
    expect(redemptionTypeFor(undefined, {})).toBe('show_in_store');
  });
});
