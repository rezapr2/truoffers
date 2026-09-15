import { FingerprintMatchCategory, MarkerCategory } from '../../common/scraper.enums';
import { markerKey, SiteMarker } from './markers';

export interface ScoringMarker extends SiteMarker {
  weight?: number;
  required?: boolean;
  negative?: boolean;
}

export interface ScoringFingerprint {
  markers: ScoringMarker[];
  categoryWeights?: Partial<Record<MarkerCategory, number>>;
  thresholds?: { exact: number; high: number; possible: number };
}

// How much each kind of evidence counts. Shared CDN hosts and frameworks say little; attribution and
// asset bundles and structure say a lot.
export const DEFAULT_CATEGORY_WEIGHTS: Record<MarkerCategory, number> = {
  [MarkerCategory.GENERATOR]: 12,
  [MarkerCategory.FOOTER_ATTRIBUTION]: 12,
  [MarkerCategory.FRAMEWORK]: 4,
  [MarkerCategory.SCRIPT]: 14,
  [MarkerCategory.STYLESHEET]: 10,
  [MarkerCategory.ASSET_HOST]: 4,
  [MarkerCategory.CSS_CLASS]: 14,
  [MarkerCategory.ELEMENT_ID]: 6,
  [MarkerCategory.DOM_SKELETON]: 12,
  [MarkerCategory.JSONLD_SHAPE]: 4,
  [MarkerCategory.ROUTE_PATTERN]: 6,
  [MarkerCategory.API_ENDPOINT]: 2,
};

export const DEFAULT_THRESHOLDS = { exact: 95, high: 80, possible: 55 };

// One kind of evidence is never enough: fewer than 3 matched categories caps the score below "possible",
// fewer than 2 caps it far lower. A single shared CDN host can therefore never produce a match.
export const DIVERSITY = { forPossible: 3, capWithoutPossible: 54, atLeast: 2, capBelowAtLeast: 30 };

export interface CategoryBreakdown {
  matched: number;
  total: number;
  fraction: number;
}

export interface FingerprintScore {
  score: number;
  category: FingerprintMatchCategory;
  matchedCategories: MarkerCategory[];
  missingRequired: string[];
  negativeHits: string[];
  breakdown: Partial<Record<MarkerCategory, CategoryBreakdown>>;
}

export type MarkerWeightFn = (marker: SiteMarker) => number;

/**
 * score = 100 × Σ(category weight × matched fraction) / Σ(category weights), over the categories the
 * fingerprint defines. CSS classes are further weighted by rarity across known sites (IDF).
 */
export function scoreFingerprint(fingerprint: ScoringFingerprint, siteMarkers: SiteMarker[], classWeight: MarkerWeightFn = () => 1): FingerprintScore {
  const present = new Set(siteMarkers.map(markerKey));
  const thresholds = fingerprint.thresholds ?? DEFAULT_THRESHOLDS;
  const weights = { ...DEFAULT_CATEGORY_WEIGHTS, ...(fingerprint.categoryWeights ?? {}) };

  const negativeHits = fingerprint.markers.filter((m) => m.negative && present.has(markerKey(m))).map(markerKey);
  const positives = fingerprint.markers.filter((m) => !m.negative);
  const missingRequired = positives.filter((m) => m.required && !present.has(markerKey(m))).map(markerKey);

  const breakdown: Partial<Record<MarkerCategory, CategoryBreakdown>> = {};
  for (const marker of positives) {
    const weight = (marker.weight ?? 1) * (marker.category === MarkerCategory.CSS_CLASS ? classWeight(marker) : 1);
    const entry = (breakdown[marker.category] ??= { matched: 0, total: 0, fraction: 0 });
    entry.total += weight;
    if (present.has(markerKey(marker))) entry.matched += weight;
  }

  let weighted = 0;
  let weightSum = 0;
  const matchedCategories: MarkerCategory[] = [];
  for (const [category, entry] of Object.entries(breakdown) as [MarkerCategory, CategoryBreakdown][]) {
    entry.fraction = entry.total > 0 ? entry.matched / entry.total : 0;
    weighted += weights[category] * entry.fraction;
    weightSum += weights[category];
    if (entry.fraction > 0) matchedCategories.push(category);
  }

  let score = weightSum > 0 ? (100 * weighted) / weightSum : 0;
  if (matchedCategories.length < DIVERSITY.atLeast) score = Math.min(score, DIVERSITY.capBelowAtLeast);
  else if (matchedCategories.length < DIVERSITY.forPossible) score = Math.min(score, DIVERSITY.capWithoutPossible);
  score = Math.round(score * 10) / 10;

  let category = FingerprintMatchCategory.NONE;
  if (negativeHits.length === 0) {
    const requiredMet = missingRequired.length === 0;
    if (requiredMet && score >= thresholds.exact) category = FingerprintMatchCategory.EXACT;
    else if (requiredMet && score >= thresholds.high) category = FingerprintMatchCategory.HIGH_CONFIDENCE;
    else if (score >= thresholds.possible) category = FingerprintMatchCategory.POSSIBLE;
  }
  return { score, category, matchedCategories, missingRequired, negativeHits, breakdown };
}

const RANK: Record<FingerprintMatchCategory, number> = {
  [FingerprintMatchCategory.EXACT]: 3,
  [FingerprintMatchCategory.HIGH_CONFIDENCE]: 2,
  [FingerprintMatchCategory.POSSIBLE]: 1,
  [FingerprintMatchCategory.NONE]: 0,
};

export function categoryAtLeast(actual: FingerprintMatchCategory | undefined, minimum: FingerprintMatchCategory): boolean {
  return RANK[actual ?? FingerprintMatchCategory.NONE] >= RANK[minimum];
}

export function betterMatch<T extends { result: FingerprintScore }>(a: T | null, b: T): T {
  if (!a) return b;
  const rank = RANK[b.result.category] - RANK[a.result.category];
  return rank > 0 || (rank === 0 && b.result.score > a.result.score) ? b : a;
}

// Rarer classes count for more: ln((N+1)/(df+1)) + 1 over the sites whose markers we hold.
export function classRarity(corpus: SiteMarker[][]): MarkerWeightFn {
  const documents = corpus.length;
  const df = new Map<string, number>();
  for (const markers of corpus) {
    for (const value of new Set(markers.filter((m) => m.category === MarkerCategory.CSS_CLASS).map((m) => m.value))) {
      df.set(value, (df.get(value) ?? 0) + 1);
    }
  }
  const max = Math.log(documents + 1) + 1;
  return (marker) => (Math.log((documents + 1) / ((df.get(marker.value) ?? 0) + 1)) + 1) / max;
}
