import type { OfferType } from '../../common/scraper.enums';
import { EVIDENCE_LIMITS } from '../scraper.constants';
import type { ExtractedOffer, ExtractionSignals, FieldEvidence, OfferExtraction } from './adapter.types';
import { contentFingerprint } from './content-fingerprint';
import { enforceEvidenceCoverage, evidenceFor } from './evidence';
import { londonDate } from './london-time';
import {
  findBogof,
  findChannel,
  findDates,
  findFixedAmount,
  findFreeDelivery,
  findFreeItem,
  findMealDeal,
  findMinimumOrder,
  findMultiBuy,
  findNewCustomers,
  findPercentage,
  findPricePoint,
  findProducts,
  findPromoCode,
  findPromotionalLanguage,
  findRequiredSpend,
  findTimeWindow,
  findWasNow,
  findWeekdays,
  OFFER_CONTEXT,
} from './offer-patterns';
import { collapse, excerptAround, splitSentences, TextMatch, truncate } from './text';

export interface BlockContext {
  sourceUrl: string;
  pageTitle?: string;
  checkedAt: Date;
  adapterId: string;
  adapterVersion: string;
  extractionMethod: string;
  // Evidence method prefix, e.g. "html" or "jsonld:Offer".
  methodPrefix: string;
  // The page, section or card is about offers; required for meal deals and price points.
  offerContext: boolean;
  heading?: string;
  structuredData?: boolean;
  lastModified?: Date;
}

interface Benefit {
  offerType: OfferType;
  match: TextMatch<unknown>;
  fields: Partial<ExtractedOffer>;
  flags: string[];
  kind: string;
}

