import { OfferManagedBy, OfferOrigin, OfferVerification } from './scraper.enums';

// Extraction internals and stored page excerpts: kept for admins, never sent from public endpoints.
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
] as const;

export const PUBLIC_OFFER_PROJECTION = OFFER_INTERNAL_FIELDS.map((field) => `-${field}`).join(' ');

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

// Spec §2.5: every imported offer says where it came from and when it was last checked.
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
