import { DiscountType, RedemptionType } from '../../common/enums';
import type { OfferType } from '../../common/scraper.enums';
import type { Offer } from '../../schemas/offer.schema';
import type { ExtractedOffer } from '../extraction/adapter.types';
import { contentFingerprint, FingerprintInput } from '../extraction/content-fingerprint';
import { londonDate } from '../extraction/london-time';

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
