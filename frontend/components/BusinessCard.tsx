'use client';

import Link from 'next/link';
import type { Business } from '@/lib/types';
import { assetUrl } from '@/lib/api';
import FollowButton from './FollowButton';
import VerifiedBadge, { ClaimAction, FoodbellTag } from './VerifiedBadge';

export default function BusinessCard({ business }: { business: Business }) {
  const cuisines =
    Array.isArray(business.categories) && business.categories.length > 0 && typeof business.categories[0] === 'object'
      ? (business.categories as { name: string }[]).map((c) => c.name).join(', ')
      : '';
  return (
    <div className="bg-card border border-line rounded-2xl p-6 flex gap-4 items-center min-w-0 hover:shadow-lg transition-shadow">
      <div className="w-16 h-16 flex-none rounded-full bg-sun-soft flex items-center justify-center font-display font-extrabold text-xl text-brand-deep overflow-hidden">
        {business.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetUrl(business.logoUrl)} alt="" className="w-full h-full object-cover" />
        ) : (
          business.name.charAt(0)
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link href={`/takeaway/${business.slug}`} className="text-[17px] font-extrabold text-ink hover:text-primary transition-colors truncate">
            {business.name}
          </Link>
        </div>
        <div className="text-[13px] font-semibold text-muted truncate">
          {cuisines}
          {business.town ? ` · ${business.town} ${business.postcodeArea ?? ''}` : ''}
          {business.distanceMiles != null ? ` · ${business.distanceMiles} mi` : ''}
        </div>
        <div className="flex gap-2.5 mt-1.5 text-[13px] font-bold flex-wrap items-center">
          {business.reviews?.rating > 0 && <span className="text-star">★ {business.reviews.rating.toFixed(1)}</span>}
          <VerifiedBadge level={business.verificationLevel} />
          <FoodbellTag show={business.isFoodbellClient} />
          {business.activeOfferCount > 0 && (
            <span className="text-primary">
              {business.activeOfferCount} offer{business.activeOfferCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <ClaimAction business={business} className="mt-1.5 inline-block" />
      </div>
      <div className="flex-none self-start pt-1">
        <FollowButton businessId={business._id} />
      </div>
    </div>
  );
}
