import { Actor } from '../../common/actor-context';
import { OfferStatus } from '../../common/enums';
import { ActorKind, OfferManagedBy, OfferOrigin } from '../../common/scraper.enums';
import type { OfferDocument } from '../../schemas/offer.schema';

// Spec §9: an imported offer becomes merchant-managed as soon as its merchant edits, confirms or rejects it.
export function takeOverAsMerchant(offer: OfferDocument, actor: Actor): void {
  if (offer.origin !== OfferOrigin.SCRAPER || actor.kind !== ActorKind.MERCHANT) return;
  offer.managedBy = OfferManagedBy.MERCHANT;
  offer.sourceChanged = false;
}

// Matches offers the business has taken over: rechecks may only flag these, never change them.
export const MERCHANT_MANAGED_FILTER = { managedBy: OfferManagedBy.MERCHANT } as const;

// Imported offers are never hard-deleted so dedupe remembers the business removed them.
export function removeAsMerchant(offer: OfferDocument, actor: Actor): void {
  takeOverAsMerchant(offer, actor);
  offer.status = OfferStatus.REMOVED;
  offer.removedAt = new Date();
  offer.removedReason = actor.kind === ActorKind.MERCHANT ? 'Removed by the business' : 'Removed by an administrator';
}
