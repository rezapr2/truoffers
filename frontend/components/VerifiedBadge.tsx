import Link from 'next/link';

type Level = number | undefined | null;

/**
 * Spec "Badge rules": every takeaway shows exactly one status, "✓ TruOffers verified" or "Not verified". Level 3
 * adds the hygiene rating. Badges belong to the takeaway, never to an offer.
 */
export default function VerifiedBadge({
  level,
  hygiene,
  className = '',
  quiet = false,
}: {
  level: Level;
  hygiene?: string;
  className?: string;
  /** Leave "Not verified" out (dense lists where the claim action already says it) */
  quiet?: boolean;
}) {
  if ((level ?? 0) >= 2) {
    return (
      <span className={`inline-flex items-center gap-1 text-verified font-bold whitespace-nowrap ${className}`} title="Ownership checked by the TruOffers team">
        <span aria-hidden="true">✓</span> TruOffers verified
        {(level ?? 0) >= 3 && hygiene ? <span className="font-semibold"> · Hygiene {hygiene}</span> : null}
      </span>
    );
  }
  if (quiet) return null;
  return <span className={`text-muted font-semibold whitespace-nowrap ${className}`}>Not verified</span>;
}

/** "Foodbell partner" is its own optional tag, set by admins; it never stands in for verification. */
export function FoodbellTag({ show, className = '' }: { show?: boolean; className?: string }) {
  if (!show) return null;
  return (
    <span className={`inline-flex items-center text-[11px] font-extrabold uppercase tracking-wide text-[#7a5408] bg-sun-soft px-2 py-0.5 rounded-full whitespace-nowrap ${className}`}>
      Foodbell partner
    </span>
  );
}

/** Not-verified takeaways always show "Claim this business"; one with a claim in review says so instead. */
export function ClaimAction({
  business,
  variant = 'link',
  className = '',
}: {
  business: { _id: string; name: string; verificationLevel: Level };
  variant?: 'link' | 'button';
  className?: string;
}) {
  const level = business.verificationLevel ?? 0;
  if (level >= 2) return null;
  if (level === 1) {
    return <span className={`text-[12.5px] font-bold text-[#7a5408] bg-sun-soft/70 px-2.5 py-1 rounded-full whitespace-nowrap ${className}`}>Claim in review</span>;
  }
  const href = `/claim-your-business?business=${business._id}&name=${encodeURIComponent(business.name)}`;
  return variant === 'button' ? (
    <Link href={href} className={`btn-soft text-sm font-bold px-5 py-2.5 rounded-2xl whitespace-nowrap ${className}`}>
      Claim this business
    </Link>
  ) : (
    <Link href={href} className={`text-[12.5px] font-bold text-primary hover:text-primary-dark whitespace-nowrap ${className}`}>
      Claim this business
    </Link>
  );
}
