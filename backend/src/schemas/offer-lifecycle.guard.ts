import type { AnyBulkWriteOperation, Query, Schema } from 'mongoose';
import { Actor, ActorContext } from '../common/actor-context';
import { LIVE_OFFER_STATUSES, OfferStatus, PUBLIC_OFFER_STATUSES } from '../common/enums';
import { ActorKind, OfferManagedBy, OfferOrigin, OfferVerification } from '../common/scraper.enums';

export class OfferLifecycleViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfferLifecycleViolation';
  }
}

// Fields a non-human actor (worker, cron, analytics) may still change on a merchant-managed offer.
const BACKGROUND_WRITABLE_ON_MERCHANT_OFFERS = new Set([
  'sourceChanged',
  'impressions',
  'flips',
  'detailViews',
  'orderClicks',
  'redemptionCount',
  'status', // only to expired — checked separately
  'expiredAt',
  'dedupeKey',
  // Added to every update by Mongoose itself (timestamps plugin, version key).
  'updatedAt',
  'createdAt',
  '__v',
]);

type OfferShape = {
  businessId?: unknown;
  status?: OfferStatus;
  origin?: OfferOrigin;
  verification?: OfferVerification;
  managedBy?: OfferManagedBy;
  contentFingerprint?: string;
};

export function computeDedupeKey(offer: OfferShape): string | undefined {
  if (!offer.contentFingerprint || !offer.businessId || !offer.status) return undefined;
  if (!LIVE_OFFER_STATUSES.includes(offer.status)) return undefined;
  return `${String(offer.businessId)}:${offer.contentFingerprint}`;
}

function describe(actor: Actor): string {
  return actor.kind === ActorKind.SYSTEM ? `system (${actor.component})` : actor.kind;
}

function assertVerification(value: unknown, actor: Actor) {
  if (value === undefined || value === OfferVerification.UNVERIFIED) {
    if (!ActorContext.isHuman(actor)) {
      throw new OfferLifecycleViolation(`${describe(actor)} may not change offer verification`);
    }
    return;
  }
  const allowed =
    (value === OfferVerification.ADMIN_VERIFIED && actor.kind === ActorKind.ADMIN) ||
    (value === OfferVerification.MERCHANT_VERIFIED && actor.kind === ActorKind.MERCHANT);
  if (!allowed) {
    throw new OfferLifecycleViolation(`${describe(actor)} may not mark an offer ${String(value)}`);
  }
}

function assertCanPublish(actor: Actor) {
  if (!ActorContext.isHuman(actor)) {
    throw new OfferLifecycleViolation(`${describe(actor)} may not publish an imported offer`);
  }
}

function assertCanChangeManagement(actor: Actor) {
  if (!ActorContext.isHuman(actor)) {
    throw new OfferLifecycleViolation(`${describe(actor)} may not change who manages an offer`);
  }
}

function checkNewOffer(offer: OfferShape, actor: Actor) {
  if (offer.verification && offer.verification !== OfferVerification.UNVERIFIED) {
    assertVerification(offer.verification, actor);
  }
  if (offer.origin === OfferOrigin.SCRAPER && offer.status && PUBLIC_OFFER_STATUSES.includes(offer.status)) {
    assertCanPublish(actor);
  }
  if (offer.managedBy === OfferManagedBy.MERCHANT) assertCanChangeManagement(actor);
}

// Collects the top-level field names an update document writes, with their new values where known.
function updatedFields(update: Record<string, any> | null | undefined): Map<string, unknown> {
  const fields = new Map<string, unknown>();
  if (!update) return fields;
  for (const [key, value] of Object.entries(update)) {
    if (!key.startsWith('$')) {
      fields.set(key.split('.')[0], value);
      continue;
    }
    if (value && typeof value === 'object') {
      for (const [path, v] of Object.entries(value)) {
        const root = path.split('.')[0];
        fields.set(root, key === '$set' || key === '$setOnInsert' ? v : undefined);
      }
    }
  }
  return fields;
}

// Provenance the retention job may clear on any offer; it never touches what the offer says.
const RETENTION_REDACTABLE = new Set(['sources', 'evidence', 'excerptsRedactedAt']);
export const RETENTION_COMPONENT = 'retention';

function checkUpdate(fields: Map<string, unknown>, actor: Actor): { restrictToScraperManaged: boolean } {
  if (fields.has('verification')) assertVerification(fields.get('verification'), actor);
  if (fields.has('managedBy')) assertCanChangeManagement(actor);
  const status = fields.get('status') as OfferStatus | undefined;
  // Query updates can't see the matched documents' origin, so any publish through one needs a human.
  if (status && PUBLIC_OFFER_STATUSES.includes(status)) assertCanPublish(actor);

  if (ActorContext.isHuman(actor)) return { restrictToScraperManaged: false };
  const retention = actor.kind === ActorKind.SYSTEM && actor.component === RETENTION_COMPONENT;
  const touchesMerchantData = [...fields.keys()].some(
    (field) =>
      !(BACKGROUND_WRITABLE_ON_MERCHANT_OFFERS.has(field) || (retention && RETENTION_REDACTABLE.has(field))) ||
      (field === 'status' && fields.get('status') !== OfferStatus.EXPIRED),
  );
  return { restrictToScraperManaged: touchesMerchantData };
}

