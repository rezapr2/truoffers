import { ConfidenceBand } from '../../common/scraper.enums';
import type { OfferExtraction, OfferValidationResult } from '../extraction/adapter.types';
import { evidenceCoverage } from '../extraction/evidence';
import { CONFIDENCE_THRESHOLDS } from '../scraper.constants';

// Starting weights (sum to 100). Tunable; the band thresholds are fixed by the spec.
export const CONFIDENCE_WEIGHTS = {
  adapterMatched: 10,
  genericAdapterMatched: 5,
  structuredData: 15,
  promotionalLanguage: 10,
  benefitParsed: 15,
  termsParsed: 5,
  promoCode: 5,
  dates: 5,
  businessIdentity: 10,
  addressMatched: 5,
  consistentAcrossPages: 10,
  evidenceCoverage: 10,
} as const;

export const CONFIDENCE_PENALTIES = {
  conflict: -25,
  stale: -15,
} as const;

// Scores these can never exceed, whatever else was found.
export const CONFIDENCE_CAPS = {
  invalid: 39,
  aiOnly: 79,
} as const;

const STALE_SOURCE_MS = 365 * 24 * 60 * 60 * 1000;

export interface ConfidenceInput {
  extraction: OfferExtraction;
  validation: OfferValidationResult;
  // The site's selected adapter is a structured or provider adapter rather than the generic fallback.
  specificAdapter: boolean;
  businessIdentityMatched: boolean;
  addressMatched: boolean;
  seenOnPages: number;
  conflicts: string[];
  corroboratedByStatic: boolean;
  checkedAt: Date;
}

export interface ConfidenceResult {
  score: number;
  band: ConfidenceBand;
  signals: { name: string; points: number }[];
  caps: string[];
}

export function bandFor(score: number): ConfidenceBand {
  if (score >= CONFIDENCE_THRESHOLDS.high) return ConfidenceBand.HIGH;
  if (score >= CONFIDENCE_THRESHOLDS.reviewRecommended) return ConfidenceBand.REVIEW_RECOMMENDED;
  if (score >= CONFIDENCE_THRESHOLDS.manualInvestigation) return ConfidenceBand.MANUAL_INVESTIGATION;
  return ConfidenceBand.FAILED;
}

// Spec §7. Deterministic: the same inputs always produce the same score.
export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const { signals: s, offer } = input.extraction;
  const W = CONFIDENCE_WEIGHTS;
  const signals: { name: string; points: number }[] = [];
  const add = (name: string, points: number, when: boolean) => {
    if (when && points !== 0) signals.push({ name, points });
  };

  if (!s.aiOnly) {
    add('adapter matched', input.specificAdapter ? W.adapterMatched : W.genericAdapterMatched, true);
  }
  add('offer in structured data', W.structuredData, s.structuredData);
  add('clear promotional language', W.promotionalLanguage, s.promotionalLanguage);
  add('discount parsed', W.benefitParsed, s.benefitParsed);
  add('terms parsed', W.termsParsed, s.termsParsed);
  add('promo code found', W.promoCode, s.promoCodeFound);
  add('dates identified', W.dates, s.datesIdentified);
  add('business identity matched', W.businessIdentity, input.businessIdentityMatched);
  add('address/postcode matched', W.addressMatched, input.addressMatched);
  add('consistent across pages', W.consistentAcrossPages, input.seenOnPages >= 2);
  add('evidence coverage', Math.round(W.evidenceCoverage * evidenceCoverage(offer)), true);

  const staleSource = !!s.sourceLastModified && input.checkedAt.getTime() - s.sourceLastModified.getTime() > STALE_SOURCE_MS;
  add('conflicting details', CONFIDENCE_PENALTIES.conflict, input.conflicts.length > 0);
  add('stale', CONFIDENCE_PENALTIES.stale, s.stale || staleSource);

  let score = Math.max(0, Math.min(100, signals.reduce((sum, x) => sum + x.points, 0)));
  const caps: string[] = [];
  if (!input.validation.valid) {
    score = Math.min(score, CONFIDENCE_CAPS.invalid);
    caps.push(`invalid: ${input.validation.errors.join('; ')}`);
  }
  if (s.aiOnly && !input.corroboratedByStatic) {
    score = Math.min(score, CONFIDENCE_CAPS.aiOnly);
    caps.push('AI-only extraction');
  }
  return { score, band: bandFor(score), signals, caps };
}
