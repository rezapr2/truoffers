import { EVIDENCE_LIMITS } from '../scraper.constants';
import { EVIDENCED_OFFER_FIELDS, ExtractedOffer, FieldEvidence } from './adapter.types';
import { collapse } from './text';

export function evidenceFor(sourceUrl: string, text: string, method: string): FieldEvidence {
  return { sourceUrl, text: collapse(text).slice(0, EVIDENCE_LIMITS.excerptMaxChars), method };
}

function isPopulated(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

// Spec §6: every populated field must trace to evidence. Fields without it are removed.
export function enforceEvidenceCoverage(offer: ExtractedOffer): { offer: ExtractedOffer; dropped: string[] } {
  const dropped: string[] = [];
  const result = { ...offer, evidence: { ...offer.evidence } } as ExtractedOffer & Record<string, unknown>;
  for (const field of EVIDENCED_OFFER_FIELDS) {
    if (!isPopulated(result[field])) {
      delete result.evidence[field];
      continue;
    }
    const entry = result.evidence[field];
    if (!entry?.text?.trim() || !entry.sourceUrl || !entry.method) {
      if (field === 'title' || field === 'offerType') continue; // required: reported by validation instead
      delete result[field];
      delete result.evidence[field];
      dropped.push(field);
    }
  }
  return { offer: result, dropped };
}

export function evidenceCoverage(offer: ExtractedOffer): number {
  const record = offer as ExtractedOffer & Record<string, unknown>;
  const populated = EVIDENCED_OFFER_FIELDS.filter((f) => isPopulated(record[f]));
  if (populated.length === 0) return 0;
  return populated.filter((f) => offer.evidence[f]?.text?.trim()).length / populated.length;
}
