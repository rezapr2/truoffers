import { OfferManagedBy, OfferOrigin, OfferVerification } from './scraper.enums';

// Extraction internals, stored page excerpts and moderation workings: kept for admins (and, for some, the
// business), never sent from public endpoints.
export const OFFER_INTERNAL_FIELDS = [
  'sources',
  'evidence',
  'adapterId',
  'adapterVersion',
  'confidenceScore',
  'contentFingerprint',
  'dedupeKey',
  'candidateRef',
  'scrapedWebsiteRef',
  'offerTypeRaw',
  'excerptsRedactedAt',
  'removedReason',
  // Spec "Imported offers look identical to owner offers": where an offer came from stays with admins.
  'origin',
  'verification',
  'managedBy',
  'sourceDomain',
  'lastCheckedAt',
  'sourceChanged',
  'absentChecks',
  'lastSeenAt',
  'recheckStateAt',
  'moderationNote',
  'moderationFlags',
  'rejectReasonCode',
  'approvedBy',
  'approvedAt',
  'submitWhenVerified',
  'expiryWarnedAt',
  'hiddenByReportsAt',
  // Which Foodbell promotion an offer mirrors (src/foodbell)
  'external',
] as const;

export const PUBLIC_OFFER_PROJECTION = OFFER_INTERNAL_FIELDS.map((field) => `-${field}`).join(' ');

// Fields of a business that never leave the API on public pages.
export const BUSINESS_INTERNAL_FIELDS = [
  'members',
  'ownerId',
  'phoneE164',
  'nameNormalized',
  'postcodeCanonical',
  'websiteHost',
  'importSource',
  'stripeCustomerId',
  'suspendedAt',
  'suspensionReason',
  'suspensionReview',
  'mergedInto',
  'disputeClaimId',
  'frozen',
  'reverificationDueAt',
  'reverificationNotifiedAt',
  'source',
  // The Foodbell connection (store id, sync state); the public "Foodbell partner" tag is isFoodbellClient
  'foodbell',
] as const;

export const PUBLIC_BUSINESS_PROJECTION = BUSINESS_INTERNAL_FIELDS.map((field) => `-${field}`).join(' ');

export interface ImportNotice {
  domain: string;
  lastCheckedAt?: Date;
  verification: OfferVerification;
  managedBy?: OfferManagedBy;
}

type ImportableOffer = {
  origin?: OfferOrigin;
  sourceDomain?: string;
  lastCheckedAt?: Date;
  verification?: OfferVerification;
  managedBy?: OfferManagedBy;
};

// For the business's own dashboard and admins: where an imported offer came from and when it was last checked.
export function withImportNotice<T extends ImportableOffer>(offer: T): T & { imported: ImportNotice | null } {
  const imported =
    offer.origin === OfferOrigin.SCRAPER && offer.sourceDomain
      ? {
          domain: offer.sourceDomain,
          lastCheckedAt: offer.lastCheckedAt,
          verification: offer.verification ?? OfferVerification.UNVERIFIED,
          managedBy: offer.managedBy,
        }
      : null;
  return { ...offer, imported };
}

/** Offer link slug: /offer/{id}-{slug}. */
export function offerSlug(title: string, businessName?: string): string {
  return `${title} ${businessName ?? ''}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .slice(0, 80)
    .replace(/-+$/, '');
}
