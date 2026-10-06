import type { Offer } from '@/lib/types';
import { date } from '@/lib/format';

export const OFFER_TYPE_LABELS: Record<string, string> = {
  percent: '% off',
  fixed: '£ off',
  bogof: '2-for-1',
  free_item: 'Freebie',
  meal_deal: 'Meal deal',
  custom: 'Other',
  free_delivery: 'Free delivery',
  multi_buy: 'Multi-buy',
  collection_discount: 'Collection discount',
  delivery_discount: 'Delivery discount',
};

export const REDEEM_LABELS: Record<string, string> = {
  direct_link: 'Order link',
  code: 'Coupon code',
  phone: 'Call',
  show_in_store: 'Show in store',
};

export const WEEKDAY_LABELS: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

export const REJECT_REASON_LABELS: Record<string, string> = {
  misleading: 'Misleading or unclear',
  banned_content: 'Content we don’t allow',
  link_mismatch: 'Link isn’t your own ordering page',
  discount_too_high: 'Discount looks too high to be genuine',
  duplicate: 'Same offer already listed',
  other: 'Doesn’t meet our offer rules',
};

export const FLAG_LABELS: Record<string, string> = {
  banned_word: 'contains a word we check',
  discount_too_high: 'discount above our limit',
  link_domain_mismatch: 'link isn’t your website or a known ordering provider',
};

export function flagText(flag: string) {
  const [key, word] = flag.split(':');
  return `${FLAG_LABELS[key] ?? key}${word ? ` (“${word}”)` : ''}`;
}

/** "Order link, ongoing", "Code TRUGARLIC, Tuesdays", "Show in store, starts Monday". */
export function offerSummary(offer: Offer): string {
  const how =
    offer.redemptionType === 'code' && offer.code ? `Code ${offer.code}` : REDEEM_LABELS[offer.redemptionType] ?? offer.redemptionType;
  const parts = [how];
  if (offer.eligibleWeekdays?.length && offer.eligibleWeekdays.length < 7) parts.push(offer.eligibleWeekdays.map((d) => WEEKDAY_LABELS[d] ?? d).join(', '));
  if (offer.dailyStartTime && offer.dailyEndTime) parts.push(`${offer.dailyStartTime}–${offer.dailyEndTime}`);
  if (offer.status === 'scheduled' && offer.startsAt) parts.push(`starts ${date(offer.startsAt, { weekday: 'long', day: 'numeric', month: 'short' })}`);
  else if (offer.endsAt) parts.push(`${offer.status === 'expired' ? 'ended' : 'ends'} ${date(offer.endsAt, { day: 'numeric', month: 'short' })}`);
  else parts.push('ongoing');
  return parts.join(', ');
}
