'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { Business } from '@/lib/types';
import type { BusinessRef, WebsiteBranch } from '@/lib/scraper-types';
import { btn, ErrorNote, inputClass, StatusPill, useAction } from './ui';

function asBusiness(ref: BusinessRef | string | null | undefined): BusinessRef | null {
  return ref && typeof ref === 'object' ? ref : null;
}

/**
 * Links one branch found on a website to a TruOffers listing. Offers from that branch can only be
 * published once it is matched: confirm a suggestion, attach another listing, create a new
 * (unclaimed) listing from the extracted details, or reject it as not a branch.
 */
export default function BranchDecision({
  websiteId,
  branch,
  onDone,
}: {
  websiteId: string;
  branch: WebsiteBranch;
  onDone: () => void;
}) {
  const extracted = branch.extracted ?? {};
  const current = asBusiness(branch.businessRef);
  const resolved = branch.matchStatus === 'auto_matched' || branch.matchStatus === 'confirmed';
  const [mode, setMode] = useState<'idle' | 'attach' | 'create' | 'reject'>('idle');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Business[]>([]);
  const [draft, setDraft] = useState({
    name: extracted.name ?? '',
    postcode: extracted.postcode ?? '',
    phone: extracted.telephone ?? '',
    address: extracted.address ?? '',
    town: extracted.town ?? '',
    website: extracted.website ?? '',
    orderUrl: extracted.orderUrl ?? '',
  });
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction();

  async function decide(body: Record<string, unknown>) {
    const done = await run(() =>
      api(`/admin/scraper/websites/${websiteId}/branches?path=${encodeURIComponent(branch.branchPath)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    );
    if (done) {
      setMode('idle');
      onDone();
    }
  }

  async function findListings(e: React.FormEvent) {
    e.preventDefault();
    const found = await run(() => api<{ items: Business[] }>(`/businesses?q=${encodeURIComponent(search)}&limit=8`));
    if (found) setResults(found.items);
  }

  const detail = [extracted.address, extracted.postcode, extracted.telephone].filter(Boolean).join(' · ');

  return (
    <div className="border border-line rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-extrabold">
            {extracted.name ?? 'Unnamed branch'} <span className="text-muted font-semibold text-sm">{branch.branchPath}</span>
          </div>
          <div className="text-[13px] font-semibold text-muted">{detail || 'No contact details found'}</div>
          {extracted.sourceUrl && (
            <a href={extracted.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] font-bold text-primary break-all">
              {extracted.sourceUrl}
            </a>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={branch.matchStatus} />
          {branch.matchScore !== undefined && <span className="text-[12px] font-bold text-muted">score {branch.matchScore}</span>}
        </div>
      </div>

      {current && (
        <div className="text-sm font-semibold">
          Linked to{' '}
          <Link href={`/takeaway/${current.slug}`} target="_blank" className="font-extrabold hover:text-primary">
            {current.name}
          </Link>{' '}
          <span className="text-muted">{[current.postcode, current.phone].filter(Boolean).join(' · ')}</span>
          {branch.matchSignals.length > 0 && <span className="text-muted"> · matched on {branch.matchSignals.join(', ')}</span>}
        </div>
      )}

      {!resolved && branch.suggestions.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-extrabold uppercase text-muted">Suggested listings</div>
          {branch.suggestions.map((s) => {
            const business = asBusiness(s.businessRef);
            if (!business) return null;
            return (
              <div key={business._id} className="flex items-center justify-between gap-3 flex-wrap bg-surface rounded-xl px-4 py-2.5">
                <div className="text-sm font-semibold">
                  <span className="font-extrabold">{business.name}</span> · {[business.postcode, business.phone, business.town].filter(Boolean).join(' · ')}
                  <span className="text-muted"> · score {s.score} ({s.signals.join(', ')})</span>
                </div>
                <button disabled={busy} className={btn.good} onClick={() => decide({ action: 'confirm', businessId: business._id })}>
                  This is the listing
                </button>
              </div>
            );
          })}
        </div>
      )}

      <ErrorNote error={error} />

      <div className="flex gap-2 flex-wrap">
        <button className={btn.outline} onClick={() => setMode(mode === 'attach' ? 'idle' : 'attach')}>
          {resolved ? 'Link a different listing' : 'Attach an existing listing'}
        </button>
        {!resolved && (
          <button className={btn.outline} onClick={() => setMode(mode === 'create' ? 'idle' : 'create')}>
            Create a new listing
          </button>
        )}
        {branch.matchStatus !== 'rejected' && (
          <button className={btn.danger} onClick={() => setMode(mode === 'reject' ? 'idle' : 'reject')}>
            Not a branch
          </button>
        )}
      </div>

      {mode === 'attach' && (
        <div className="flex flex-col gap-2">
          <form onSubmit={findListings} className="flex gap-2">
            <input required value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search listings by name" className={`${inputClass} flex-1`} />
            <button disabled={busy} className={btn.dark}>Search</button>
          </form>
          {results.map((b) => (
            <div key={b._id} className="flex items-center justify-between gap-3 flex-wrap bg-surface rounded-xl px-4 py-2.5 text-sm font-semibold">
              <span>
                <span className="font-extrabold">{b.name}</span> · {[b.postcode, b.phone, b.town].filter(Boolean).join(' · ')}
              </span>
              <button disabled={busy} className={btn.good} onClick={() => decide({ action: 'attach', businessId: b._id })}>
                Attach
              </button>
            </div>
          ))}
        </div>
      )}

      {mode === 'create' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const business = Object.fromEntries(Object.entries(draft).filter(([, v]) => v.trim()));
            void decide({ action: 'create', business });
          }}
          className="grid md:grid-cols-2 gap-3"
        >
          {(
            [
              ['name', 'Business name *'],
              ['postcode', 'Postcode *'],
              ['phone', 'Phone'],
              ['address', 'Address'],
              ['town', 'Town'],
              ['website', 'Website'],
              ['orderUrl', 'Order URL'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="text-[12px] font-extrabold">{label}</span>
              <input
                required={key === 'name' || key === 'postcode'}
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                className={inputClass}
              />
            </label>
          ))}
          <div className="md:col-span-2 flex items-center gap-3 flex-wrap">
            <button disabled={busy} className={btn.dark}>Create unclaimed listing and link it</button>
            <span className="text-[12px] font-semibold text-muted">Pre-filled from the website. Check the details first.</span>
          </div>
        </form>
      )}

      {mode === 'reject' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void decide({ action: 'reject', note: note || undefined });
          }}
          className="flex gap-2 flex-wrap"
        >
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (optional)" className={`${inputClass} flex-1`} />
          <button disabled={busy} className={btn.danger}>Reject branch and its pending offers</button>
        </form>
      )}
    </div>
  );
}