const GENERIC_HEADING = /^(?:our\s+|latest\s+|special\s+|current\s+|today'?s\s+|hot\s+|exclusive\s+)?(?:offers?|deals?|promotions?|specials?|discounts?|savings?|news)$/i;
const TERMS_MARKER =
  /\b(?:valid|not\s+valid|only|t\s?&\s?cs?|terms|conditions|excludes?|excluding|exclusions|minimum|min\.?|orders?\s+over|spend|collection|delivery|new\s+customers?|first\s+order|code|until|ends?|expires?|every|per\s+(?:order|customer|table|person)|cannot\s+be\s+(?:combined|used)|in\s+conjunction|while\s+stocks\s+last|subject\s+to)\b/i;
// "Feast" or "bundle" alone names a menu item; these words mark it as a promotion.
const EXPLICIT_PROMO_WORD = /\b(?:deals?|offers?|specials?|save|only|just|now|promo)\b/i;

export function hasBenefit(text: string): boolean {
  return detectBenefits(collapse(text), true).length > 0;
}

// What an offer gives, independent of wording: "20% off all orders" and "Get 20% off online" share one.
export function benefitSignature(text: string): string | null {
  const [benefit] = detectBenefits(collapse(text), true);
  if (!benefit) return null;
  const f = benefit.fields;
  return [benefit.offerType, f.discountPercentage, f.discountAmount, f.promotionalPrice, f.originalPrice].join('|');
}

function detectBenefits(text: string, offerContext: boolean): Benefit[] {
  const found: Benefit[] = [];
  const add = (b: Benefit | null) => {
    if (!b) return;
    const overlaps = found.some(
      (f) => b.match.index < f.match.index + f.match.length && f.match.index < b.match.index + b.match.length,
    );
    if (!overlaps) found.push(b);
  };

  const wasNow = findWasNow(text);
  add(
    wasNow && {
      kind: 'was_now',
      offerType: 'fixed_discount',
      match: wasNow,
      flags: [],
      fields: {
        originalPrice: wasNow.value.original,
        promotionalPrice: wasNow.value.promotional,
        discountAmount: Math.round((wasNow.value.original - wasNow.value.promotional) * 100) / 100,
      },
    },
  );
  const bogof = findBogof(text);
  add(bogof && { kind: 'bogof', offerType: 'buy_one_get_one_free', match: bogof, flags: [], fields: {} });
  const multi = findMultiBuy(text);
  add(
    multi && {
      kind: 'multi_buy',
      offerType: 'multi_buy',
      match: multi,
      flags: multi.value.secondItemPercent ? ['second_item_discount'] : [],
      fields: {
        promotionalPrice: multi.value.price,
        discountPercentage: multi.value.secondItemPercent,
        applicableProducts: multi.value.product ? [multi.value.product] : undefined,
      },
    },
  );
  const freeDelivery = findFreeDelivery(text);
  add(freeDelivery && { kind: 'free_delivery', offerType: 'free_delivery', match: freeDelivery, flags: [], fields: { deliveryEligible: true } });
  const percent = findPercentage(text);
  add(
    percent && {
      kind: 'percentage',
      offerType: 'percentage_discount',
      match: percent,
      flags: percent.value.upTo ? ['variable_discount'] : [],
      fields: { discountPercentage: percent.value.percent },
    },
  );
  const fixed = findFixedAmount(text);
  add(fixed && { kind: 'fixed', offerType: 'fixed_discount', match: fixed, flags: [], fields: { discountAmount: fixed.value } });
  const freeItem = findFreeItem(text);
  add(freeItem && { kind: 'free_item', offerType: 'free_item', match: freeItem, flags: [], fields: { freeItem: freeItem.value } });

  const promoWord = offerContext || EXPLICIT_PROMO_WORD.test(text);
  const meal = findMealDeal(text);
  if (meal?.value.price && (promoWord || /deal/i.test(meal.value.name))) {
    add({ kind: 'meal_deal', offerType: 'meal_deal', match: meal, flags: [], fields: { promotionalPrice: meal.value.price } });
  }
  const pricePoint = findPricePoint(text);
  if (pricePoint && promoWord) {
    add({
      kind: 'price_point',
      offerType: 'custom',
      match: pricePoint,
      flags: ['price_point'],
      fields: { promotionalPrice: pricePoint.value.price, applicableProducts: [pricePoint.value.product] },
    });
  }
  return found.sort((a, b) => a.match.index - b.match.index);
}

function sentenceAt(text: string, index: number): string {
  let offset = 0;
  for (const sentence of splitSentences(text)) {
    const at = text.indexOf(sentence, offset);
    if (at >= 0 && index >= at && index < at + sentence.length) return sentence;
    if (at >= 0) offset = at + sentence.length;
  }
  return text;
}

/**
 * Turns one offer-bearing text block (and the card or section around it) into extracted offers.
 * A block with several distinct benefits yields one offer per benefit, sharing the card's terms.
 */
export function parseOfferBlock(benefitText: string, containerText: string, ctx: BlockContext): OfferExtraction[] {
  const leaf = collapse(benefitText);
  const container = collapse(containerText || benefitText);
  if (!leaf) return [];

  const benefits = detectBenefits(leaf, ctx.offerContext || OFFER_CONTEXT.test(container));
  if (benefits.length === 0) return [];
  const promotional = findPromotionalLanguage(leaf) ?? findPromotionalLanguage(container);

  return benefits.map((benefit) => buildOffer(benefit, leaf, container, ctx, promotional, benefits.length > 1));
}

function buildOffer(
  benefit: Benefit,
  leaf: string,
  container: string,
  ctx: BlockContext,
  promotional: TextMatch<string> | null,
  split: boolean,
): OfferExtraction {
  const method = (name: string) => `${ctx.methodPrefix}:${name}`;
  const evidence: Record<string, FieldEvidence> = {};
  const cite = (field: string, text: string, match: TextMatch<unknown>, name = field) => {
    evidence[field] = evidenceFor(ctx.sourceUrl, excerptAround(text, match.index, match.length), method(name));
  };
  const flags = [...benefit.flags];
  if (split) flags.push('split_from_combined_block');

  const offer: Partial<ExtractedOffer> = { ...benefit.fields, offerType: benefit.offerType };
  cite('offerType', leaf, benefit.match, benefit.kind);
  for (const field of Object.keys(benefit.fields) as (keyof ExtractedOffer)[]) {
    if (offer[field] !== undefined) cite(field, leaf, benefit.match, benefit.kind);
  }

  // Discounts limited to collection or delivery become the channel-specific types (spec §6).
  const benefitSentence = sentenceAt(leaf, benefit.match.index);
  const channelInSentence = findChannel(benefitSentence);
  const channel = findChannel(container);
  if (channel) {
    if (channel.value !== 'delivery') offer.collectionEligible = true;
    if (channel.value !== 'collection') offer.deliveryEligible = true;
    if (channel.value === 'collection' && /\bonly\b|orders?\b|collect/i.test(container)) offer.deliveryEligible = false;
    if (channel.value === 'delivery' && /\bonly\b|orders?\b/i.test(container)) offer.collectionEligible = false;
    cite('collectionEligible', container, channel, 'channel');
    cite('deliveryEligible', container, channel, 'channel');
  }
  if (channelInSentence && (benefit.offerType === 'percentage_discount' || benefit.offerType === 'fixed_discount') && channelInSentence.value !== 'both') {
    offer.offerType = channelInSentence.value === 'collection' ? 'collection_discount' : 'delivery_discount';
    cite('offerType', benefitSentence, { index: benefit.match.index - leaf.indexOf(benefitSentence), length: benefit.match.length, value: null }, `${benefit.kind}+channel`);
  }

  const newCustomers = findNewCustomers(container);
  if (newCustomers) {
    offer.newCustomersOnly = true;
    cite('newCustomersOnly', container, newCustomers, 'new_customers');
  }
  const minimum = findMinimumOrder(container);
  if (minimum) {
    offer.minimumOrder = minimum.value;
    cite('minimumOrder', container, minimum, 'minimum_order');
  } else {
    const spend = findRequiredSpend(container);
    if (spend) {
      offer.requiredSpend = spend.value;
      cite('requiredSpend', container, spend, 'required_spend');
    }
  }
  const code = findPromoCode(container);
  if (code) {
    offer.promoCode = code.value;
    cite('promoCode', container, code, 'promo_code');
  }
  const days = findWeekdays(container);
  if (days) {
    offer.eligibleWeekdays = days.value;
    cite('eligibleWeekdays', container, days, 'weekdays');
  }
  const times = findTimeWindow(container);
  if (times) {
    if (times.value.start) {
      offer.dailyStartTime = times.value.start;
      cite('dailyStartTime', container, times, 'time_window');
    }
    if (times.value.end) {
      offer.dailyEndTime = times.value.end;
      cite('dailyEndTime', container, times, 'time_window');
    }
  }
  const dates = findDates(container, ctx.checkedAt);
  flags.push(...dates.flags);
  if (dates.startDate) {
    offer.startDate = dates.startDate.value;
    cite('startDate', container, dates.startDate, 'start_date');
  }
  if (dates.endDate) {
    offer.endDate = dates.endDate.value;
    cite('endDate', container, dates.endDate, 'end_date');
  }
  if (!offer.applicableProducts) {
    const products = findProducts(benefitSentence);
    if (products) {
      offer.applicableProducts = products.value;
      cite('applicableProducts', benefitSentence, products, 'products');
    }
  }

  const heading = ctx.heading ? collapse(ctx.heading) : undefined;
  const useHeading =
    heading && heading.length <= 60 && !GENERIC_HEADING.test(heading) && !benefitSentence.toLowerCase().includes(heading.toLowerCase());
  offer.title = truncate(useHeading ? `${heading}: ${benefitSentence}` : benefitSentence, 120);
  evidence.title = evidenceFor(ctx.sourceUrl, useHeading ? `${heading} — ${benefitSentence}` : benefitSentence, method('title'));

  const otherSentences = splitSentences(container).filter(
    (s) => s !== benefitSentence && s !== heading && !benefitSentence.includes(s) && !(heading && s.includes(heading)),
  );
  const terms = otherSentences.filter((s) => TERMS_MARKER.test(s));
  if (terms.length) {
    offer.terms = truncate(terms.join(' '), 300);
    evidence.terms = evidenceFor(ctx.sourceUrl, terms.join(' '), method('terms'));
  }
  const description = otherSentences.find((s) => !TERMS_MARKER.test(s) && s.length > 12 && !findPromoCode(s));
  if (description) {
    offer.shortDescription = truncate(description, 200);
    evidence.shortDescription = evidenceFor(ctx.sourceUrl, description, method('description'));
  }

  const today = londonDate(ctx.checkedAt);
  const extracted: ExtractedOffer = {
    ...(offer as ExtractedOffer),
    currency: 'GBP',
    sources: [
      {
        url: ctx.sourceUrl,
        pageTitle: ctx.pageTitle,
        excerpt: container.slice(0, EVIDENCE_LIMITS.excerptMaxChars),
        checkedAt: ctx.checkedAt,
      },
    ],
    evidence,
    extractionMethod: ctx.extractionMethod,
    adapterId: ctx.adapterId,
    adapterVersion: ctx.adapterVersion,
    confidenceScore: 0,
    contentFingerprint: '',
    lastCheckedAt: ctx.checkedAt,
  };
  const { offer: covered, dropped } = enforceEvidenceCoverage(extracted);
  if (dropped.length) flags.push(`evidence_missing:${dropped.join(',')}`);
  covered.contentFingerprint = contentFingerprint(covered);

  const signals: ExtractionSignals = {
    structuredData: !!ctx.structuredData,
    promotionalLanguage: !!promotional,
    benefitParsed: true,
    termsParsed: !!(
      covered.minimumOrder ||
      covered.requiredSpend ||
      covered.newCustomersOnly ||
      covered.eligibleWeekdays?.length ||
      covered.dailyStartTime ||
      covered.dailyEndTime ||
      covered.collectionEligible !== undefined ||
      covered.applicableProducts?.length ||
      covered.terms
    ),
    promoCodeFound: !!covered.promoCode,
    datesIdentified: !!(covered.startDate || covered.endDate),
    aiOnly: false,
    stale: !!dates.oldYearReference || (!!covered.endDate && covered.endDate < today),
    sourceLastModified: ctx.lastModified,
  };
  return { offer: covered, signals, flags, pageUrl: ctx.sourceUrl };
}
