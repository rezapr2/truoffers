import { createHash } from 'node:crypto';
import { DiscountType, RedemptionType } from '../common/enums';
import { CreateOfferDto } from '../offers/offers.dto';

/** The snapshot Foodbell sends (services/truoffersSnapshot.js in its backend). */
export interface FoodbellDeal {
  id: string;
  title: string;
  description: string | null;
  kind: 'percent' | 'fixed' | 'free_delivery' | 'free_item' | 'bogof' | 'multi_buy' | 'custom';
  value: number;
  label: string;
  appliesTo: 'order' | 'selected_items';
  minOrder: number;
  code: string | null;
  delivery: boolean;
  collection: boolean;
  days: string[] | null;
  timeFrom: string | null;
  timeTo: string | null;
  startsAt: string | null;
  endsAt: string | null;
  newCustomersOnly: boolean;
  needsAccount: boolean;
  terms: string | null;
}

export interface FoodbellSnapshot {
  generatedAt: string;
  store: {
    id: string;
    name: string;
    description: string | null;
    address: string | null;
    town: string | null;
    postcode: string | null;
    phone: string | null;
    email: string | null;
    orderUrl: string | null;
    domain: string | null;
    logo: string | null;
    delivery: boolean;
    collection: boolean;
    openingHours: Record<string, string> | null;
    socialLinks: { facebook: string | null; instagram: string | null; x: string | null };
  };
  menu: {
    categories: { id: string; name: string; description: string | null }[];
    items: { id: string; name: string; description: string | null; category: string | null; price: number; sizes: { label: string; price: number }[]; mealDeal: boolean; image: string | null; sortOrder: number }[];
  };
  deals: FoodbellDeal[];
  skipped: { id: string; title?: string; reason: string }[];
}

const DAY_NAMES: Record<string, string> = { mon: 'monday', tue: 'tuesday', wed: 'wednesday', thu: 'thursday', fri: 'friday', sat: 'saturday', sun: 'sunday' };
const pounds = (n: number) => (Number.isInteger(n) ? `£${n}` : `£${n.toFixed(2)}`);

/** Foodbell's { mon: "11:00-22:00" | "closed" } as the listing shows hours: { monday: "11:00–22:00" | "Closed" }. */
export function openingHoursFrom(hours: Record<string, string> | null | undefined): Record<string, string> | undefined {
  if (!hours) return undefined;
  const out: Record<string, string> = {};
  for (const [code, value] of Object.entries(hours)) {
    const day = DAY_NAMES[code];
    if (day) out[day] = value === 'closed' ? 'Closed' : value.replace('-', '–');
  }
  return Object.keys(out).length ? out : undefined;
}

const KIND_TO_TYPE: Record<FoodbellDeal['kind'], DiscountType> = {
  percent: DiscountType.PERCENT,
  fixed: DiscountType.FIXED,
  free_delivery: DiscountType.FREE_DELIVERY,
  free_item: DiscountType.FREE_ITEM,
  bogof: DiscountType.BOGOF,
  multi_buy: DiscountType.MULTI_BUY,
  custom: DiscountType.CUSTOM,
};

/** The card label (20 characters at most) for a deal. */
function cardLabel(deal: FoodbellDeal): string {
  switch (deal.kind) {
    case 'percent':
      return `${deal.value}% off`;
    case 'fixed':
      return `${pounds(deal.value)} off`;
    case 'free_delivery':
      return 'Free delivery';
    case 'free_item':
      return 'Free item';
    case 'bogof':
      return '2 for 1';
    case 'multi_buy':
      return deal.value > 0 && deal.label.includes('%') ? `${deal.value}% off 2nd item` : `2nd item ${pounds(deal.value)}`;
    default:
      return deal.label.slice(0, 20);
  }
}

/** A Foodbell deal as the offer the owner would have typed into the offer editor. */
export function dealToOffer(deal: FoodbellDeal, orderUrl: string | null): CreateOfferDto {
  const title = (deal.title?.trim().length ?? 0) >= 4 ? deal.title.trim() : `${deal.label} at checkout`;
  return {
    title: title.slice(0, 120),
    description: deal.description?.slice(0, 600) || undefined,
    discountType: KIND_TO_TYPE[deal.kind] ?? DiscountType.CUSTOM,
    value: deal.value || 0,
    displayLabel: cardLabel(deal).slice(0, 20),
    minOrder: deal.minOrder || 0,
    redemptionType: deal.code ? RedemptionType.CODE : RedemptionType.DIRECT_LINK,
    code: deal.code?.slice(0, 30) || undefined,
    redemptionUrl: orderUrl ?? undefined,
    terms: deal.terms?.slice(0, 600) || undefined,
    collection: deal.collection,
    delivery: deal.delivery,
    newCustomersOnly: deal.newCustomersOnly,
    startsAt: deal.startsAt ?? undefined,
    endsAt: deal.endsAt ?? undefined,
    eligibleWeekdays: deal.days?.length ? deal.days : undefined,
    dailyStartTime: deal.timeFrom && deal.timeTo ? deal.timeFrom : undefined,
    dailyEndTime: deal.timeFrom && deal.timeTo ? deal.timeTo : undefined,
  } as CreateOfferDto;
}

/** Fingerprint of what an offer was last synced from, so an unchanged deal isn't re-submitted. */
export function offerHash(dto: CreateOfferDto): string {
  return createHash('sha256').update(JSON.stringify(dto)).digest('hex').slice(0, 32);
}
