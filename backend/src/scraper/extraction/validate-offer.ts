import type { ExtractedOffer, OfferValidationResult } from './adapter.types';
import { isIsoDate, londonDate } from './london-time';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_PRICE = 500;

export function validateExtractedOffer(input: ExtractedOffer, checkedAt: Date = input.lastCheckedAt): OfferValidationResult {
  // A field stored as null (an unset one that went through MongoDB as `undefined`) is absent, not a value.
  const offer = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null)) as unknown as ExtractedOffer;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!offer.title?.trim()) errors.push('Missing title');
  if (offer.currency !== 'GBP') errors.push('Only GBP offers are supported');

  const price = (name: string, value: number | undefined) => {
    if (value === undefined) return;
    if (!(value > 0 && value < MAX_PRICE)) errors.push(`${name} must be between £0 and £${MAX_PRICE}`);
  };
  price('Discount amount', offer.discountAmount);
  price('Original price', offer.originalPrice);
  price('Promotional price', offer.promotionalPrice);
  if (offer.discountPercentage !== undefined && !(offer.discountPercentage > 0 && offer.discountPercentage <= 100)) {
    errors.push('Discount percentage must be between 0 and 100');
  }
  if (offer.originalPrice !== undefined && offer.promotionalPrice !== undefined && offer.promotionalPrice >= offer.originalPrice) {
    errors.push('Promotional price must be lower than the original price');
  }
  for (const [name, value] of [['Minimum order', offer.minimumOrder], ['Required spend', offer.requiredSpend]] as const) {
    if (value !== undefined && !(value > 0 && value <= 1000)) errors.push(`${name} must be between £0 and £1000`);
  }

  switch (offer.offerType) {
    case 'percentage_discount':
      if (offer.discountPercentage === undefined) errors.push('Percentage discount without a percentage');
      break;
    case 'fixed_discount':
      if (offer.discountAmount === undefined) errors.push('Fixed discount without an amount');
      break;
    case 'collection_discount':
    case 'delivery_discount':
      if (offer.discountPercentage === undefined && offer.discountAmount === undefined) errors.push('Discount without a value');
      break;
    case 'free_item':
      if (!offer.freeItem) errors.push('Free item offer without an item');
      break;
    case 'meal_deal':
      if (offer.promotionalPrice === undefined) errors.push('Meal deal without a price');
      break;
    case 'custom':
      if (offer.promotionalPrice === undefined && offer.originalPrice === undefined && !offer.terms) {
        errors.push('Custom offer without a price or terms');
      }
      break;
    default:
      break;
  }

  if (offer.promoCode !== undefined && !/^[A-Z0-9][A-Z0-9_-]{2,19}$/.test(offer.promoCode)) errors.push('Malformed promo code');
  for (const [name, value] of [['Start time', offer.dailyStartTime], ['End time', offer.dailyEndTime]] as const) {
    if (value !== undefined && !TIME.test(value)) errors.push(`${name} must be HH:mm`);
  }
  for (const [name, value] of [['Start date', offer.startDate], ['End date', offer.endDate]] as const) {
    if (value !== undefined && !isIsoDate(value)) errors.push(`${name} must be YYYY-MM-DD`);
  }
  if (isIsoDate(offer.startDate) && isIsoDate(offer.endDate) && offer.startDate > offer.endDate) {
    errors.push('Start date is after the end date');
  }
  if (isIsoDate(offer.endDate) && offer.endDate < londonDate(checkedAt)) errors.push('The offer has already ended');

  if (!offer.startDate && !offer.endDate) warnings.push('No dates found; offer treated as ongoing');
  if (!offer.sources?.length) warnings.push('No source recorded');
  return { valid: errors.length === 0, errors, warnings };
}
