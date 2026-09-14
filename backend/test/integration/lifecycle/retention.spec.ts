import { Types } from 'mongoose';
import { ActorContext } from '../../../src/common/actor-context';
import { DiscountType, OfferStatus, RedemptionType, Role } from '../../../src/common/enums';
import {
  ActorKind,
  CandidateStatus,
  ConfidenceBand,
  ImportJobStatus,
  ImportJobType,
  OfferManagedBy,
  OfferOrigin,
  OfferVerification,
} from '../../../src/common/scraper.enums';
import { RetentionService } from '../../../src/scraper/retention/retention.service';
import { syncTestIndexes, testModels, TestModels } from '../../helpers/models';
import { connectTestMongo, disconnectTestMongo, resetTestMongo } from '../../helpers/mongo';

const DAY = 24 * 60 * 60 * 1000;
const merchant = { kind: ActorKind.MERCHANT, userId: new Types.ObjectId().toString(), role: Role.BUSINESS_OWNER } as const;
const admin = { kind: ActorKind.ADMIN, userId: new Types.ObjectId().toString(), role: Role.SUPER_ADMIN } as const;

describe('data retention (docs/data-protection.md)', () => {
  let models: TestModels;
  let retention: RetentionService;
  const now = new Date('2026-09-14T03:00:00Z');
  const source = (excerpt: string) => [{ url: 'https://pizza-palace.test/offers', pageTitle: 'Offers', excerpt, checkedAt: new Date(now.getTime() - 200 * DAY) }];

  beforeAll(async () => {
    await connectTestMongo();
    models = testModels();
    await syncTestIndexes(models);
    retention = new RetentionService(models.candidates as any, models.offers as any, models.jobs as any);
  });
  afterAll(disconnectTestMongo);
  beforeEach(resetTestMongo);

  const candidate = (fields: Record<string, unknown>) =>
    models.candidates.create({
      runRef: new Types.ObjectId(),
      scrapedWebsiteRef: new Types.ObjectId(),
      domain: 'pizza-palace.test',
      branchPaths: ['/'],
      title: 'Two for Tuesday',
      offerType: 'buy_one_get_one_free',
      currency: 'GBP',
      sources: source('Two for Tuesday on all large pizzas'),
      evidence: { title: { sourceUrl: 'https://pizza-palace.test/offers', text: 'Two for Tuesday', method: 'html:heading' } },
      extractionMethod: 'static',
      adapterId: 'generic-html',
      adapterVersion: '1.0.0',
      confidenceScore: 72,
      confidenceBand: ConfidenceBand.REVIEW_RECOMMENDED,
      contentFingerprint: new Types.ObjectId().toString(),
      lastCheckedAt: now,
      ...fields,
    });

  const importedOffer = (actor: typeof admin | typeof merchant, fields: Record<string, unknown>) =>
    ActorContext.run(actor, () =>
      models.offers.create({
        businessId: new Types.ObjectId(),
        title: 'Two for Tuesday',
        discountType: DiscountType.BOGOF,
        displayLabel: '2 for 1',
        redemptionType: RedemptionType.PHONE,
        origin: OfferOrigin.SCRAPER,
        sources: source('Two for Tuesday on all large pizzas'),
        evidence: { title: { text: 'Two for Tuesday' } },
        ...fields,
      }),
    );

  it('redacts excerpts once their retention period ends, and leaves everything else alone', async () => {
    const rejectedLongAgo = await candidate({ status: CandidateStatus.REJECTED, excerptsRedactAfter: new Date(now.getTime() - DAY) });
    const rejectedRecently = await candidate({ status: CandidateStatus.REJECTED, excerptsRedactAfter: new Date(now.getTime() + 30 * DAY), contentFingerprint: 'recent' });
    const open = await candidate({ status: CandidateStatus.PENDING_REVIEW, contentFingerprint: 'open' });

    const expiredLongAgo = await importedOffer(admin, { status: OfferStatus.EXPIRED, expiredAt: new Date(now.getTime() - 91 * DAY), managedBy: OfferManagedBy.SCRAPER });
    const merchantExpired = await importedOffer(merchant, {
      status: OfferStatus.EXPIRED,
      expiredAt: new Date(now.getTime() - 120 * DAY),
      managedBy: OfferManagedBy.MERCHANT,
      verification: OfferVerification.MERCHANT_VERIFIED,
      title: 'Merchant kept this',
    });
    const expiredRecently = await importedOffer(admin, { status: OfferStatus.EXPIRED, expiredAt: new Date(now.getTime() - 10 * DAY), title: 'Recent' });
    const live = await importedOffer(admin, { status: OfferStatus.ACTIVE, title: 'Live' });

    const staleJob = await models.jobs.create({
      runId: new Types.ObjectId(),
      type: ImportJobType.EXTRACT_OFFERS,
      normalisedUrl: 'https://pizza-palace.test/',
      domain: 'pizza-palace.test',
      status: ImportJobStatus.FAILED,
      output: { partial: { pages: 3 } },
    });
    await models.jobs.collection.updateOne({ _id: staleJob._id }, { $set: { updatedAt: new Date(now.getTime() - 8 * DAY) } });

    const result = await retention.run(now);
    expect(result).toEqual({ candidatesRedacted: 1, offersRedacted: 2, staleRunOutputsCleared: 1 });

    const redactedCandidate = await models.candidates.findById(rejectedLongAgo._id).lean();
    expect(redactedCandidate!.sources[0]).toMatchObject({ url: 'https://pizza-palace.test/offers', excerpt: '' });
    expect(redactedCandidate!.evidence).toEqual({});
    expect(redactedCandidate!.title).toBe('Two for Tuesday');
    for (const id of [rejectedRecently._id, open._id]) {
      expect((await models.candidates.findById(id).lean())!.sources[0].excerpt).not.toBe('');
    }

    for (const id of [expiredLongAgo._id, merchantExpired._id]) {
      const offer = await models.offers.findById(id).lean();
      expect(offer!.sources[0].excerpt).toBe('');
      expect(offer!.excerptsRedactedAt).toEqual(now);
    }
    // The merchant's own content is untouched: only the stored page text goes.
    expect((await models.offers.findById(merchantExpired._id).lean())!.title).toBe('Merchant kept this');
    for (const id of [expiredRecently._id, live._id]) {
      expect((await models.offers.findById(id).lean())!.sources[0].excerpt).not.toBe('');
    }
    expect((await models.jobs.findById(staleJob._id).lean())!.output).toBeUndefined();

    expect(await retention.run(now)).toEqual({ candidatesRedacted: 0, offersRedacted: 0, staleRunOutputsCleared: 0 });
  });
});
