import Link from 'next/link';
import type { Business, Category, Offer } from '@/lib/types';
import VerifiedBadge from './VerifiedBadge';
import { ArrowRightIcon, ClockIcon, PinIcon } from './icons';
import { endsLabel as formatEnds } from '@/lib/dates';

// Warm tiles behind the headline, cycled by position so a row never repeats itself
const TILES = [
  'bg-sun-soft',
  'bg-leaf-soft',
  'bg-tomato-soft/60',
  'bg-tint-peach',
];

function offerBusiness(offer: Offer): Partial<Business> {
  if (offer.business) return offer.business;
  if (typeof offer.businessId === 'object') return offer.businessId as Partial<Business>;
  return {};
}

/** The cuisine names on a business, e.g. "Pizza · Italian". */
export function cuisineLabel(business: Partial<Business>): string {
  const cats = business.categories;
  if (!Array.isArray(cats) || cats.length === 0 || typeof cats[0] !== 'object') return '';
  return (cats as Category[]).map((c) => c.name).join(' · ');
}

/**
 * A menu-style card for one offer: the deal on a warm tile, then who is offering
 * it, how long it runs and a round button through to the offer.
 */
export default function OfferCard({ offer, index = 0 }: { offer: Offer; index?: number }) {
  const business = offerBusiness(offer);
  const rating = business.reviews?.rating;
  const cuisine = cuisineLabel(business);
  const ends = offer.endsAt
    ? formatEnds(offer.endsAt)
    : offer.maxRedemptions > 0
      ? `First ${offer.maxRedemptions}`
      : 'Ongoing';

  return (
    <div className="group bg-card border border-line rounded-3xl p-3 flex flex-col hover:shadow-lg transition-shadow">
      <div
        className={`relative h-36 rounded-2xl flex items-center justify-center px-4 text-center ${TILES[index % TILES.length]}`}
      >
        <span className="font-display text-[34px] leading-none font-extrabold text-brand-deep">
          {offer.displayLabel}
        </span>
        {rating != null && rating > 0 && (
          <span className="absolute top-2.5 right-2.5 bg-card rounded-full px-2.5 py-1 text-[12px] font-extrabold inline-flex items-center gap-1 shadow-sm">
            <span className="text-star">★</span>
            {rating.toFixed(1)}
          </span>
        )}
        {(offer.delivery || offer.collection) && (
          <span className="absolute bottom-2.5 left-2.5 bg-card/85 rounded-full px-2.5 py-1 text-[11px] font-extrabold text-ink-soft">
            {offer.delivery && offer.collection
              ? 'Delivery & collection'
              : offer.delivery
                ? 'Delivery'
                : 'Collection'}
          </span>
        )}
      </div>

      <div className="pt-3.5 px-1.5 pb-1 flex-1 flex flex-col">
        <div className="flex items-baseline gap-2">
          <Link
            href={business.slug ? `/takeaway/${business.slug}` : `/offer/${offer._id}`}
            className="font-display font-extrabold text-[16px] leading-snug truncate hover:text-primary transition-colors"
          >
            {business.name}
          </Link>
          <VerifiedBadge status={business.verificationStatus} className="text-[11px] flex-none" />
        </div>
        <div className="text-[12.5px] text-muted mt-0.5 truncate">{cuisine || offer.title}</div>

        <div className="flex items-center gap-3 mt-2.5 text-[12px] font-bold text-muted-2">
          <span className="inline-flex items-center gap-1.5">
            <ClockIcon className="w-3.5 h-3.5" />
            {ends}
          </span>
          {business.town && (
            <span className="inline-flex items-center gap-1.5 truncate">
              <PinIcon className="w-3.5 h-3.5 flex-none" />
              {business.town}
            </span>
          )}
        </div>

        <div className="mt-auto pt-3.5 flex items-center justify-between gap-2">
          <span className="text-[13px] font-extrabold text-primary truncate">
            {offer.minOrder > 0 ? `Min order £${offer.minOrder}` : 'View offer'}
          </span>
          <Link
            href={`/offer/${offer._id}`}
            aria-label={`View ${offer.title}`}
            className="w-9 h-9 flex-none rounded-full bg-brand text-white flex items-center justify-center group-hover:translate-x-0.5 transition-transform"
          >
            <ArrowRightIcon className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
