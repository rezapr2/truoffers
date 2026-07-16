'use client';

import Link from 'next/link';
import type { Business } from '@/lib/types';

export default function ClaimBanner({ business }: { business: Business }) {
  if (business.verificationStatus !== 'unclaimed') return null;
  return (
    <div className="bg-peach-2/40 border border-primary/25 rounded-2xl px-6 py-4 mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1">
        <div className="font-extrabold text-[15px]">Is this your business?</div>
        <div className="text-sm font-semibold text-ink-soft">
          Claim it free to manage your profile, post offers and see your analytics.
        </div>
      </div>
      <Link
        href={`/claim-your-business?business=${business._id}&name=${encodeURIComponent(business.name)}`}
        className="bg-primary text-cream text-sm font-bold px-6 py-3 rounded-full hover:bg-primary-dark transition-colors whitespace-nowrap self-start"
      >
        Claim this business
      </Link>
    </div>
  );
}
