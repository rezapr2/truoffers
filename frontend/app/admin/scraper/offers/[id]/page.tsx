'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { ImportedOfferDetail, OfferRevision, RevisionValue } from '@/lib/scraper-types';
import { useOverview } from '../../_components/overview';
import { btn, Card, ErrorNote, formatDate, humanise, inputClass, SectionTitle, StatusPill, useAction } from '../../_components/ui';

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  discountType: 'Offer type',
  value: 'Discount',
  code: 'Promo code',
  minOrder: 'Minimum order',
  requiredSpend: 'Required spend',
  terms: 'Terms',
  applicableProducts: 'Products',
  freeItem: 'Free item',
  originalPrice: 'Original price',
  promotionalPrice: 'Promotional price',
  startsAt: 'Starts',
  endsAt: 'Ends',
  eligibleWeekdays: 'Days',
  dailyStartTime: 'From',
  dailyEndTime: 'Until',
  collection: 'Collection',
  delivery: 'Delivery',
  newCustomersOnly: 'New customers only',
};

function show(value: RevisionValue) {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function RevisionDiff({ revision }: { revision: OfferRevision }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] border-collapse min-w-[520px]">
        <thead>
          <tr className="text-left text-muted">
            <th className="py-2 pr-4 font-extrabold">Field</th>
            <th className="py-2 pr-4 font-extrabold">Published now</th>
            <th className="py-2 font-extrabold">The website says</th>
          </tr>
        </thead>
        <tbody>
          {revision.changedFields.map((field) => (
            <tr key={field} className="border-t border-line align-top">
              <td className="py-2 pr-4 font-bold">{FIELD_LABELS[field] ?? humanise(field)}</td>
              <td className="py-2 pr-4 text-muted line-through">{show(revision.previous[field])}</td>
              <td className="py-2 font-extrabold">{show(revision.proposedValues[field])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ImportedOfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<ImportedOfferDetail | null>(null);
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction();
  const { refresh } = useOverview();

  const load = useCallback(() => {
    void api<ImportedOfferDetail>(`/admin/scraper/imported-offers/${id}`).then(setData).catch(() => {});
  }, [id]);
  useEffect(load, [load]);

  async function act<T>(fn: () => Promise<T>) {
    const done = await run(fn);
    if (done) {
      setNote('');
      load();
      refresh();
    }
  }

  if (!data) return <Card>Loading…</Card>;
  const { offer, business, website, revisions } = data;
  const pending = revisions.find((r) => r.status === 'pending');
  const history = revisions.filter((r) => r.status !== 'pending');

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/scraper/offers" className="text-[13px] font-bold text-muted hover:text-primary">← Imported offers</Link>
        <h2 className="font-display text-2xl font-extrabold flex items-center gap-3 flex-wrap">
          {offer.title}
          <StatusPill status={offer.status} />
          <StatusPill status={offer.verification} />
        </h2>
        <p className="text-[13px] font-semibold text-muted">
          {business ? <Link href={`/takeaway/${business.slug}`} className="hover:text-primary">{business.name}</Link> : 'Unknown business'} ·{' '}
          {offer.sourceDomain ?? '—'} · {offer.displayLabel}
          {offer.endsAt ? ` · ends ${formatDate(offer.endsAt, false)}` : ''}
        </p>
      </div>
      <ErrorNote error={error} />

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <SectionTitle>Checks</SectionTitle>
          <dl className="text-[13px] font-semibold grid grid-cols-2 gap-y-2">
            <dt className="text-muted">Last checked</dt><dd>{formatDate(offer.lastCheckedAt)}</dd>
            <dt className="text-muted">Last seen on the website</dt><dd>{formatDate(offer.lastSeenAt)}</dd>
            <dt className="text-muted">Checks without it</dt><dd>{offer.absentChecks}</dd>
            <dt className="text-muted">In this state since</dt><dd>{formatDate(offer.recheckStateAt)}</dd>
            <dt className="text-muted">Next check of the website</dt><dd>{formatDate(website?.nextCheckAt)}</dd>
            <dt className="text-muted">Last successful check</dt><dd>{formatDate(website?.lastSuccessfulCheckAt)}</dd>
          </dl>
          {website?.lastError && <p className="text-[13px] font-bold text-primary mt-3">Last error: {website.lastError}</p>}
          {website && (
            <Link href={`/admin/scraper/websites/${website._id}`} className={`${btn.outline} inline-block mt-4`}>
              Open {website.domain}
            </Link>
          )}
        </Card>

        <Card>
          <SectionTitle>Where it was found</SectionTitle>
          <div className="flex flex-col gap-3">
            {(offer.sources ?? []).map((source) => (
              <div key={source.url} className="text-[13px]">
                <a href={source.url} target="_blank" rel="noreferrer" className="font-bold hover:text-primary break-all">{source.url}</a>
                <div className="text-muted font-semibold">checked {formatDate(source.checkedAt)}</div>
                {source.excerpt ? <p className="italic text-ink-soft mt-1">“{source.excerpt}”</p> : <p className="text-muted mt-1">Page text removed under the retention policy.</p>}
              </div>
            ))}
            {(offer.sources ?? []).length === 0 && <p className="text-[13px] font-semibold text-muted">No stored sources.</p>}
          </div>
        </Card>
      </div>

      {offer.status === 'expiry_review' && (
        <Card>
          <SectionTitle>Has this offer ended?</SectionTitle>
          <p className="text-[13px] font-semibold text-muted mb-4">
            It was missing from {offer.absentChecks} successful checks in a row. Expiring it keeps the record; restoring publishes it again
            and checks the website tomorrow.
          </p>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className={`${inputClass} w-full mb-3`} />
          <div className="flex gap-3 flex-wrap">
            <button
              className={btn.primary}
              disabled={busy}
              onClick={() => act(() => api(`/admin/scraper/imported-offers/${offer._id}/expiry-decision`, { method: 'POST', body: JSON.stringify({ decision: 'expire', note: note || undefined }) }))}
            >
              It has ended: expire it
            </button>
            <button
              className={btn.good}
              disabled={busy}
              onClick={() => act(() => api(`/admin/scraper/imported-offers/${offer._id}/expiry-decision`, { method: 'POST', body: JSON.stringify({ decision: 'restore', note: note || undefined }) }))}
            >
              Still on: publish it again
            </button>
          </div>
        </Card>
      )}

      {pending && (
        <Card>
          <SectionTitle aside={<span className="text-[12px] font-bold text-muted">Seen {pending.detectionCount}× · first {formatDate(pending.firstDetectedAt)}</span>}>
            The website changed this offer
          </SectionTitle>
          <RevisionDiff revision={pending} />
          <div className="flex flex-col gap-3 mt-5">
            {pending.sources.map((source) => (
              <div key={source.url} className="text-[13px]">
                <a href={source.url} target="_blank" rel="noreferrer" className="font-bold hover:text-primary break-all">{source.url}</a>
                {source.excerpt && <p className="italic text-ink-soft">“{source.excerpt}”</p>}
              </div>
            ))}
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className={`${inputClass} w-full mt-4 mb-3`} />
          <div className="flex gap-3 flex-wrap">
            <button
              className={btn.good}
              disabled={busy}
              onClick={() => act(() => api(`/admin/scraper/revisions/${pending._id}/apply`, { method: 'POST', body: JSON.stringify({ verification: 'admin_verified', note: note || undefined }) }))}
            >
              Apply and mark verified
            </button>
            <button
              className={btn.dark}
              disabled={busy}
              onClick={() => act(() => api(`/admin/scraper/revisions/${pending._id}/apply`, { method: 'POST', body: JSON.stringify({ verification: 'unverified', note: note || undefined }) }))}
            >
              Apply as unverified
            </button>
            <button
              className={btn.outline}
              disabled={busy}
              onClick={() => act(() => api(`/admin/scraper/revisions/${pending._id}/discard`, { method: 'POST', body: JSON.stringify({ reason: note || undefined }) }))}
            >
              Keep the published version
            </button>
          </div>
          <p className="text-[12px] font-semibold text-muted mt-3">Discarding keeps what is published; the same change won’t be proposed again.</p>
        </Card>
      )}

      <Card>
        <SectionTitle>Revision history</SectionTitle>
        {history.length === 0 && <p className="text-[13px] font-semibold text-muted">No changes have been reviewed yet.</p>}
        <div className="flex flex-col gap-5">
          {history.map((revision) => (
            <div key={revision._id} className="border-t border-line pt-4 first:border-0 first:pt-0">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <StatusPill status={revision.status} />
                <span className="text-[12px] font-bold text-muted">
                  found {formatDate(revision.lastDetectedAt)}
                  {revision.reviewedAt ? ` · decided ${formatDate(revision.reviewedAt)}` : ''}
                  {typeof revision.reviewedBy === 'object' && revision.reviewedBy?.name ? ` by ${revision.reviewedBy.name}` : ''}
                </span>
              </div>
              <RevisionDiff revision={revision} />
              {(revision.reviewNote || revision.closedReason) && (
                <p className="text-[13px] font-semibold text-muted mt-2">{revision.reviewNote ?? revision.closedReason}</p>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
