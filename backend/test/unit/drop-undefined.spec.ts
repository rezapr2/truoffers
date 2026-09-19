import { Types } from 'mongoose';
import { dropUndefined } from '../../src/common/drop-undefined';
import type { ExtractedOffer } from '../../src/scraper/extraction/adapter.types';
import { validateExtractedOffer } from '../../src/scraper/extraction/validate-offer';

describe('dropUndefined', () => {
  it('removes undefined keys at any depth and keeps everything else', () => {
    const id = new Types.ObjectId();
    const when = new Date('2026-09-19T12:00:00Z');
    const cleaned = dropUndefined({ a: 1, b: undefined, c: null, d: [{ e: undefined, f: 'x' }, undefined], g: { h: undefined, when, id } });
    expect(cleaned).toEqual({ a: 1, c: null, d: [{ f: 'x' }, undefined], g: { when, id } });
    expect('b' in cleaned).toBe(false);
    expect(cleaned.g.when).toBe(when);
    expect(cleaned.g.id).toBe(id);
  });
});

describe('validateExtractedOffer with fields stored as null', () => {
  const base = { title: '2 for £12.99', currency: 'GBP', offerType: 'multi_buy', promotionalPrice: 12.99, lastCheckedAt: new Date() } as unknown as ExtractedOffer;

  it('treats a null percentage as absent, as it is when the field was never set', () => {
    const stored = { ...base, discountPercentage: null, applicableProducts: null } as unknown as ExtractedOffer;
    expect(validateExtractedOffer(stored).errors).toEqual([]);
    expect(validateExtractedOffer(base).errors).toEqual([]);
  });

  it('still rejects a percentage that is really out of range', () => {
    expect(validateExtractedOffer({ ...base, discountPercentage: 150 }).errors).toContain('Discount percentage must be between 0 and 100');
  });
});
