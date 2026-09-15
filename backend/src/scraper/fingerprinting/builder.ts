import { MarkerCategory } from '../../common/scraper.enums';
import { markerKey, SiteMarker } from './markers';
import type { ScoringMarker } from './scoring';

// Traits specific enough that every site of the template must have them.
const REQUIRED_CATEGORIES = new Set([MarkerCategory.GENERATOR, MarkerCategory.FOOTER_ATTRIBUTION]);
const MAX_PER_CATEGORY: Partial<Record<MarkerCategory, number>> = {
  [MarkerCategory.CSS_CLASS]: 40,
  [MarkerCategory.ROUTE_PATTERN]: 15,
  [MarkerCategory.ELEMENT_ID]: 15,
};
const MAX_NEGATIVES = 10;

export interface FingerprintSuggestion {
  markers: ScoringMarker[];
  sharedByAll: number;
  perExample: number[];
}

/**
 * Suggests a fingerprint from two or more example sites: traits every example shares become markers
 * (generator and attribution ones required), and required traits of other templates that none of the
 * examples have become negative markers. An admin reviews and edits the result.
 */
export function suggestFingerprint(examples: SiteMarker[][], otherFingerprints: { markers: ScoringMarker[] }[] = []): FingerprintSuggestion {
  if (examples.length < 2) throw new Error('A fingerprint needs at least two example websites');
  const counts = new Map<string, { marker: SiteMarker; count: number }>();
  for (const markers of examples) {
    for (const marker of new Map(markers.map((m) => [markerKey(m), m])).values()) {
      const entry = counts.get(markerKey(marker)) ?? { marker, count: 0 };
      entry.count += 1;
      counts.set(markerKey(marker), entry);
    }
  }

  const shared = [...counts.values()].filter((e) => e.count === examples.length).map((e) => e.marker);
  const perCategory = new Map<MarkerCategory, number>();
  const markers: ScoringMarker[] = [];
  for (const marker of shared) {
    const used = perCategory.get(marker.category) ?? 0;
    if (used >= (MAX_PER_CATEGORY[marker.category] ?? 10)) continue;
    perCategory.set(marker.category, used + 1);
    markers.push({ ...marker, weight: 1, required: REQUIRED_CATEGORIES.has(marker.category), negative: false });
  }

  const everywhere = new Set(examples.flat().map(markerKey));
  const negatives = new Map<string, ScoringMarker>();
  for (const other of otherFingerprints) {
    for (const marker of other.markers) {
      if (!marker.required || marker.negative || everywhere.has(markerKey(marker))) continue;
      if (negatives.size >= MAX_NEGATIVES) break;
      negatives.set(markerKey(marker), { category: marker.category, value: marker.value, weight: 1, required: false, negative: true });
    }
  }

  return { markers: [...markers, ...negatives.values()], sharedByAll: shared.length, perExample: examples.map((e) => e.length) };
}
