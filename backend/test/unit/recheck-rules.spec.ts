import { OfferStatus } from '../../src/common/enums';
import { OfferManagedBy } from '../../src/common/scraper.enums';
import { changedRevisionFields, revisionValuesOf, revisionValuesOfExtraction } from '../../src/scraper/lifecycle/offer-mapping';
import {
  backoffHours,
  checkOutcome,
  nextCheckAfterFailure,
  nextCheckAfterSuccess,
  recheckTransition,
  RecheckState,
} from '../../src/scraper/lifecycle/recheck-rules';

const HOUR = 60 * 60 * 1000;
const scraper = (status: OfferStatus, absentChecks = 0, hasOpenRevision = false): RecheckState => ({ status, managedBy: OfferManagedBy.SCRAPER, absentChecks, hasOpenRevision });

describe('check outcome', () => {
  const evidence = { seenOfferIds: new Set(['seen']), readPages: new Set(['pizza.test/offers']), gonePages: new Set(['pizza.test/old-deals']) };

  it('counts only checks that read a page the offer was on', () => {
    expect(checkOutcome({ id: 'seen', sourcePages: ['pizza.test/elsewhere'] }, evidence)).toBe('seen');
    expect(checkOutcome({ id: 'o1', sourcePages: ['pizza.test/offers'] }, evidence)).toBe('absent');
    expect(checkOutcome({ id: 'o2', sourcePages: ['pizza.test/old-deals'] }, evidence)).toBe('absent');
    // Its page timed out, was over the page cap or blocked by robots.txt this time: no conclusion.
    expect(checkOutcome({ id: 'o3', sourcePages: ['pizza.test/menu'] }, evidence)).toBe('inconclusive');
  });
});

describe('recheck transitions (spec §9)', () => {
  it('approved -> possibly_removed after one successful check without the offer', () => {
    expect(recheckTransition(scraper(OfferStatus.ACTIVE), 'absent')).toEqual({ kind: 'absent', status: OfferStatus.POSSIBLY_REMOVED, absentChecks: 1 });
    expect(recheckTransition(scraper(OfferStatus.REVISION_PENDING), 'absent')).toEqual({ kind: 'absent', status: OfferStatus.POSSIBLY_REMOVED, absentChecks: 1 });
  });

  it('possibly_removed -> approved when the next check finds it, keeping a pending revision pending', () => {
    expect(recheckTransition(scraper(OfferStatus.POSSIBLY_REMOVED, 1), 'seen')).toEqual({ kind: 'seen', status: OfferStatus.ACTIVE });
    expect(recheckTransition(scraper(OfferStatus.POSSIBLY_REMOVED, 1, true), 'seen')).toEqual({ kind: 'seen', status: OfferStatus.REVISION_PENDING });
    expect(recheckTransition(scraper(OfferStatus.ACTIVE), 'seen')).toEqual({ kind: 'seen' });
  });

  it('approved -> revision_pending while a revision is open, and back once it is closed', () => {
    expect(recheckTransition(scraper(OfferStatus.ACTIVE, 0, true), 'seen')).toEqual({ kind: 'seen', status: OfferStatus.REVISION_PENDING });
    expect(recheckTransition(scraper(OfferStatus.REVISION_PENDING, 0, true), 'seen')).toEqual({ kind: 'seen' });
    expect(recheckTransition(scraper(OfferStatus.REVISION_PENDING, 0, false), 'seen')).toEqual({ kind: 'seen', status: OfferStatus.ACTIVE });
  });

  it('possibly_removed -> expiry_review after two consecutive successful checks without it', () => {
    expect(recheckTransition(scraper(OfferStatus.POSSIBLY_REMOVED, 1), 'absent')).toEqual({ kind: 'absent', status: OfferStatus.EXPIRY_REVIEW, absentChecks: 2 });
    // expiry_review waits for an admin, whatever later checks find.
    expect(recheckTransition(scraper(OfferStatus.EXPIRY_REVIEW, 2), 'absent')).toEqual({ kind: 'absent', absentChecks: 3 });
    expect(recheckTransition(scraper(OfferStatus.EXPIRY_REVIEW, 2), 'seen')).toEqual({ kind: 'seen' });
  });

  it('ignores inconclusive checks, so absences must be consecutive successful checks', () => {
    expect(recheckTransition(scraper(OfferStatus.ACTIVE), 'inconclusive')).toEqual({ kind: 'none' });
    expect(recheckTransition(scraper(OfferStatus.POSSIBLY_REMOVED, 1), 'inconclusive')).toEqual({ kind: 'none' });
  });

  it('never changes merchant-managed offers; only flags that the source changed', () => {
    const merchant = { ...scraper(OfferStatus.ACTIVE), managedBy: OfferManagedBy.MERCHANT };
    expect(recheckTransition(merchant, 'absent')).toEqual({ kind: 'flag_merchant' });
    expect(recheckTransition(merchant, 'seen')).toEqual({ kind: 'none' });
  });

  it('leaves closed offers alone', () => {
    for (const status of [OfferStatus.EXPIRED, OfferStatus.REMOVED, OfferStatus.REJECTED, OfferStatus.PENDING]) {
      expect(recheckTransition(scraper(status), 'absent')).toEqual({ kind: 'none' });
    }
  });
});

