import mongoose, { Model, Types } from 'mongoose';
import { Actor, ActorContext } from '../../src/common/actor-context';
import { DiscountType, OfferStatus, RedemptionType, Role } from '../../src/common/enums';
import { ActorKind, OfferManagedBy, OfferOrigin, OfferVerification } from '../../src/common/scraper.enums';
import { Offer, OfferSchema } from '../../src/schemas/offer.schema';
import { connectTestMongo, disconnectTestMongo, resetTestMongo } from '../helpers/mongo';

const admin: Actor = { kind: ActorKind.ADMIN, userId: new Types.ObjectId().toString(), role: Role.SUPER_ADMIN };
const merchant: Actor = { kind: ActorKind.MERCHANT, userId: new Types.ObjectId().toString(), role: Role.BUSINESS_OWNER };

function baseOffer(overrides: Partial<Offer> = {}) {
  return {
    businessId: new Types.ObjectId(),
    title: '20% off orders over £15',
    discountType: DiscountType.PERCENT,
    value: 20,
    displayLabel: '20% off',
    redemptionType: RedemptionType.DIRECT_LINK,
    status: OfferStatus.PENDING,
    ...overrides,
  };
}

describe('offer lifecycle guard', () => {
  let OfferModel: Model<Offer>;

  beforeAll(async () => {
    await connectTestMongo();
    OfferModel = mongoose.models.Offer ?? mongoose.model(Offer.name, OfferSchema);
    await OfferModel.syncIndexes();
  });
  beforeEach(resetTestMongo);
  afterAll(disconnectTestMongo);

  describe('background actors (worker, crons)', () => {
    it('cannot create a published imported offer', async () => {
      await expect(
        OfferModel.create(baseOffer({ origin: OfferOrigin.SCRAPER, status: OfferStatus.ACTIVE })),
      ).rejects.toThrow(/may not publish an imported offer/);
    });

    it('cannot mark an offer verified', async () => {
      await expect(
        OfferModel.create(baseOffer({ verification: OfferVerification.ADMIN_VERIFIED })),
      ).rejects.toThrow(/may not mark an offer admin_verified/);
    });

    it('cannot publish through a query update', async () => {
      const offer = await OfferModel.create(baseOffer({ origin: OfferOrigin.SCRAPER, status: OfferStatus.DRAFT }));
      await expect(OfferModel.updateOne({ _id: offer._id }, { status: OfferStatus.ACTIVE })).rejects.toThrow(
        /may not publish/,
      );
      await expect(
        OfferModel.findByIdAndUpdate(offer._id, { $set: { verification: OfferVerification.MERCHANT_VERIFIED } }),
      ).rejects.toThrow(/may not mark an offer merchant_verified/);
    });

    it('cannot change who manages an offer', async () => {
      const offer = await ActorContext.run(admin, () =>
        OfferModel.create(baseOffer({ origin: OfferOrigin.SCRAPER, managedBy: OfferManagedBy.SCRAPER })),
      );
      offer.managedBy = OfferManagedBy.MERCHANT;
      await expect(offer.save()).rejects.toThrow(/may not change who manages an offer/);
    });

    it('never modifies merchant-managed offers, except the source-changed flag, counters and expiry', async () => {
      const offer = await ActorContext.run(merchant, () =>
        OfferModel.create(baseOffer({ origin: OfferOrigin.SCRAPER, managedBy: OfferManagedBy.MERCHANT })),
      );

      offer.title = 'Rewritten by a recheck';
      await expect(offer.save()).rejects.toThrow(/may not modify merchant-managed offer fields: title/);

      await OfferModel.updateOne({ _id: offer._id }, { $set: { title: 'Rewritten by a query' } });
      await OfferModel.updateOne({ _id: offer._id }, { $set: { sourceChanged: true }, $inc: { impressions: 3 } });
      await OfferModel.updateMany({ _id: offer._id }, { status: OfferStatus.EXPIRED });

      const stored = await OfferModel.findById(offer._id).lean();
      expect(stored?.title).toBe('20% off orders over £15');
      expect(stored?.sourceChanged).toBe(true);
      expect(stored?.impressions).toBe(3);
      expect(stored?.status).toBe(OfferStatus.EXPIRED);
    });

    it('may still refresh scraper-managed offers', async () => {
      const offer = await ActorContext.run(admin, () =>
        OfferModel.create(
          baseOffer({ origin: OfferOrigin.SCRAPER, managedBy: OfferManagedBy.SCRAPER, status: OfferStatus.ACTIVE }),
        ),
      );
      const checkedAt = new Date();
      await OfferModel.updateOne({ _id: offer._id }, { $set: { lastCheckedAt: checkedAt } });
      const stored = await OfferModel.findById(offer._id).lean();
      expect(stored?.lastCheckedAt?.getTime()).toBe(checkedAt.getTime());
    });
  });

  // Spec §9: a recheck may republish an offer an admin already approved, and nothing else.
  describe('the recheck component', () => {
    const recheck: Actor = { kind: ActorKind.SYSTEM, component: 'recheck' };
    const imported = (status: OfferStatus) =>
      ActorContext.run(admin, () =>
        OfferModel.create(baseOffer({ origin: OfferOrigin.SCRAPER, managedBy: OfferManagedBy.SCRAPER, status, verification: OfferVerification.ADMIN_VERIFIED })),
      );
    const pinned = (id: Types.ObjectId, from: OfferStatus) => ({ _id: id, status: from, origin: OfferOrigin.SCRAPER, managedBy: OfferManagedBy.SCRAPER });

    it('republishes an offer it had hidden, and holds a published one while a revision waits', async () => {
      const hidden = await imported(OfferStatus.POSSIBLY_REMOVED);
      await ActorContext.run(recheck, async () => {
        await OfferModel.updateOne(pinned(hidden._id, OfferStatus.POSSIBLY_REMOVED), { $set: { status: OfferStatus.ACTIVE, absentChecks: 0 } });
      });
      expect((await OfferModel.findById(hidden._id).lean())?.status).toBe(OfferStatus.ACTIVE);

      await ActorContext.run(recheck, async () => {
        await OfferModel.updateOne(pinned(hidden._id, OfferStatus.ACTIVE), { $set: { status: OfferStatus.REVISION_PENDING } });
      });
      expect((await OfferModel.findById(hidden._id).lean())?.status).toBe(OfferStatus.REVISION_PENDING);
    });

    it('cannot publish an offer that was never approved, however the update is written', async () => {
      const draft = await OfferModel.create(baseOffer({ origin: OfferOrigin.SCRAPER, managedBy: OfferManagedBy.SCRAPER, status: OfferStatus.PENDING }));
      // No status pinned in the filter: the update can't prove what it is republishing.
      await expect(
        ActorContext.run(recheck, async () => {
          await OfferModel.updateOne({ _id: draft._id }, { $set: { status: OfferStatus.ACTIVE } });
        }),
      ).rejects.toThrow(/may not publish an imported offer/);
      // Pinned to a status that was never public.
      await expect(
        ActorContext.run(recheck, async () => {
          await OfferModel.updateOne(pinned(draft._id, OfferStatus.PENDING), { $set: { status: OfferStatus.ACTIVE } });
        }),
      ).rejects.toThrow(/may not publish an imported offer/);
      // Hiding an unpublished offer first, to republish it later, is refused too.
      await expect(
        ActorContext.run(recheck, async () => {
          await OfferModel.updateOne(pinned(draft._id, OfferStatus.PENDING), { $set: { status: OfferStatus.POSSIBLY_REMOVED } });
        }),
      ).rejects.toThrow(/may mark only a published offer possibly_removed/);
      await expect(
        ActorContext.run(recheck, async () => {
          const doc = (await OfferModel.findById(draft._id))!;
          doc.status = OfferStatus.POSSIBLY_REMOVED;
          await doc.save();
        }),
      ).rejects.toThrow(/possibly_removed only through a status-pinned update/);
      expect((await OfferModel.findById(draft._id).lean())?.status).toBe(OfferStatus.PENDING);
    });

    it('cannot republish an offer the business has taken over', async () => {
      const merchantOffer = await ActorContext.run(merchant, () =>
        OfferModel.create(baseOffer({ origin: OfferOrigin.SCRAPER, managedBy: OfferManagedBy.MERCHANT, status: OfferStatus.POSSIBLY_REMOVED })),
      );
      await ActorContext.run(recheck, async () => {
        await OfferModel.updateOne(
          { _id: merchantOffer._id, status: OfferStatus.POSSIBLY_REMOVED, origin: OfferOrigin.SCRAPER, managedBy: OfferManagedBy.SCRAPER },
          { $set: { status: OfferStatus.ACTIVE } },
        );
      });
      expect((await OfferModel.findById(merchantOffer._id).lean())?.status).toBe(OfferStatus.POSSIBLY_REMOVED);
    });

    it('cannot verify an offer while republishing it', async () => {
      const hidden = await imported(OfferStatus.POSSIBLY_REMOVED);
      await expect(
        ActorContext.run(recheck, async () => {
          await OfferModel.updateOne(pinned(hidden._id, OfferStatus.POSSIBLY_REMOVED), { $set: { status: OfferStatus.ACTIVE, verification: OfferVerification.ADMIN_VERIFIED } });
        }),
      ).rejects.toThrow(/may not mark an offer admin_verified/);
    });
  });

  describe('human actors', () => {
    it('lets an admin publish and verify an imported offer', async () => {
      const offer = await ActorContext.run(admin, () =>
        OfferModel.create(
          baseOffer({
            origin: OfferOrigin.SCRAPER,
            status: OfferStatus.ACTIVE,
            verification: OfferVerification.ADMIN_VERIFIED,
            managedBy: OfferManagedBy.SCRAPER,
          }),
        ),
      );
      expect(offer.status).toBe(OfferStatus.ACTIVE);
    });

    it('only lets each kind of actor set its own verification', async () => {
      await expect(
        ActorContext.run(merchant, () => OfferModel.create(baseOffer({ verification: OfferVerification.ADMIN_VERIFIED }))),
      ).rejects.toThrow(/merchant may not mark an offer admin_verified/);
      await expect(
        ActorContext.run(admin, () => OfferModel.create(baseOffer({ verification: OfferVerification.MERCHANT_VERIFIED }))),
      ).rejects.toThrow(/admin may not mark an offer merchant_verified/);
      await expect(
        ActorContext.run(merchant, () =>
          OfferModel.create(baseOffer({ verification: OfferVerification.MERCHANT_VERIFIED })),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('dedupe and deletion', () => {
    it('allows only one live offer per business and content fingerprint', async () => {
      const businessId = new Types.ObjectId();
      const fingerprint = 'a'.repeat(64);
      await OfferModel.create(baseOffer({ businessId, contentFingerprint: fingerprint }));
      await expect(OfferModel.create(baseOffer({ businessId, contentFingerprint: fingerprint }))).rejects.toThrow(
        /E11000/,
      );
    });

    it('frees the dedupe slot once an offer expires', async () => {
      const businessId = new Types.ObjectId();
      const fingerprint = 'b'.repeat(64);
      const first = await OfferModel.create(baseOffer({ businessId, contentFingerprint: fingerprint }));
      await OfferModel.updateMany({ _id: first._id }, { status: OfferStatus.EXPIRED });
      expect((await OfferModel.findById(first._id).lean())?.dedupeKey).toBeUndefined();
      await expect(OfferModel.create(baseOffer({ businessId, contentFingerprint: fingerprint }))).resolves.toBeDefined();
    });

    it('never hard-deletes imported offers', async () => {
      const imported = await OfferModel.create(baseOffer({ origin: OfferOrigin.SCRAPER }));
      await OfferModel.create(baseOffer());

      await expect(imported.deleteOne()).rejects.toThrow(/never hard-deleted/);
      await OfferModel.deleteMany({});
      const remaining = await OfferModel.find().lean();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].origin).toBe(OfferOrigin.SCRAPER);
    });
  });
});
