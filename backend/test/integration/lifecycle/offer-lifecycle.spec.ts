import { Types } from 'mongoose';
import { Actor, ActorContext } from '../../../src/common/actor-context';
import { deriveBusinessIdentity } from '../../../src/common/business-identity';
import { DiscountType, OfferStatus, RedemptionType, Role, VerificationStatus } from '../../../src/common/enums';
import {
  ActorKind,
  AuditAction,
  AuthorisationSource,
  BranchMatchStatus,
  CandidateStatus,
  ConfidenceBand,
  DomainAuthorisationStatus,
  DuplicateKind,
  OfferManagedBy,
  OfferOrigin,
  OfferVerification,
} from '../../../src/common/scraper.enums';
import { AuditService } from '../../../src/scraper/audit/audit.service';
import type { ExtractedOffer } from '../../../src/scraper/extraction/adapter.types';
import { contentFingerprint } from '../../../src/scraper/extraction/content-fingerprint';
import { evidenceFor } from '../../../src/scraper/extraction/evidence';
import { OfferLifecycleService } from '../../../src/scraper/lifecycle/offer-lifecycle.service';
import { OfferLifecycleViolation } from '../../../src/schemas/offer-lifecycle.guard';
import { syncTestIndexes, testModels, TestModels } from '../../helpers/models';
import { connectTestMongo, disconnectTestMongo, resetTestMongo } from '../../helpers/mongo';

const adminId = new Types.ObjectId().toString();
const ownerId = new Types.ObjectId().toString();
const admin: Actor = { kind: ActorKind.ADMIN, userId: adminId, role: Role.SUPPORT_ADMIN };
const owner: Actor = { kind: ActorKind.MERCHANT, userId: ownerId, role: Role.BUSINESS_OWNER };
const stranger: Actor = { kind: ActorKind.MERCHANT, userId: new Types.ObjectId().toString(), role: Role.BUSINESS_OWNER };
const OFFERS_URL = 'https://pizza-palace.test/offers';

