import type { FieldEvidence, LoadedPage, OfferExtraction, PageRole, WebsiteContext } from '../adapter.types';
import { contentFingerprint } from '../content-fingerprint';
import { evidenceFor } from '../evidence';
import { parseOfferBlock } from '../offer-text-parser';
import { truncate } from '../text';
import { branchPathOf } from './generic-html.adapter';

export interface EmbeddedOfferInput {
  page: LoadedPage;
  roles: PageRole[];
  ctx: Pick<WebsiteContext, 'checkedAt'>;
  adapterId: string;
  adapterVersion: string;
  // Offer wording to parse: the platform's own text where it has some.
  headline: string;
  description?: string;
  // What the parser reads for the benefit, when the platform states it as data rather than words
  // (e.g. a deal's price). Defaults to the headline.
  benefitText?: string;
  // Verbatim page data that supports the offer; every field's evidence quotes it.
  sourceText: string;
}

/**
 * An offer read from a platform's embedded page data. The wording is parsed like any offer text, then every
 * field's evidence and the stored excerpt are replaced with the verbatim data the page carries, so each value
 * traces to what is actually on the page (spec §6).
 */
export function embeddedOffer(input: EmbeddedOfferInput): OfferExtraction | null {
  const { page, adapterId, adapterVersion } = input;
  const prefix = `provider:${adapterId}@${adapterVersion}`;
  const container = [input.headline, input.description, input.benefitText].filter(Boolean).join('. ');
  const [parsed] = parseOfferBlock(input.benefitText ?? input.headline, container, {
    sourceUrl: page.finalUrl,
    pageTitle: page.title,
    checkedAt: input.ctx.checkedAt,
    adapterId,
    adapterVersion,
    extractionMethod: 'provider',
    methodPrefix: prefix,
    offerContext: true,
    structuredData: true,
    lastModified: page.lastModified,
  });
  if (!parsed) return null;

  const evidence: Record<string, FieldEvidence> = {};
  for (const field of Object.keys(parsed.offer.evidence)) evidence[field] = evidenceFor(page.finalUrl, input.sourceText, `${prefix}:${field}`);
  evidence.title = evidenceFor(page.finalUrl, input.sourceText, `${prefix}:title`);
  const offer = {
    ...parsed.offer,
    title: truncate(input.headline, 120),
    evidence,
    sources: [{ url: page.finalUrl, pageTitle: page.title, excerpt: truncate(input.sourceText, 500), checkedAt: input.ctx.checkedAt }],
  };
  offer.contentFingerprint = contentFingerprint(offer);
  return {
    ...parsed,
    offer,
    signals: { ...parsed.signals, structuredData: true, promotionalLanguage: true },
    pageUrl: page.finalUrl,
    branchPath: branchPathOf(page, input.roles),
  };
}

// Sets a field the platform's data states directly, with the same verbatim evidence.
export function setEmbeddedField<K extends keyof OfferExtraction['offer']>(
  extraction: OfferExtraction,
  field: K,
  value: OfferExtraction['offer'][K],
  sourceText: string,
  prefix: string,
): void {
  extraction.offer[field] = value;
  extraction.offer.evidence[field as string] = evidenceFor(extraction.pageUrl, sourceText, `${prefix}:${String(field)}`);
  extraction.offer.contentFingerprint = contentFingerprint(extraction.offer);
}
