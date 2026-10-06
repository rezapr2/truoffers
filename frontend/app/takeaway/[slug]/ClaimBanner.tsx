'use client';

import type { Business } from '@/lib/types';
import { ClaimAction } from '@/components/VerifiedBadge';

/** Not-verified takeaways always show "Claim this business"; with a claim in review they say so instead. */
export default function ClaimBanner({ business }: { business: Business }) {
  if (business.verificationLevel >= 2) return null;
  const inReview = business.verificationLevel === 1;
  return (
    <div className="bg-tint-blue border border-primary/15 rounded-2xl px-6 py-4 mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1">
        <div className="font-extrabold text-[15px]">{inReview ? 'A claim for this business is being reviewed' : 'Is this your business?'}</div>
        <div className="text-sm font-semibold text-ink-soft">
          {inReview
            ? 'Our team is checking who runs it. Offers from the owner appear once it is verified.'
            : 'Claim it free to manage your profile, post offers and see how customers find you.'}
        </div>
      </div>
      <ClaimAction business={business} variant="button" className="self-start" />
    </div>
  );
}
