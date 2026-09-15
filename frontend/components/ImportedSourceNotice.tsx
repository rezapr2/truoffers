import Link from 'next/link';
import { ukDate } from '@/lib/dates';
import type { ImportNotice } from '@/lib/types';

function checkedOn(date?: string) {
  return date ? ukDate(date, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
}

function removalHref(offerId?: string, businessSlug?: string) {
  if (offerId) return `/removal-request?offer=${offerId}`;
  if (businessSlug) return `/removal-request?business=${encodeURIComponent(businessSlug)}`;
  return '/removal-request';
}

/**
 * Offers and listings imported from a takeaway's own website say so, show when they were last
 * checked, and link to the removal form. Once the business confirms an offer it is theirs, and the
 * notice says that instead.
 */
export default function ImportedSourceNotice({
  imported,
  offerId,
  businessSlug,
  variant = 'full',
  className = '',
}: {
  imported?: ImportNotice | null;
  offerId?: string;
  businessSlug?: string;
  variant?: 'full' | 'compact' | 'pill';
  className?: string;
}) {
  if (!imported) return null;
  const confirmed = imported.verification === 'merchant_verified';
  const checked = checkedOn(imported.lastCheckedAt);

  if (variant === 'pill') {
    return (
      <span
        title={`Imported from ${imported.domain}${checked ? ` · last checked ${checked}` : ''}`}
        className={`text-[10px] font-extrabold uppercase tracking-wide text-muted bg-page px-2 py-1 rounded-full whitespace-nowrap ${className}`}
      >
        {confirmed ? 'Confirmed' : 'Imported'}
      </span>
    );
  }

  if (variant === 'compact') {
    return (
      <span className={`text-[12px] font-semibold text-muted ${className}`}>
        {confirmed ? 'Confirmed by the business' : `From ${imported.domain}`}
        {checked && !confirmed ? ` · checked ${checked}` : ''}
      </span>
    );
  }

  return (
    <div className={`bg-page border border-line rounded-2xl px-5 py-3 text-[13px] font-semibold text-ink-soft flex flex-col sm:flex-row sm:items-center gap-2 ${className}`}>
      <span className="flex-1">
        {confirmed ? 'Confirmed by the business · originally found on ' : 'Imported from the business’s website '}
        <span className="font-extrabold text-ink">{imported.domain}</span>
        {checked ? ` · last checked ${checked}` : ''}
      </span>
      {!confirmed && (
        <Link href={removalHref(offerId, businessSlug)} className="font-bold text-primary hover:text-primary-dark whitespace-nowrap">
          Request removal
        </Link>
      )}
    </div>
  );
}