describe('recheck schedule (spec §10)', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  const hoursUntil = (date: Date) => (date.getTime() - now.getTime()) / HOUR;

  it('checks websites with published offers daily, and daily-or-sooner offers ending within 48h every 6 hours', () => {
    expect(hoursUntil(nextCheckAfterSuccess(now, [{ endsAt: new Date(now.getTime() + 10 * 24 * HOUR) }, { endsAt: null }]))).toBe(24);
    expect(hoursUntil(nextCheckAfterSuccess(now, [{ endsAt: new Date(now.getTime() + 47 * HOUR) }]))).toBe(6);
    expect(hoursUntil(nextCheckAfterSuccess(now, [{ endsAt: new Date(now.getTime() + 49 * HOUR) }]))).toBe(24);
    expect(hoursUntil(nextCheckAfterSuccess(now, [{ endsAt: new Date(now.getTime() - HOUR) }]))).toBe(24);
  });

  it('checks websites with nothing published weekly, and honours a configured interval', () => {
    expect(hoursUntil(nextCheckAfterSuccess(now, []))).toBe(168);
    expect(hoursUntil(nextCheckAfterSuccess(now, [], 72))).toBe(72);
    expect(hoursUntil(nextCheckAfterSuccess(now, [{ endsAt: new Date(now.getTime() + 20 * HOUR) }], 72))).toBe(6);
    expect(hoursUntil(nextCheckAfterSuccess(now, [{ endsAt: new Date(now.getTime() + 20 * HOUR) }], 2))).toBe(2);
  });

  it('backs off after errors: 1h, 4h, 16h, 64h, then weekly', () => {
    expect([1, 2, 3, 4, 5, 9].map(backoffHours)).toEqual([1, 4, 16, 64, 168, 168]);
    expect(hoursUntil(nextCheckAfterFailure(now, 3))).toBe(16);
  });
});

describe('revision change tracking (spec §10)', () => {
  const published = {
    title: '20% off collection',
    discountType: 'percent',
    value: 20,
    code: 'SAVE20',
    minOrder: 15,
    terms: 'Valid Mon, Tue. Collection only',
    collection: true,
    delivery: false,
    eligibleWeekdays: ['tue', 'mon'],
    endsAt: new Date('2030-12-31T23:59:59.999Z'),
  } as const;
  const extracted = {
    title: '20% off collection',
    offerType: 'percentage_discount',
    discountPercentage: 25,
    promoCode: 'SAVE20',
    minimumOrder: 15,
    collectionEligible: true,
    deliveryEligible: false,
    eligibleWeekdays: ['mon', 'tue'],
    endDate: '2031-01-31',
    currency: 'GBP',
    sources: [],
    evidence: {},
    extractionMethod: 'static',
    adapterId: 'generic-html',
    adapterVersion: '1.0.0',
    confidenceScore: 80,
    contentFingerprint: 'x',
    lastCheckedAt: new Date(),
  } as const;

  it('compares offers as they are published and names the changed fields', () => {
    const previous = revisionValuesOf(published as never);
    const proposed = revisionValuesOfExtraction(extracted as never);
    expect(changedRevisionFields(previous, proposed)).toEqual(['value', 'endsAt']);
    expect(changedRevisionFields(previous, previous)).toEqual([]);
  });
});
