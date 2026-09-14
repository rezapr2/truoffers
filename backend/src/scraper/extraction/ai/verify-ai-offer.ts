import type { ExtractedOffer, FieldEvidence, OfferExtraction } from '../adapter.types';
import { contentFingerprint } from '../content-fingerprint';
import { enforceEvidenceCoverage, evidenceFor } from '../evidence';
import { isIsoDate, londonDate } from '../london-time';
import { findDates, findPromoCode, findPromotionalLanguage, findTimeWindow } from '../offer-patterns';
import { hasBenefit } from '../offer-text-parser';
import { collapse } from '../text';
import type { AiOffer } from './ai-offer.schema';

export interface AiVerificationContext {
  pageUrl: string;
  pageTitle?: string;
  pageText: string;
  checkedAt: Date;
  model: string;
  adapterId: string;
  adapterVersion: string;
}

export interface AiVerificationResult {
  extraction: OfferExtraction | null;
  dropped: string[];
}

const normalise = (text: string) => collapse(text).toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

const MONEY_FIELDS = ['discountAmount', 'originalPrice', 'promotionalPrice', 'minimumOrder'] as const;

function mentionsNumber(quote: string, value: number, percent = false): boolean {
  const text = normalise(quote);
  const plain = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '');
  const candidates = new Set([plain, value.toFixed(2), String(value)]);
  return [...candidates].some((c) => {
    const escaped = c.replace('.', '\\.');
    return percent ? new RegExp(`(?<![\\d.])${escaped}\\s?%`).test(text) : new RegExp(`(?<![\\d.])${escaped}(?![\\d])`).test(text);
  });
}

/**
 * Spec §6: AI output is only used where the page itself proves it. Every value needs a quote that appears
 * verbatim on the page; dates, prices, promo codes and times must also be re-derivable from that quote.
 */
export function verifyAiOffer(ai: AiOffer, ctx: AiVerificationContext): AiVerificationResult {
  const page = normalise(ctx.pageText);
  const dropped: string[] = [];
  const method = `ai:${ctx.model}`;
  const onPage = (q: string | null | undefined): q is string => !!q && q.trim().length >= 2 && page.includes(normalise(q));

  if (!onPage(ai.evidence.title) || !onPage(ai.evidence.offerType) || !hasBenefit(ai.evidence.title + ' ' + ai.evidence.offerType)) {
    return { extraction: null, dropped: ['offer'] };
  }

  const evidence: Record<string, FieldEvidence> = {
    title: evidenceFor(ctx.pageUrl, ai.evidence.title, method),
    offerType: evidenceFor(ctx.pageUrl, ai.evidence.offerType, method),
  };
  const offer: Partial<ExtractedOffer> = { title: collapse(ai.title).slice(0, 120), offerType: ai.offerType };

  const accept = <K extends keyof AiOffer & keyof ExtractedOffer>(field: K, check: (quote: string) => boolean = () => true) => {
    const value = ai[field];
    if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) return;
    const q = ai.evidence[field as keyof AiOffer['evidence']];
    if (onPage(q) && check(q)) {
      (offer as Record<string, unknown>)[field] = value;
      evidence[field] = evidenceFor(ctx.pageUrl, q, method);
    } else {
      dropped.push(field);
    }
  };

  accept('shortDescription');
  accept('terms');
  accept('discountPercentage', (q) => ai.discountPercentage! > 0 && ai.discountPercentage! <= 100 && mentionsNumber(q, ai.discountPercentage!, true));
  for (const field of MONEY_FIELDS) accept(field, (q) => ai[field]! > 0 && mentionsNumber(q, ai[field]!));
  accept('promoCode', (q) => {
    const code = ai.promoCode!.toUpperCase();
    return normalise(q).includes(code.toLowerCase()) && findPromoCode(q)?.value === code;
  });
  accept('freeItem', (q) => normalise(q).includes(normalise(ai.freeItem!)));
  accept('collectionEligible', (q) => /collect/i.test(q));
  accept('deliveryEligible', (q) => /deliver/i.test(q));
  accept('newCustomersOnly', (q) => /new\s+customer|first\s+(?:online\s+|app\s+)?order|welcome|1st\s+order|first[-\s]time/i.test(q));
  accept('eligibleWeekdays', (q) => ai.eligibleWeekdays!.every((d) => new RegExp(`\\b${d}|week(?:day|end)s?\\b`, 'i').test(q)));
  accept('dailyStartTime', (q) => findTimeWindow(q)?.value.start === ai.dailyStartTime);
  accept('dailyEndTime', (q) => findTimeWindow(q)?.value.end === ai.dailyEndTime);
  accept('startDate', (q) => isIsoDate(ai.startDate!) && findDates(q, ctx.checkedAt).startDate?.value === ai.startDate);
  accept('endDate', (q) => isIsoDate(ai.endDate!) && findDates(q, ctx.checkedAt).endDate?.value === ai.endDate);

  const titleBlock = ai.evidence.title;
  const extracted: ExtractedOffer = {
    ...(offer as ExtractedOffer),
    currency: 'GBP',
    sources: [{ url: ctx.pageUrl, pageTitle: ctx.pageTitle, excerpt: collapse(titleBlock).slice(0, 500), checkedAt: ctx.checkedAt }],
    evidence,
    extractionMethod: 'ai_assisted',
    adapterId: ctx.adapterId,
    adapterVersion: ctx.adapterVersion,
    confidenceScore: 0,
    contentFingerprint: '',
    lastCheckedAt: ctx.checkedAt,
  };
  const { offer: covered, dropped: missing } = enforceEvidenceCoverage(extracted);
  dropped.push(...missing);
  covered.contentFingerprint = contentFingerprint(covered);

  return {
    dropped,
    extraction: {
      offer: covered,
      pageUrl: ctx.pageUrl,
      flags: dropped.length ? [`ai_fields_dropped:${dropped.join(',')}`] : [],
      signals: {
        structuredData: false,
        promotionalLanguage: !!findPromotionalLanguage(ai.evidence.title),
        benefitParsed: true,
        termsParsed: !!(covered.minimumOrder || covered.newCustomersOnly || covered.eligibleWeekdays?.length || covered.terms || covered.collectionEligible !== undefined),
        promoCodeFound: !!covered.promoCode,
        datesIdentified: !!(covered.startDate || covered.endDate),
        aiOnly: true,
        stale: !!covered.endDate && covered.endDate < londonDate(ctx.checkedAt),
      },
    },
  };
}
