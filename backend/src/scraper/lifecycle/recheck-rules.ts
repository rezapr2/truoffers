import { OfferStatus } from '../../common/enums';
import { OfferManagedBy } from '../../common/scraper.enums';
import { RECHECK } from '../scraper.constants';

export type CheckOutcome = 'seen' | 'absent' | 'inconclusive';

export interface CheckEvidence {
  // Published offers this run found again, with the same or changed terms.
  seenOfferIds: ReadonlySet<string>;
  // Page keys this run fetched and read.
  readPages: ReadonlySet<string>;
  // Page keys that now answer 404 or 410.
  gonePages: ReadonlySet<string>;
}

/**
 * Spec §9: only successful checks count. An offer is absent only when a page it was found on was read in this
 * run without it, or that page no longer exists. If none of its pages could be read, the check says nothing.
 */
export function checkOutcome(offer: { id: string; sourcePages: string[] }, evidence: CheckEvidence): CheckOutcome {
  if (evidence.seenOfferIds.has(offer.id)) return 'seen';
  if (offer.sourcePages.some((page) => evidence.readPages.has(page) || evidence.gonePages.has(page))) return 'absent';
  return 'inconclusive';
}

export interface RecheckState {
  status: OfferStatus;
  managedBy?: OfferManagedBy;
  absentChecks: number;
  hasOpenRevision: boolean;
}

export type RecheckChange =
  | { kind: 'none' }
  // Found again; `status` is set when a hidden offer is republished.
  | { kind: 'seen'; status?: OfferStatus }
  | { kind: 'absent'; status?: OfferStatus; absentChecks: number }
  // Merchant-managed offers are never changed by a recheck; the business is told the source changed.
  | { kind: 'flag_merchant' };

// States a recheck acts on. expiry_review waits for an admin; everything else is closed.
export const RECHECKED_STATUSES = [OfferStatus.ACTIVE, OfferStatus.REVISION_PENDING, OfferStatus.POSSIBLY_REMOVED, OfferStatus.EXPIRY_REVIEW];

export function recheckTransition(state: RecheckState, outcome: CheckOutcome): RecheckChange {
  if (outcome === 'inconclusive' || !RECHECKED_STATUSES.includes(state.status)) return { kind: 'none' };
  if (state.managedBy === OfferManagedBy.MERCHANT) return outcome === 'absent' ? { kind: 'flag_merchant' } : { kind: 'none' };

  if (outcome === 'seen') {
    const published = state.hasOpenRevision ? OfferStatus.REVISION_PENDING : OfferStatus.ACTIVE;
    // possibly_removed -> approved: republished automatically, with its pending revision still pending.
    // approved -> revision_pending when changed terms were found; back to approved once no revision is open.
    if (state.status === OfferStatus.POSSIBLY_REMOVED || ((state.status === OfferStatus.ACTIVE || state.status === OfferStatus.REVISION_PENDING) && state.status !== published)) {
      return { kind: 'seen', status: published };
    }
    return { kind: 'seen' };
  }

  const absentChecks = state.absentChecks + 1;
  switch (state.status) {
    case OfferStatus.ACTIVE:
    case OfferStatus.REVISION_PENDING:
      // approved -> possibly_removed: hidden from the public at once.
      return { kind: 'absent', status: OfferStatus.POSSIBLY_REMOVED, absentChecks };
    case OfferStatus.POSSIBLY_REMOVED:
      // possibly_removed -> expiry_review: absent on two consecutive successful checks.
      return absentChecks >= RECHECK.absentChecksForExpiryReview
        ? { kind: 'absent', status: OfferStatus.EXPIRY_REVIEW, absentChecks }
        : { kind: 'absent', absentChecks };
    default:
      return { kind: 'absent', absentChecks };
  }
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Spec §10: active offers every 24h, offers ending within 48h every 6h, websites with nothing published weekly.
 * A domain or adapter interval replaces the base interval; the ending-soon rule still applies.
 */
export function nextCheckAfterSuccess(now: Date, publishedOffers: { endsAt?: Date | null }[], intervalHours?: number): Date {
  let hours = intervalHours ?? (publishedOffers.length ? RECHECK.activeOfferHours : RECHECK.inactiveHours);
  const soon = now.getTime() + RECHECK.endingSoonWindowHours * HOUR_MS;
  if (publishedOffers.some((o) => o.endsAt && o.endsAt.getTime() > now.getTime() && o.endsAt.getTime() <= soon)) {
    hours = Math.min(hours, RECHECK.endingSoonHours);
  }
  return new Date(now.getTime() + hours * HOUR_MS);
}

// Spec §10: previous errors back off 1h, 4h, 16h, 64h, then weekly.
export function backoffHours(failureCount: number): number {
  if (failureCount < 1) return RECHECK.errorBackoffHours[0];
  return RECHECK.errorBackoffHours[failureCount - 1] ?? RECHECK.maxBackoffHours;
}

export function nextCheckAfterFailure(now: Date, failureCount: number): Date {
  return new Date(now.getTime() + backoffHours(failureCount) * HOUR_MS);
}
