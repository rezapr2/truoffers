'use client';

import Link from 'next/link';
import type { Business, Category, Offer } from '@/lib/types';
import VerifiedBadge from './VerifiedBadge';
import ReportOffer from './ReportOffer';
import { offerHref } from '@/lib/offer-url';
import { ArrowRightIcon } from './icons';
import Countdown from './Countdown';

function offerBusiness(offer: Offer): Partial<Business> {
  if (offer.business) return offer.business;
  if (typeof offer.businessId === 'object') return offer.businessId as Partial<Business>;
  return {};
}

/** The cuisine's emoji, when the listing carries one. Otherwise the deal itself is the artwork. */
function emojiFor(business: Partial<Business>): string | null {
  const cats = business.categories;
  if (Array.isArray(cats) && cats.length > 0 && typeof cats[0] === 'object') {
    return (cats as Category[])[0].emoji || null;
  }
  return null;
}

function Stars({ rating }: { rating?: number }) {
  if (!rating) return null;
  const full = Math.round(rating);
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-extrabold text-muted-2">
      <span className="text-star tracking-[-1px]">{'★'.repeat(full)}{'☆'.repeat(Math.max(0, 5 - full))}</span>
      {rating.toFixed(1)}
    </span>
  );
}

/**
 * A limited-time offer. `featured` is the tall middle card of the flash-deal
 * block; the default is the small card that flanks it.
 */
export default function FlashDealCard({
  offer,
  featured = false,
}: {
  offer: Offer;
  featured?: boolean;
}) {
  const business = offerBusiness(offer);
  const emoji = emojiFor(business);
  const rating = business.reviews?.rating;

  if (featured) {
    return (
      <div className="bg-card border border-line rounded-3xl p-6 flex flex-col h-full hover:shadow-lg transition-shadow">
        <div className="relative rounded-2xl bg-sun-soft h-44 flex items-center justify-center px-5 text-center">
          {emoji ? (
            <span className="text-[86px] leading-none select-none" aria-hidden="true">
              {emoji}
            </span>
          ) : (
            <span className="font-display text-[42px] leading-none font-extrabold text-brand-deep">
              {offer.displayLabel}
            </span>
          )}
          {emoji && (
            <span className="absolute top-3 left-3 bg-tomato text-white text-[12px] font-extrabold px-3 py-1.5 rounded-full">
              {offer.displayLabel}
            </span>
          )}
          <span className="absolute bottom-3 left-3 bg-tomato text-white text-[11px] font-extrabold px-2.5 py-1 rounded-full">
            {offer.endsAt ? 'Ending soon' : offer.maxRedemptions > 0 ? `First ${offer.maxRedemptions} customers` : 'Flash deal'}
          </span>
          {offer.promoted && (
            <span className="absolute bottom-3 right-3 bg-ink/75 text-white text-[10.5px] font-extrabold uppercase tracking-wide px-2.5 py-1 rounded-full">Promoted</span>
          )}
          {rating != null && rating > 0 && (
            <span className="absolute top-3 right-3 bg-card rounded-full px-2.5 py-1 text-[12px] font-extrabold shadow-sm">
              <span className="text-star">★</span> {rating.toFixed(1)}
            </span>
          )}
        </div>

        <div className="mt-4 flex items-baseline gap-2">
          <span className="font-display text-lg font-extrabold truncate">{business.name}</span>
          <VerifiedBadge level={business.verificationLevel} className="text-[11px] flex-none" />
        </div>
        <div className="text-[14px] font-bold text-ink-soft mt-1">{offer.title}</div>
        <p className="text-[13px] text-muted mt-2 line-clamp-3 leading-relaxed">
          {offer.description || offer.terms}
        </p>
        <ReportOffer offerId={offer._id} offerTitle={offer.title} className="mt-2 self-start" />

        <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
          <Stars rating={rating} />
          {offer.minOrder > 0 && (
            <span className="text-[12px] font-extrabold text-muted-2">Min order £{offer.minOrder}</span>
          )}
        </div>

        <div className="mt-auto pt-5 flex items-center justify-between gap-3 flex-wrap">
          {offer.endsAt ? (
            <Countdown endsAt={offer.endsAt} size="lg" />
          ) : (
            <span className="text-[12px] font-extrabold text-muted-2">
              {offer.maxRedemptions > 0 ? `First ${offer.maxRedemptions} customers` : 'While it lasts'}
            </span>
          )}
          <Link
            href={offerHref(offer)}
            className="btn-soft text-[13px] font-extrabold px-5 py-2.5 rounded-full inline-flex items-center gap-2"
          >
            View offer
            <ArrowRightIcon className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-line rounded-3xl p-3.5 flex gap-3.5 items-center hover:shadow-lg transition-shadow">
      <div className="relative w-[76px] h-[76px] flex-none rounded-2xl bg-leaf-soft flex items-center justify-center px-1.5 text-center">
        {emoji ? (
          <>
            <span className="text-[34px] leading-none select-none" aria-hidden="true">
              {emoji}
            </span>
            <span className="absolute -top-1.5 -left-1.5 bg-tomato text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full whitespace-nowrap">
              {offer.displayLabel}
            </span>
          </>
        ) : (
          <span className="font-display text-[15px] leading-tight font-extrabold text-brand-deep">
            {offer.displayLabel}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-extrabold truncate">
          {business.name}
          {offer.promoted && <span className="ml-1.5 text-[10px] font-extrabold uppercase tracking-wide text-muted">· Promoted</span>}
        </div>
        <div className="text-[12px] text-muted truncate">{offer.title}</div>
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          <Stars rating={rating} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          {offer.endsAt ? (
            <Countdown endsAt={offer.endsAt} />
          ) : (
            <span className="text-[11.5px] font-extrabold text-muted-2">
              {business.town ?? 'Ongoing'}
            </span>
          )}
          <Link
            href={offerHref(offer)}
            className="bg-brand text-white text-[11.5px] font-extrabold px-3 py-1.5 rounded-full hover:bg-brand-dark transition-colors whitespace-nowrap"
          >
            View
          </Link>
        </div>
      </div>
    </div>
  );
}
