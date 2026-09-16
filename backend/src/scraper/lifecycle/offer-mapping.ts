import { DiscountType, RedemptionType } from '../../common/enums';
import type { OfferType } from '../../common/scraper.enums';
import type { Offer } from '../../schemas/offer.schema';
import type { ExtractedOffer, FieldEvidence } from '../extraction/adapter.types';
import { contentFingerprint, FingerprintInput } from '../extraction/content-fingerprint';
import { londonDate, londonEndOfDay, londonStartOfDay } from '../extraction/london-time';

export const DISCOUNT_TYPE_BY_OFFER_TYPE: Record<OfferType, DiscountType> = {
  percentage_discount: DiscountType.PERCENT,
  fixed_discount: DiscountType.FIXED,
  buy_one_get_one_free: DiscountType.BOGOF,
  multi_buy: DiscountType.MULTI_BUY,
  free_item: DiscountType.FREE_ITEM,
  free_delivery: DiscountType.FREE_DELIVERY,
  meal_deal: DiscountType.MEAL_DEAL,
  collection_discount: DiscountType.COLLECTION_DISCOUNT,
  delivery_discount: DiscountType.DELIVERY_DISCOUNT,
  custom: DiscountType.CUSTOM,
};

const OFFER_TYPE_BY_DISCOUNT_TYPE = Object.fromEntries(
  Object.entries(DISCOUNT_TYPE_BY_OFFER_TYPE).map(([offerType, discountType]) => [discountType, offerType]),
) as Record<DiscountType, OfferType>;

export function offerTypeOf(offer: Pick<Offer, 'discountType'>): OfferType {
  return OFFER_TYPE_BY_DISCOUNT_TYPE[offer.discountType] ?? 'custom';
}

// Short badge label, e.g. "20% off", "£5 off", "2 for 1". The Offer DTO caps this at 20 characters.
export function displayLabelFor(offer: Pick<ExtractedOffer, 'offerType' | 'discountPercentage' | 'discountAmount' | 'promotionalPrice'>): string {
  const money = (v: number) => `£${Number.isInteger(v) ? v : v.toFixed(2)}`;
  const label = (() => {
    switch (offer.offerType) {
      case 'percentage_discount':
        return `${offer.discountPercentage}% off`;
      case 'collection_discount':
        return offer.discountPercentage ? `${offer.discountPercentage}% collect` : `${money(offer.discountAmount ?? 0)} collect`;
      case 'delivery_discount':
        return offer.discountPercentage ? `${offer.discountPercentage}% delivery` : `${money(offer.discountAmount ?? 0)} delivery`;
      case 'fixed_discount':
        return `${money(offer.discountAmount ?? 0)} off`;
      case 'buy_one_get_one_free':
        return '2 for 1';
      case 'multi_buy':
        return offer.promotionalPrice ? `Multi-buy ${money(offer.promotionalPrice)}` : 'Multi-buy';
      case 'free_item':
        return 'Free item';
      case 'free_delivery':
        return 'Free delivery';
      case 'meal_deal':
        return offer.promotionalPrice ? `Deal ${money(offer.promotionalPrice)}` : 'Meal deal';
      default:
        return offer.promotionalPrice ? `Only ${money(offer.promotionalPrice)}` : 'Special offer';
    }
  })();
  return label.slice(0, 20);
}

// The existing Offer.value column: percentage, amount or deal price depending on type.
export function valueFor(offer: Pick<ExtractedOffer, 'discountPercentage' | 'discountAmount' | 'promotionalPrice'>): number {
  return offer.discountPercentage ?? offer.discountAmount ?? offer.promotionalPrice ?? 0;
}

export function redemptionTypeFor(promoCode: string | undefined, business: { orderUrl?: string; website?: string }): RedemptionType {
  if (promoCode) return RedemptionType.CODE;
  if (business.orderUrl || business.website) return RedemptionType.DIRECT_LINK;
  return RedemptionType.SHOW_IN_STORE;
}

type PublishedOfferFields = Pick<
  Offer,
  'discountType' | 'value' | 'code' | 'minOrder' | 'title' | 'applicableProducts' | 'freeItem' | 'promotionalPrice' | 'endsAt'
>;

// Fingerprint inputs for an offer already in the Offer collection (merchant-created or imported).
export function fingerprintInputOf(offer: PublishedOfferFields): FingerprintInput {
  const offerType = offerTypeOf(offer);
  const percentTypes: OfferType[] = ['percentage_discount'];
  const amountTypes: OfferType[] = ['fixed_discount'];
  return {
    offerType,
    title: offer.title,
    discountPercentage: percentTypes.includes(offerType) && offer.value ? offer.value : undefined,
    discountAmount: amountTypes.includes(offerType) && offer.value ? offer.value : undefined,
    promotionalPrice: offer.promotionalPrice,
    freeItem: offer.freeItem,
    promoCode: offer.code || undefined,
    minimumOrder: offer.minOrder ? offer.minOrder : undefined,
    applicableProducts: offer.applicableProducts,
  };
}

export function fingerprintOfPublishedOffer(offer: PublishedOfferFields): string {
  return contentFingerprint(fingerprintInputOf(offer));
}

export interface ComparableOffer {
  offerType: OfferType;
  title: string;
  discountPercentage?: number;
  discountAmount?: number;
  promotionalPrice?: number;
  promoCode?: string;
  minimumOrder?: number;
  freeItem?: string;
  endDate?: string;
}

