'use client';

import Link from 'next/link';
import type { Business } from '@/lib/types';
import FollowButton from './FollowButton';
import VerifiedBadge from './VerifiedBadge';

export default function BusinessCard({ business }: { business: Business }) {
  return (
    <div className="bg-card rounded-2xl p-6 flex gap-4 items-center hover:shadow-lg transition-shadow">
      <div className="w-16 h-16 flex-none rounded-full bg-page flex items-center justify-center font-display font-extrabold text-xl text-primary">
        {business.name.charAt(0)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <Link
            href={`/takeaway/${business.slug}`}
            className="text-[17px] font-extrabold text-ink hover:text-primary transition-colors truncate"
          >
            {business.name}
          </Link>
          <FollowButton businessId={business._id} />
        </div>
        <div className="text-[13px] font-semibold text-muted truncate">
          {Array.isArray(business.categories) &&
          business.categories.length > 0 &&
          typeof business.categories[0] === 'object'
            ? (business.categories as { name: string }[]).map((c) => c.name).join(', ')
            : ''}
          {business.town ? ` · ${business.town} ${business.postcodeArea ?? ''}` : ''}
          {business.distanceMiles != null ? ` · ${business.distanceMiles} mi` : ''}
        </div>
        <div className="flex gap-2.5 mt-1.5 text-[13px] font-bold flex-wrap">
          {business.reviews?.rating > 0 && (
            <span className="text-star">★ {business.reviews.rating.toFixed(1)}</span>
          )}
          <VerifiedBadge status={business.verificationStatus} />
          {business.activeOfferCount > 0 && (
            <span className="text-primary">
              {business.activeOfferCount} offer{business.activeOfferCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