describe('offer lifecycle service (spec §9)', () => {
  let models: TestModels;
  let lifecycle: OfferLifecycleService;
  let site: { _id: Types.ObjectId };
  let business: { _id: Types.ObjectId };

  beforeAll(async () => {
    await connectTestMongo();
    models = testModels();
    await syncTestIndexes(models);
    lifecycle = new OfferLifecycleService(
      models.offers as any,
      models.candidates as any,
      models.sites as any,
      models.businesses as any,
      new AuditService(models.audit as any),
      models.revisions as any,
    );
  });
  afterAll(disconnectTestMongo);

  beforeEach(async () => {
    await resetTestMongo();
    business = await models.businesses.create({
      name: 'Pizza Palace',
      slug: 'pizza-palace-leeds',
      postcode: 'LS1 4AP',
      ownerId: new Types.ObjectId(ownerId),
      verificationStatus: VerificationStatus.CLAIMED,
      ...deriveBusinessIdentity({ name: 'Pizza Palace', postcode: 'LS1 4AP' }),
    });
    site = await models.sites.create({
      domain: 'pizza-palace.test',
      registrableDomain: 'pizza-palace.test',
      seedUrl: 'https://pizza-palace.test/',
      authorisationStatus: DomainAuthorisationStatus.AUTHORISED,
      authorisationSource: AuthorisationSource.ADMIN_MANUAL,
      businesses: [{ branchPath: '/', businessRef: business._id, matchStatus: BranchMatchStatus.AUTO_MATCHED, matchSignals: [], suggestions: [] }],
    });
  });

  function candidate(overrides: Record<string, unknown> = {}) {
    const offer: Partial<ExtractedOffer> = {
      title: '20% off orders over £20',
      offerType: 'percentage_discount',
      discountPercentage: 20,
      minimumOrder: 20,
      ...(overrides as Partial<ExtractedOffer>),
    };
    return models.candidates.create({
      runRef: new Types.ObjectId(),
      scrapedWebsiteRef: site._id,
      domain: 'pizza-palace.test',
      branchPaths: ['/'],
      currency: 'GBP',
      sources: [{ url: OFFERS_URL, pageTitle: 'Offers', excerpt: `${offer.title} when you order online.`, checkedAt: new Date() }],
      evidence: {
        title: evidenceFor(OFFERS_URL, String(offer.title), 'html:heading'),
        offerType: evidenceFor(OFFERS_URL, String(offer.title), 'pattern:percentage'),
        discountPercentage: evidenceFor(OFFERS_URL, String(offer.title), 'pattern:percentage'),
        minimumOrder: evidenceFor(OFFERS_URL, String(offer.title), 'pattern:minimum_order'),
      },
      extractionMethod: 'static',
      adapterId: 'generic-html',
      adapterVersion: '1.0.0',
      confidenceScore: 84,
      confidenceBand: ConfidenceBand.REVIEW_RECOMMENDED,
      confidenceSignals: [],
      flags: [],
      conflicts: [],
      lastCheckedAt: new Date(),
      status: CandidateStatus.PENDING_REVIEW,
      contentFingerprint: contentFingerprint(offer as ExtractedOffer),
      ...offer,
      ...overrides,
    });
  }

  it('refuses to publish when no admin or merchant is acting', async () => {
    const pending = await candidate();
    await expect(
      lifecycle.approveCandidate(String(pending._id), { verification: OfferVerification.UNVERIFIED }, { userId: adminId }),
    ).rejects.toBeInstanceOf(OfferLifecycleViolation);
    expect(await models.offers.countDocuments()).toBe(0);
    expect((await models.candidates.findById(pending._id).lean())!.status).toBe(CandidateStatus.PENDING_REVIEW);
  });

  it('publishes an approved candidate once per business and links later identical approvals to it', async () => {
    const first = await candidate();
    const { offerIds } = await ActorContext.run(admin, () =>
      lifecycle.approveCandidate(String(first._id), { verification: OfferVerification.ADMIN_VERIFIED, note: 'Checked the site' }, { userId: adminId }),
    );
    const offer = await models.offers.findById(offerIds[0]).lean();
    expect(offer).toMatchObject({
      status: OfferStatus.ACTIVE,
      origin: OfferOrigin.SCRAPER,
      verification: OfferVerification.ADMIN_VERIFIED,
      managedBy: OfferManagedBy.SCRAPER,
      discountType: DiscountType.PERCENT,
      value: 20,
      minOrder: 20,
      sourceDomain: 'pizza-palace.test',
      dedupeKey: `${business._id}:${first.contentFingerprint}`,
    });
    expect(offer!.sources[0].url).toBe(OFFERS_URL);
    expect((await models.businesses.findById(business._id).lean())!.activeOfferCount).toBe(1);

    const again = await candidate();
    const second = await ActorContext.run(admin, () =>
      lifecycle.approveCandidate(String(again._id), { verification: OfferVerification.UNVERIFIED }, { userId: adminId }),
    );
    expect(second.offerIds.map(String)).toEqual([String(offer!._id)]);
    expect(await models.offers.countDocuments()).toBe(1);

    const audit = await models.audit.find({ action: AuditAction.CANDIDATE_APPROVED }).lean();
    expect(audit).toHaveLength(2);
    expect(audit[0].actor).toMatchObject({ kind: ActorKind.ADMIN, role: Role.SUPPORT_ADMIN });
  });

  it('never approves failed extractions, unresolved branches or updates to live offers', async () => {
    const failed = await candidate({ confidenceScore: 31, confidenceBand: ConfidenceBand.FAILED, status: CandidateStatus.FAILED_EXTRACTION });
    await expect(
      ActorContext.run(admin, () => lifecycle.approveCandidate(String(failed._id), { verification: OfferVerification.UNVERIFIED }, { userId: adminId })),
    ).rejects.toThrow(/cannot be approved/);

    const changed = await candidate({ title: '25% off orders over £20', discountPercentage: 25, duplicate: { kind: DuplicateKind.CHANGED_TERMS, offerRef: new Types.ObjectId() } });
    await expect(
      ActorContext.run(admin, () => lifecycle.approveCandidate(String(changed._id), { verification: OfferVerification.UNVERIFIED }, { userId: adminId })),
    ).rejects.toThrow(/merge it into that offer/);

    await models.sites.updateOne({ _id: site._id }, { $set: { 'businesses.0.matchStatus': BranchMatchStatus.NEEDS_REVIEW } });
    const unresolved = await candidate({ title: 'Free garlic bread over £25', offerType: 'free_item', freeItem: 'garlic bread', discountPercentage: undefined, minimumOrder: 25 });
    await expect(
      ActorContext.run(admin, () => lifecycle.approveCandidate(String(unresolved._id), { verification: OfferVerification.UNVERIFIED }, { userId: adminId })),
    ).rejects.toThrow(/Resolve the business/);
    expect(await models.offers.countDocuments()).toBe(0);
  });

  it('merges changed terms into the live imported offer but not into one the business manages', async () => {
    const original = await candidate();
    const { offerIds } = await ActorContext.run(admin, () =>
      lifecycle.approveCandidate(String(original._id), { verification: OfferVerification.UNVERIFIED }, { userId: adminId }),
    );
    const update = await candidate({
      title: '25% off orders over £20',
      discountPercentage: 25,
      duplicate: { kind: DuplicateKind.CHANGED_TERMS, offerRef: offerIds[0], diff: { discountPercentage: { previous: 20, proposed: 25 } } },
    });
    const merged = await ActorContext.run(admin, () =>
      lifecycle.mergeIntoOffer(String(update._id), { verification: OfferVerification.ADMIN_VERIFIED }, { userId: adminId }),
    );
    expect(merged).toMatchObject({ title: '25% off orders over £20', value: 25, verification: OfferVerification.ADMIN_VERIFIED, status: OfferStatus.ACTIVE });
    expect((await models.candidates.findById(update._id).lean())!.status).toBe(CandidateStatus.MERGED);
    expect(await models.audit.countDocuments({ action: AuditAction.CANDIDATE_MERGED })).toBe(1);

    await ActorContext.run(owner, () => lifecycle.confirmOfferAsMerchant(String(offerIds[0])));
    const later = await candidate({
      title: '30% off orders over £20',
      discountPercentage: 30,
      duplicate: { kind: DuplicateKind.CHANGED_TERMS, offerRef: offerIds[0] },
    });
    await expect(
      ActorContext.run(admin, () => lifecycle.mergeIntoOffer(String(later._id), { verification: OfferVerification.UNVERIFIED }, { userId: adminId })),
    ).rejects.toThrow(/business manages this offer/);
    expect((await models.offers.findById(offerIds[0]).lean())!.value).toBe(25);
  });

  it('folds a duplicate candidate into another open candidate from the same website', async () => {
    const target = await candidate();
    const duplicate = await candidate({ title: '20% off when you spend £20 or more', branchPaths: ['/@LS1 4AP'], sources: [{ url: 'https://pizza-palace.test/', excerpt: '20% off when you spend £20 or more', checkedAt: new Date() }] });
    const result = await ActorContext.run(admin, () => lifecycle.mergeIntoCandidate(String(duplicate._id), String(target._id), { userId: adminId }));
    expect(result.sources.map((s) => s.url)).toEqual([OFFERS_URL, 'https://pizza-palace.test/']);
    expect(result.branchPaths).toEqual(['/', '/@LS1 4AP']);
    expect(await models.candidates.findById(duplicate._id).lean()).toMatchObject({ status: CandidateStatus.MERGED, mergedInto: target._id });
    await expect(
      ActorContext.run(admin, () => lifecycle.mergeIntoCandidate(String(duplicate._id), String(target._id), { userId: adminId })),
    ).rejects.toThrow(/still awaiting review/);
  });

  it('lets only the owning merchant confirm, sending unverified businesses through moderation', async () => {
    const awaiting = await candidate({ status: CandidateStatus.AWAITING_MERCHANT_CONFIRMATION });
    await expect(ActorContext.run(admin, () => lifecycle.confirmCandidateAsMerchant(String(awaiting._id), String(business._id)))).rejects.toThrow(/Only the business/);
    await expect(ActorContext.run(stranger, () => lifecycle.confirmCandidateAsMerchant(String(awaiting._id), String(business._id)))).rejects.toThrow(/do not manage/);

    const offer = await ActorContext.run(owner, () => lifecycle.confirmCandidateAsMerchant(String(awaiting._id), String(business._id)));
    expect(offer).toMatchObject({
      status: OfferStatus.PENDING,
      verification: OfferVerification.MERCHANT_VERIFIED,
      managedBy: OfferManagedBy.MERCHANT,
      origin: OfferOrigin.SCRAPER,
    });
    expect((await models.candidates.findById(awaiting._id).lean())!.status).toBe(CandidateStatus.APPROVED);
  });

  it('marks a published imported offer merchant-verified when its business confirms it', async () => {
    const approved = await candidate();
    const { offerIds } = await ActorContext.run(admin, () =>
      lifecycle.approveCandidate(String(approved._id), { verification: OfferVerification.UNVERIFIED }, { userId: adminId }),
    );
    await expect(ActorContext.run(stranger, () => lifecycle.confirmOfferAsMerchant(String(offerIds[0])))).rejects.toThrow(/do not manage/);
    await models.offers.updateOne({ _id: offerIds[0] }, { $set: { sourceChanged: true } });
    const confirmed = await ActorContext.run(owner, () => lifecycle.confirmOfferAsMerchant(String(offerIds[0])));
    expect(confirmed).toMatchObject({ verification: OfferVerification.MERCHANT_VERIFIED, managedBy: OfferManagedBy.MERCHANT, sourceChanged: false });
  });

  it('removes scraper-managed offers for opted-out sites and redacts every stored excerpt', async () => {
    const approved = await candidate();
    const kept = await candidate({ title: 'Free delivery over £15', offerType: 'free_delivery', discountPercentage: undefined, minimumOrder: 15 });
    const open = await candidate({ title: 'Two for Tuesday', offerType: 'buy_one_get_one_free', discountPercentage: undefined, minimumOrder: undefined });
    const [{ offerIds: removedIds }, { offerIds: keptIds }] = await ActorContext.run(admin, async () => [
      await lifecycle.approveCandidate(String(approved._id), { verification: OfferVerification.UNVERIFIED }, { userId: adminId }),
      await lifecycle.approveCandidate(String(kept._id), { verification: OfferVerification.UNVERIFIED }, { userId: adminId }),
    ]);
    await ActorContext.run(owner, () => lifecycle.confirmOfferAsMerchant(String(keptIds[0])));

    // Runs as whoever filed the request: here a member of the public.
    const result = await ActorContext.run({ kind: ActorKind.PUBLIC }, () => lifecycle.removeImportedOffersForSites([site._id], 'Removal requested'));
    expect(result.removed).toBe(1);

    const removed = await models.offers.findById(removedIds[0]).lean();
    expect(removed).toMatchObject({ status: OfferStatus.REMOVED, removedReason: 'Removal requested' });
    expect(removed!.dedupeKey).toBeUndefined();
    expect(removed!.sources.every((s) => s.excerpt === '')).toBe(true);
    expect(removed!.evidence).toEqual({});
    expect((await models.offers.findById(keptIds[0]).lean())!.status).toBe(OfferStatus.ACTIVE);
    expect(await models.candidates.findById(open._id).lean()).toMatchObject({ status: CandidateStatus.REJECTED });
    const candidates = await models.candidates.find().lean();
    expect(candidates.every((c) => c.excerptsRedactedAt && c.sources.every((s) => s.excerpt === ''))).toBe(true);
    expect((await models.businesses.findById(business._id).lean())!.activeOfferCount).toBe(1);
  });

  it('keeps imported offers when a merchant deletes them through the offers API rules', async () => {
    const approved = await candidate();
    const { offerIds } = await ActorContext.run(admin, () =>
      lifecycle.approveCandidate(String(approved._id), { verification: OfferVerification.UNVERIFIED }, { userId: adminId }),
    );
    // Query deletes silently skip imported offers; document deletes are refused outright.
    await models.offers.deleteMany({});
    expect(await models.offers.countDocuments()).toBe(1);
    const doc = await models.offers.findById(offerIds[0]);
    await expect(doc!.deleteOne()).rejects.toThrow(/never hard-deleted/);
    await models.offers.create({
      businessId: business._id,
      title: 'Merchant offer',
      discountType: DiscountType.FIXED,
      value: 5,
      displayLabel: '£5 off',
      redemptionType: RedemptionType.CODE,
    });
    await models.offers.deleteMany({ origin: OfferOrigin.MERCHANT });
    expect(await models.offers.countDocuments()).toBe(1);
  });
});
