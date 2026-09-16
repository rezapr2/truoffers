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
    retention = new RetentionService(models.candidates as any, models.offers as any, models.jobs as any, models.fingerprints as any, models.adapters as any, models.revisions as any);
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
    expect(result).toEqual({ candidatesRedacted: 1, offersRedacted: 2, revisionsRedacted: 0, staleRunOutputsCleared: 1, fingerprintExamplesRedacted: 0, adapterTestResultsRedacted: 0 });

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

    expect(await retention.run(now)).toEqual({ candidatesRedacted: 0, offersRedacted: 0, revisionsRedacted: 0, staleRunOutputsCleared: 0, fingerprintExamplesRedacted: 0, adapterTestResultsRedacted: 0 });
  });

  describe('adapter builder output', () => {
    const example = (domain: string) => ({
      domain,
      pages: [`https://${domain}/offers`],
      markers: 42,
      offersFound: [{ title: '20% off collection', excerpt: `20% off collection orders over £20 at ${domain}`, pageUrl: `https://${domain}/offers` }],
    });
    const tested = (domain: string) => ({
      domain,
      canHandle: true,
      offers: [
        {
          title: '20% off collection',
          discountPercentage: 20,
          excerpt: '20% off collection orders over £20',
          fields: { discountPercentage: { text: '20% off', method: 'selector:saffron@1:discount' } },
          valid: true,
        },
      ],
      businesses: [{ branchPath: '/', name: 'Saffron Spice', telephone: '+441130000000', address: '1 High Street', postcode: 'LS1 1AA' }],
      errors: [],
    });
    const fingerprint = (key: string, analysedAt: Date) =>
      models.fingerprints.create({ name: key, key, exampleDomains: ['saffron-spice.test', 'lotus-garden.test'], examples: [example('saffron-spice.test'), example('lotus-garden.test')], analysedAt });
    const adapterVersion = (version: string, ranAt: Date) =>
      models.adapters.create({
        key: 'saffron-theme',
        name: 'Saffron Theme',
        type: 'selector',
        version,
        priority: 300,
        status: 'draft',
        isCurrent: version === '1',
        exampleDomains: ['saffron-spice.test', 'lotus-garden.test'],
        testResults: { ranAt, jobId: `job-${version}`, summary: { domains: 2, handled: 2, offers: 2 }, domains: [tested('saffron-spice.test'), tested('lotus-garden.test')] },
      });

    it('removes excerpts and branch contact details 90 days after the analysis or test, keeping counts and outcomes', async () => {
      const oldFingerprint = await fingerprint('saffron-old', new Date(now.getTime() - 91 * DAY));
      const recentFingerprint = await fingerprint('saffron-recent', new Date(now.getTime() - 30 * DAY));
      const oldTest = await adapterVersion('1', new Date(now.getTime() - 91 * DAY));
      const recentTest = await adapterVersion('2', new Date(now.getTime() - 5 * DAY));

      expect(await retention.run(now)).toMatchObject({ fingerprintExamplesRedacted: 1, adapterTestResultsRedacted: 1 });

      const redacted = await models.fingerprints.findById(oldFingerprint._id).lean();
      expect(redacted!.excerptsRedactedAt).toEqual(now);
      expect(redacted!.examples.map((e) => e.offersFound[0])).toEqual([
        { title: '20% off collection', excerpt: '', pageUrl: 'https://saffron-spice.test/offers' },
        { title: '20% off collection', excerpt: '', pageUrl: 'https://lotus-garden.test/offers' },
      ]);
      expect(redacted!.examples[0].markers).toBe(42);
      expect((await models.fingerprints.findById(recentFingerprint._id).lean())!.examples[0].offersFound[0].excerpt).not.toBe('');

      const results = (await models.adapters.findById(oldTest._id).lean())!.testResults as any;
      expect(results.redactedAt).toEqual(now);
      expect(results.summary).toEqual({ domains: 2, handled: 2, offers: 2 });
      expect(results.domains[0].offers[0]).toMatchObject({ title: '20% off collection', discountPercentage: 20, excerpt: '', valid: true });
      expect(results.domains[0].offers[0].fields.discountPercentage).toEqual({ method: 'selector:saffron@1:discount', text: '' });
      expect(results.domains[0].businesses).toEqual([{ branchPath: '/' }]);
      expect(((await models.adapters.findById(recentTest._id).lean())!.testResults as any).domains[0].offers[0].excerpt).not.toBe('');

      expect(await retention.run(now)).toMatchObject({ fingerprintExamplesRedacted: 0, adapterTestResultsRedacted: 0 });
    });

    it('redacts only an opted-out website’s examples straight away', async () => {
      const recent = await fingerprint('saffron', new Date(now.getTime() - DAY));
      const test = await adapterVersion('1', new Date(now.getTime() - DAY));

      expect(await retention.redactTemplateExamplesFor(['saffron-spice.test'])).toEqual({ fingerprintsRedacted: 1, adapterTestsRedacted: 1 });

      const examples = (await models.fingerprints.findById(recent._id).lean())!.examples;
      expect(examples.find((e) => e.domain === 'saffron-spice.test')!.offersFound[0].excerpt).toBe('');
      expect(examples.find((e) => e.domain === 'lotus-garden.test')!.offersFound[0].excerpt).not.toBe('');
      const domains = ((await models.adapters.findById(test._id).lean())!.testResults as any).domains;
      expect(domains[0]).toMatchObject({ domain: 'saffron-spice.test', excerptsRedacted: true, businesses: [{ branchPath: '/' }] });
      expect(domains[1].businesses[0].telephone).toBe('+441130000000');
      // Only nightly retention marks the whole record; the opted-out domain alone doesn't end retention for the rest.
      expect((await models.fingerprints.findById(recent._id).lean())!.excerptsRedactedAt).toBeUndefined();

      expect(await retention.redactTemplateExamplesFor(['saffron-spice.test'])).toEqual({ fingerprintsRedacted: 0, adapterTestsRedacted: 0 });
      expect(await retention.redactTemplateExamplesFor([])).toEqual({ fingerprintsRedacted: 0, adapterTestsRedacted: 0 });
    });
  });
});
