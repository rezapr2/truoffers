import type { Types } from 'mongoose';
import { LIVE_OFFER_STATUSES, OfferStatus } from '../../common/enums';
import { OfferManagedBy, OfferOrigin } from '../../common/scraper.enums';
import type { ExtractedOffer, OfferExtraction } from '../extraction/adapter.types';
import { tokenSimilarity } from '../extraction/content-fingerprint';
import type { ComparableOffer } from '../lifecycle/offer-mapping';
import { MATCH_THRESHOLDS } from '../scraper.constants';

export interface ExistingOfferView extends ComparableOffer {
  id: Types.ObjectId;
  contentFingerprint?: string;
  status: OfferStatus;
  origin: OfferOrigin;
  managedBy?: OfferManagedBy;
}

export interface OpenCandidateView {
  id: Types.ObjectId;
  contentFingerprint: string;
}

export type DedupeDecision =
  | { kind: 'refresh_offer'; offerId: Types.ObjectId }
  | { kind: 'merchant_owned'; offerId: Types.ObjectId }
  | { kind: 'suppressed'; offerId: Types.ObjectId; reason: string }
  | { kind: 'merge_candidate'; candidateId: Types.ObjectId }
  | { kind: 'changed_terms'; offerId: Types.ObjectId; diff: Record<string, { previous: unknown; proposed: unknown }> }
  | { kind: 'reappeared'; offerId: Types.ObjectId }
  | { kind: 'new'; previouslyRemovedByAdmin: boolean };

const COMPARED_FIELDS = ['offerType', 'discountPercentage', 'discountAmount', 'promotionalPrice', 'promoCode', 'minimumOrder', 'freeItem', 'endDate'] as const;

export function sameOfferIdentity(a: ComparableOffer, b: ComparableOffer): boolean {
  if (a.promoCode && b.promoCode && a.promoCode.toUpperCase() === b.promoCode.toUpperCase()) return true;
  return a.offerType === b.offerType && tokenSimilarity(a.title, b.title) >= MATCH_THRESHOLDS.sameOfferTitleSimilarity;
}

export function diffOffers(previous: ComparableOffer, proposed: ComparableOffer) {
  const diff: Record<string, { previous: unknown; proposed: unknown }> = {};
  for (const field of COMPARED_FIELDS) {
    const before = previous[field];
    const after = proposed[field];
    if ((before ?? null) !== (after ?? null)) diff[field] = { previous: before ?? null, proposed: after ?? null };
  }
  return diff;
}

/**
 * Spec §9 duplicate handling for one extracted offer against a business's existing offers and the site's
 * open candidates. Never creates a new public offer for something that is already live.
 */
export function dedupeDecision(extracted: ExtractedOffer, existing: ExistingOfferView[], openCandidates: OpenCandidateView[]): DedupeDecision {
  const fingerprint = extracted.contentFingerprint;
  const sameFingerprint = existing.filter((o) => o.contentFingerprint === fingerprint);

  const live = sameFingerprint.find((o) => LIVE_OFFER_STATUSES.includes(o.status));
  if (live) {
    const merchantOwned = live.origin === OfferOrigin.MERCHANT || live.managedBy === OfferManagedBy.MERCHANT;
    return merchantOwned ? { kind: 'merchant_owned', offerId: live.id } : { kind: 'refresh_offer', offerId: live.id };
  }

  const removedByMerchant = sameFingerprint.find(
    (o) => (o.status === OfferStatus.REMOVED || o.status === OfferStatus.REJECTED) && o.managedBy === OfferManagedBy.MERCHANT,
  );
  if (removedByMerchant) return { kind: 'suppressed', offerId: removedByMerchant.id, reason: 'The business removed this offer' };

  const candidate = openCandidates.find((c) => c.contentFingerprint === fingerprint);
  if (candidate) return { kind: 'merge_candidate', candidateId: candidate.id };

  const changed = existing.find((o) => LIVE_OFFER_STATUSES.includes(o.status) && sameOfferIdentity(extracted, o));
  if (changed) return { kind: 'changed_terms', offerId: changed.id, diff: diffOffers(changed, extracted) };

  const expired = sameFingerprint.find((o) => o.status === OfferStatus.EXPIRED);
  if (expired) return { kind: 'reappeared', offerId: expired.id };

  return { kind: 'new', previouslyRemovedByAdmin: sameFingerprint.some((o) => o.status === OfferStatus.REMOVED) };
}

export interface MergedExtraction extends OfferExtraction {
  pageUrls: string[];
  // undefined: applies to every branch
  branchPaths?: string[];
  conflicts: string[];
}

/**
 * Folds a run's extractions: the same offer found on several pages becomes one (consistency across
 * pages), and offers that look the same but disagree on key values are flagged as conflicts.
 */
export function mergeRunExtractions(extractions: OfferExtraction[]): MergedExtraction[] {
  const byFingerprint = new Map<string, MergedExtraction>();
  for (const extraction of extractions) {
    const key = extraction.offer.contentFingerprint;
    const existing = byFingerprint.get(key);
    if (!existing) {
      byFingerprint.set(key, {
        ...extraction,
        pageUrls: [extraction.pageUrl],
        branchPaths: extraction.branchPath ? [extraction.branchPath] : undefined,
        conflicts: [],
      });
      continue;
    }
    // Prefer the structured version's fields and evidence; keep every source.
    const preferIncoming = extraction.signals.structuredData && !existing.signals.structuredData;
    const base = preferIncoming ? extraction : existing;
    const sources = [...existing.offer.sources, ...extraction.offer.sources].filter(
      (s, i, all) => all.findIndex((x) => x.url === s.url) === i,
    );
    const merged: MergedExtraction = {
      ...base,
      offer: { ...base.offer, sources },
      signals: {
        ...base.signals,
        structuredData: existing.signals.structuredData || extraction.signals.structuredData,
        aiOnly: existing.signals.aiOnly && extraction.signals.aiOnly,
      },
      flags: [...new Set([...existing.flags, ...extraction.flags])],
      pageUrls: [...new Set([...existing.pageUrls, extraction.pageUrl])],
      branchPaths:
        existing.branchPaths === undefined || !extraction.branchPath
          ? undefined
          : [...new Set([...existing.branchPaths, extraction.branchPath])],
      conflicts: [],
    };
    byFingerprint.set(key, merged);
  }

  const merged = [...byFingerprint.values()];
  for (let i = 0; i < merged.length; i++) {
    for (let j = i + 1; j < merged.length; j++) {
      const a = merged[i].offer;
      const b = merged[j].offer;
      if (!sameOfferIdentity(a, b)) continue;
      const diff = diffOffers(a, b);
      const keys = Object.keys(diff).filter((k) => k !== 'offerType');
      if (keys.length === 0) continue;
      const describe = keys.map((k) => `${k}: ${diff[k].previous ?? '—'} vs ${diff[k].proposed ?? '—'}`).join('; ');
      merged[i].conflicts.push(`Differs from "${b.title}" (${describe})`);
      merged[j].conflicts.push(`Differs from "${a.title}" (${describe})`);
    }
  }
  return merged;
}