export function comparableOfPublished(offer: PublishedOfferFields): ComparableOffer {
  const input = fingerprintInputOf(offer);
  return {
    offerType: input.offerType,
    title: input.title,
    discountPercentage: input.discountPercentage,
    discountAmount: input.discountAmount,
    promotionalPrice: input.promotionalPrice,
    promoCode: input.promoCode,
    minimumOrder: input.minimumOrder,
    freeItem: input.freeItem,
    endDate: offer.endsAt ? londonDate(offer.endsAt) : undefined,
  };
}

const DAY_NAMES: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

export function composeTerms(c: Partial<ExtractedOffer>): string | undefined {
  const parts: string[] = [];
  if (c.eligibleWeekdays?.length) parts.push(`Valid ${c.eligibleWeekdays.map((d) => DAY_NAMES[d]).join(', ')}`);
  if (c.dailyStartTime || c.dailyEndTime) parts.push(`${c.dailyStartTime ?? 'opening'}–${c.dailyEndTime ?? 'close'}`);
  if (c.collectionEligible && c.deliveryEligible === false) parts.push('Collection only');
  if (c.deliveryEligible && c.collectionEligible === false) parts.push('Delivery only');
  if (c.newCustomersOnly) parts.push('New customers only');
  if (c.requiredSpend) parts.push(`When you spend £${c.requiredSpend}`);
  if (c.terms) parts.push(c.terms);
  const text = parts.join('. ').replace(/\.\./g, '.');
  return text ? text.slice(0, 600) : undefined;
}

// An extracted offer as a candidate or revision holds it: everything needed to publish it.
export type PublishableOffer = Omit<ExtractedOffer, 'evidence'> & { evidence: Record<string, FieldEvidence>; flags?: string[] };

// The Offer fields an extracted offer publishes as. Shared by approval, merging and applying revisions.
export function publishedFieldsOf(c: PublishableOffer, business: { orderUrl?: string; website?: string }, siteDomain: string) {
  return {
    title: c.title,
    description: c.shortDescription,
    discountType: DISCOUNT_TYPE_BY_OFFER_TYPE[c.offerType],
    offerTypeRaw: c.offerType === 'custom' ? (c.flags?.includes('price_point') ? 'price_point' : 'custom') : undefined,
    value: valueFor(c),
    displayLabel: displayLabelFor(c),
    minOrder: c.minimumOrder ?? 0,
    redemptionType: redemptionTypeFor(c.promoCode, business),
    code: c.promoCode,
    redemptionUrl: business.orderUrl ?? business.website ?? c.sources[0]?.url,
    terms: composeTerms(c),
    collection: c.collectionEligible ?? true,
    delivery: c.deliveryEligible ?? true,
    startsAt: c.startDate ? londonStartOfDay(c.startDate) : undefined,
    endsAt: c.endDate ? londonEndOfDay(c.endDate) : undefined,
    sources: c.sources,
    evidence: c.evidence,
    adapterId: c.adapterId,
    adapterVersion: c.adapterVersion,
    confidenceScore: c.confidenceScore,
    contentFingerprint: c.contentFingerprint,
    lastCheckedAt: c.lastCheckedAt,
    sourceDomain: siteDomain,
    eligibleWeekdays: c.eligibleWeekdays,
    dailyStartTime: c.dailyStartTime,
    dailyEndTime: c.dailyEndTime,
    newCustomersOnly: c.newCustomersOnly,
    freeItem: c.freeItem,
    applicableProducts: c.applicableProducts,
    originalPrice: c.originalPrice,
    promotionalPrice: c.promotionalPrice,
    requiredSpend: c.requiredSpend,
  };
}

// Spec §10: the changes a recheck tracks. Named after Offer fields, compared as published.
export const REVISION_TRACKED_FIELDS = [
  'title',
  'discountType',
  'value',
  'code',
  'minOrder',
  'requiredSpend',
  'terms',
  'applicableProducts',
  'freeItem',
  'originalPrice',
  'promotionalPrice',
  'startsAt',
  'endsAt',
  'eligibleWeekdays',
  'dailyStartTime',
  'dailyEndTime',
  'collection',
  'delivery',
  'newCustomersOnly',
] as const;
export type RevisionTrackedField = (typeof REVISION_TRACKED_FIELDS)[number];
export type RevisionValue = string | number | boolean | string[] | null;
export type RevisionValues = Record<RevisionTrackedField, RevisionValue>;

type TrackedOfferFields = Partial<Pick<Offer, Exclude<RevisionTrackedField, 'startsAt' | 'endsAt'>>> & { startsAt?: Date | null; endsAt?: Date | null };

function normalised(field: RevisionTrackedField, value: unknown): RevisionValue {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return londonDate(value);
  if (Array.isArray(value)) return value.length ? [...value].map(String).sort() : null;
  if ((field === 'minOrder' || field === 'value') && value === 0) return null;
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ');
  return value as RevisionValue;
}

// Tracked values of an offer as published (or as it would be published).
export function revisionValuesOf(offer: TrackedOfferFields): RevisionValues {
  return Object.fromEntries(REVISION_TRACKED_FIELDS.map((field) => [field, normalised(field, offer[field])])) as RevisionValues;
}

export function revisionValuesOfExtraction(extracted: PublishableOffer): RevisionValues {
  return revisionValuesOf(publishedFieldsOf(extracted, {}, ''));
}

export function changedRevisionFields(previous: RevisionValues, proposed: RevisionValues): RevisionTrackedField[] {
  return REVISION_TRACKED_FIELDS.filter((field) => JSON.stringify(previous[field]) !== JSON.stringify(proposed[field]));
}
