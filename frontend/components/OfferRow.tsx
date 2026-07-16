'use client';

import Link from 'next/link';
import type { Offer, Business } from '@/lib/types';
import VerifiedBadge from './VerifiedBadge';

export default function OfferRow({ offer }: { offer: Offer }) {
  const business =
    typeof offer.businessId === 'object' ? (offer.businessId as Partial<Business>) : offer.business || {};

  const endsLabel = offer.endsAt
    ? `Ends ${new Date(offer.endsAt).toLocaleDateString('en-GB', { weekday: 'long' })}`
    : offer.maxRedemptions > 0
      ? 'New customers'
      : 'Weekly offer';

  return (
    <div className="bg-card rounded-2xl px-5 py-4 md:px-7 md:py-5 grid grid-cols-[80px_1fr_auto] md:grid-cols-[140px_1fr_auto_auto] gap-4 md:gap-6 items-center hover:shadow-lg transition-shadow">
      <div className="font-display text-lg md:text-2xl font-extrabold text-primary">
        {offer.displayLabel}
      </div>
      <div className="min-w-0">
        <div className="text-[15px] md:text-base font-extrabold truncate">
          {business.name}{' '}
          <VerifiedBadge status={business.verificationStatus} className="text-[12px]" />
        </div>
        <div className="text-[12px] md:text-[13px] font-semibold text-muted truncate">
          {business.town ? `${business.town} ${business.postcodeArea ?? ''}` : ''} · {offer.title}
        </div>
      </div>
      <div className="hidden md:block text-[13px] font-bold text-primary">{endsLabel}</div>
      <Link
        href={`/offer/${offer._id}`}
        className="border-[1.5px] border-ink text-ink text-[13px] md:text-sm font-bold px-4 md:px-5 py-2 md:py-2.5 rounded-full hover:bg-ink hover:text-surface transition-colors whitespace-nowrap"
      >
        View offer
      </Link>
    </div>
  );
}
