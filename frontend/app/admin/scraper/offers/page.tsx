'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { ImportedOfferRow, ImportedOfferState, Paged } from '@/lib/scraper-types';
import { useOverview } from '../_components/overview';
import { Card, EmptyState, formatDate, inputClass, Pager, SectionTitle, StatusPill, Tabs } from '../_components/ui';

const TABS = [
  { value: 'revision_pending' as const, label: 'Changed terms' },
  { value: 'expiry_review' as const, label: 'Expiry review' },
  { value: 'possibly_removed' as const, label: 'Possibly removed' },
  { value: 'source_changed' as const, label: 'Business told' },
  { value: 'stale' as const, label: 'Not checked lately' },
];

const EXPLAIN: Record<ImportedOfferState, string> = {
  revision_pending: 'The website now says something different. The published offer stays live until you apply or discard the change.',
  expiry_review: 'Missing from two checks in a row. Decide whether the offer has ended or is still on.',
  possibly_removed: 'Missing from the last check, so it is hidden from the public while the next check confirms.',
  source_changed: 'The business manages these offers. The robot never changes them; it only flags that their website changed.',
  stale: 'Published, but the website has not been read successfully for a week.',
};

export default function ImportedOffersPage() {
  const [state, setState] = useState<ImportedOfferState>('revision_pending');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<ImportedOfferRow> | null>(null);
  const { overview } = useOverview();

  useEffect(() => {
    const params = new URLSearchParams({ state, page: String(page) });
    if (q.trim()) params.set('q', q.trim());
    void api<Paged<ImportedOfferRow>>(`/admin/scraper/imported-offers?${params}`).then(setData).catch(() => {});
  }, [state, q, page]);

  return (
    <div className="flex flex-col gap-6">
      <Tabs tabs={TABS} active={state} onChange={(value) => { setState(value); setPage(1); }} counts={overview?.importedOffers} />
      <Card>
        <SectionTitle
          aside={
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              placeholder="Search title or website"
              className={`${inputClass} text-sm`}
            />
          }
        >
          {TABS.find((t) => t.value === state)!.label}
        </SectionTitle>
        <p className="text-[13px] font-semibold text-muted -mt-2 mb-4">{EXPLAIN[state]}</p>

        <div className="flex flex-col divide-y divide-line">
          {data?.items.map((offer) => {
            const business = typeof offer.businessId === 'object' ? offer.businessId : null;
            return (
              <Link key={offer._id} href={`/admin/scraper/offers/${offer._id}`} className="py-3 flex flex-col md:flex-row md:items-center gap-2 hover:text-primary">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-extrabold">{offer.title}</span>
                    <StatusPill status={offer.status} />
                    {offer.sourceChanged && <StatusPill status="source_changed" label="source changed" />}
                    <span className="text-[12px] font-bold text-muted">{offer.displayLabel}</span>
                  </div>
                  <div className="text-[13px] font-semibold text-muted">
                    {business?.name ?? 'Unknown business'} · {offer.sourceDomain ?? '—'} · last checked {formatDate(offer.lastCheckedAt)}
                    {offer.revision ? ` · changed: ${offer.revision.changedFields.join(', ')}` : ''}
                    {state === 'possibly_removed' || state === 'expiry_review' ? ` · missed ${offer.absentChecks} check${offer.absentChecks === 1 ? '' : 's'}` : ''}
                  </div>
                </div>
                {offer.endsAt && <span className="text-[12px] font-bold text-muted whitespace-nowrap">Ends {formatDate(offer.endsAt, false)}</span>}
              </Link>
            );
          })}
        </div>
        {data?.items.length === 0 && <EmptyState>Nothing here. Rechecks run on their own schedule.</EmptyState>}
        {data && <div className="mt-6"><Pager page={data.page} pages={data.pages} onChange={setPage} /></div>}
      </Card>
    </div>
  );
}