export function applyOfferLifecycleGuard(schema: Schema) {
  schema.pre('save', function (next) {
    try {
      const actor = ActorContext.current();
      const offer = this as unknown as OfferShape & {
        isNew: boolean;
        isModified(path: string): boolean;
        modifiedPaths(): string[];
        dedupeKey?: string;
      };
      // Only when identity or liveness changes, so saving an unrelated field (a redemption count)
      // never collides with a legacy duplicate that was left without a key.
      if (offer.isNew || offer.isModified('contentFingerprint') || offer.isModified('status') || offer.isModified('businessId')) {
        offer.dedupeKey = computeDedupeKey(offer);
      }

      if (offer.isNew) {
        checkNewOffer(offer, actor);
        return next();
      }
      if (offer.isModified('verification')) assertVerification(offer.verification, actor);
      if (offer.isModified('managedBy')) assertCanChangeManagement(actor);
      if (
        offer.isModified('status') &&
        offer.origin === OfferOrigin.SCRAPER &&
        offer.status &&
        PUBLIC_OFFER_STATUSES.includes(offer.status)
      ) {
        assertCanPublish(actor);
      }
      if (!ActorContext.isHuman(actor) && offer.managedBy === OfferManagedBy.MERCHANT) {
        const blocked = offer
          .modifiedPaths()
          .map((path) => path.split('.')[0])
          .filter((field) => !BACKGROUND_WRITABLE_ON_MERCHANT_OFFERS.has(field));
        if (offer.isModified('status') && offer.status !== OfferStatus.EXPIRED) blocked.push('status');
        if (blocked.length) {
          throw new OfferLifecycleViolation(
            `${describe(actor)} may not modify merchant-managed offer fields: ${[...new Set(blocked)].join(', ')}`,
          );
        }
      }
      next();
    } catch (err) {
      next(err as Error);
    }
  });

  schema.pre(
    ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'],
    { document: false, query: true },
    function (next) {
      try {
        const query = this as Query<unknown, unknown>;
        const actor = ActorContext.current();
        const op = (query as unknown as { op?: string }).op ?? '';
        const update = query.getUpdate() as Record<string, any> | null;
        const fields = op.includes('eplace')
          ? new Map(Object.entries(update ?? {}))
          : updatedFields(update);
        const { restrictToScraperManaged } = checkUpdate(fields, actor);
        if (restrictToScraperManaged) query.where({ managedBy: { $ne: OfferManagedBy.MERCHANT } });

        const status = fields.get('status') as OfferStatus | undefined;
        if (status && !LIVE_OFFER_STATUSES.includes(status) && !op.includes('eplace')) {
          query.setUpdate({ ...(update ?? {}), $unset: { ...(update?.$unset ?? {}), dedupeKey: 1 } });
        }
        next();
      } catch (err) {
        next(err as Error);
      }
    },
  );

  schema.pre('insertMany', function (next, docs: OfferShape | OfferShape[]) {
    try {
      const actor = ActorContext.current();
      for (const doc of Array.isArray(docs) ? docs : [docs]) {
        checkNewOffer(doc, actor);
        (doc as OfferShape & { dedupeKey?: string }).dedupeKey = computeDedupeKey(doc);
      }
      next();
    } catch (err) {
      next(err as Error);
    }
  });

  schema.pre('bulkWrite', function (next, ops: Array<AnyBulkWriteOperation<any>>) {
    try {
      const actor = ActorContext.current();
      for (const op of ops) {
        if ('insertOne' in op) checkNewOffer(op.insertOne.document as OfferShape, actor);
        const update =
          ('updateOne' in op && op.updateOne.update) || ('updateMany' in op && op.updateMany.update);
        if (update && !Array.isArray(update)) {
          if (checkUpdate(updatedFields(update as Record<string, any>), actor).restrictToScraperManaged) {
            throw new OfferLifecycleViolation(`${describe(actor)} may not bulk-modify offers outside the lifecycle service`);
          }
        }
        if ('replaceOne' in op || 'deleteOne' in op || 'deleteMany' in op) {
          throw new OfferLifecycleViolation('Bulk replace or delete of offers is not permitted');
        }
      }
      next();
    } catch (err) {
      next(err as Error);
    }
  });

  // Imported offers are never hard-deleted: dedupe must remember offers that were removed.
  schema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], { document: false, query: true }, function (next) {
    (this as Query<unknown, unknown>).where({ origin: { $ne: OfferOrigin.SCRAPER } });
    next();
  });

  schema.pre('deleteOne', { document: true, query: false }, function (next) {
    if ((this as unknown as OfferShape).origin === OfferOrigin.SCRAPER) {
      return next(new OfferLifecycleViolation('Imported offers are never hard-deleted; set their status to removed'));
    }
    next();
  });
}
