'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { CandidateList, CandidateStatus, ConfidenceBand, PendingBranch } from '@/lib/scraper-types';
import BranchDecision from '../_components/BranchDecision';
import { useOverview } from '../_components/overview';
import { ConfidenceBadge, EmptyState, formatDate, inputClass, Pager, StatusPill, Tabs } from '../_components/ui';

const VIEWS = [
  { value: 'offers', label: 'Offers' },
  { value: 'matches', label: 'Business matches' },
] as const;

const STATUSES: { value: '' | CandidateStatus; label: string }[] = [
  { value: '', label: 'Open (all awaiting a decision)' },
  { value: 'pending_review', label: 'Pending review' },
  { value: 'awaiting_merchant_confirmation', label: 'Awaiting the business' },
  { value: 'needs_reextraction', label: 'Needs re-extraction' },
  { value: 'failed_extraction', label: 'Failed extraction' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'merged', label: 'Merged' },
];

const BANDS: { value: '' | ConfidenceBand; label: string }[] = [
  { value: '', label: 'Any confidence' },
  { value: 'high', label: 'High (90+)' },
  { value: 'review_recommended', label: 'Review recommended (70–89)' },
  { value: 'manual_investigation', label: 'Investigate (40–69)' },
  { value: 'failed', label: 'Failed (<40)' },
];

function MatchesView() {
  const { refresh } = useOverview();
  const [branches, setBranches] = useState<PendingBranch[] | null>(null);
  const load = useCallback(() => {
    void api<PendingBranch[]>('/admin/scraper/websites/pending-branches').then(setBranches).catch(() => {});
  }, []);
  useEffect(load, [load]);

  if (!branches) return <div className="py-10 text-center text-muted font-bold">Loading…</div>;
  if (branches.length === 0) return <EmptyState>Every branch found so far is matched to a listing.</EmptyState>;
  return (
    <div className="flex flex-col gap-4">
      {branches.map((item) => (
        <div key={`${item.websiteId}${item.branch.branchPath}`} className="bg-card border border-line rounded-2xl p-5 flex flex-col gap-3">
          <Link href={`/admin/scraper/websites/${item.websiteId}`} className="text-sm font-extrabold hover:text-primary">
            {item.domain}
          </Link>
          <BranchDecision websiteId={item.websiteId} branch={item.branch} onDone={() => { load(); refresh(); }} />
        </div>
      ))}
    </div>
  );
}

export default function CandidatesPage() {
  const [view, setView] = useState<'offers' | 'matches'>('offers');
  const [status, setStatus] = useState<'' | CandidateStatus>('');
  const [band, setBand] = useState<'' | ConfidenceBand>('');
  const [duplicate, setDuplicate] = useState(false);
  const [websiteId, setWebsiteId] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CandidateList | null>(null);
  const { overview } = useOverview();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- filters come from the URL, which is only readable after mount
    if (params.get('tab') === 'matches') setView('matches');
    if (params.get('websiteId')) setWebsiteId(params.get('websiteId')!);
  }, []);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: '25' });
    if (status) params.set('status', status);
    if (band) params.set('band', band);
    if (duplicate) params.set('duplicate', 'true');
    if (websiteId) params.set('websiteId', websiteId);
    if (query.trim()) params.set('q', query.trim());
    void api<CandidateList>(`/admin/scraper/candidates?${params}`).then(setData).catch(() => {});
  }, [page, status, band, duplicate, websiteId, query]);

  useEffect(() => {
    if (view === 'offers') load();
  }, [view, load]);

  return (
    <div className="flex flex-col gap-5">
      <Tabs tabs={VIEWS} active={view} onChange={setView} counts={{ offers: overview?.candidatesAwaitingReview, matches: overview?.branchesAwaitingMatch }} />

      {view === 'matches' && <MatchesView />}

      {view === 'offers' && (
        <>
          <div className="flex gap-3 flex-wrap items-center">
            <select value={status} onChange={(e) => { setStatus(e.target.value as '' | CandidateStatus); setPage(1); }} className={inputClass}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <select value={band} onChange={(e) => { setBand(e.target.value as '' | ConfidenceBand); setPage(1); }} className={inputClass}>
              {BANDS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm font-bold">
              <input type="checkbox" checked={duplicate} onChange={(e) => { setDuplicate(e.target.checked); setPage(1); }} className="accent-primary" />
              Possible duplicates only
            </label>
            <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search title or domain" className={`${inputClass} flex-1 min-w-48`} />
            {websiteId && (
              <button className="text-sm font-bold text-primary cursor-pointer" onClick={() => setWebsiteId('')}>
                Showing one website · clear
              </button>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {data?.items.map((c) => (
              <Link
                key={c._id}
                href={`/admin/scraper/candidates/${c._id}`}
                className="bg-card border border-line rounded-2xl px-6 py-4 flex flex-col md:flex-row md:items-center gap-3 hover:shadow-lg transition-shadow"
              >
                <ConfidenceBadge score={c.confidenceScore} band={c.confidenceBand} />
                <div className="flex-1 min-w-0">
                  <div className="font-extrabold truncate">{c.title}</div>
                  <div className="text-[13px] font-semibold text-muted">
                    {c.domain} · {c.offerType.replace(/_/g, ' ')}
                    {c.branchPaths.length > 1 ? ` · ${c.branchPaths.length} branches` : ''} · found {formatDate(c.createdAt)}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {c.duplicate && <StatusPill status="delayed" label={c.duplicate.kind.replace(/_/g, ' ')} />}
                  {c.conflicts.length > 0 && <StatusPill status="failed" label="conflict" />}
                  <StatusPill status={c.status} />
                </div>
              </Link>
            ))}
            {data && data.items.length === 0 && <EmptyState>Nothing matches these filters.</EmptyState>}
          </div>
          {data && <Pager page={data.page} pages={data.pages} onChange={setPage} />}
        </>
      )}
    </div>
  );
}
