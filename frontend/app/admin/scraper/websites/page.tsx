'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AuthorisationStatus, IntakeResult, Paged, ProviderPolicy, WebsiteListItem } from '@/lib/scraper-types';
import { useOverview } from '../_components/overview';
import { btn, Card, EmptyState, ErrorNote, formatDate, inputClass, Pager, StatusPill, Tabs, useAction } from '../_components/ui';

type Filter = 'all' | AuthorisationStatus;
const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'authorised', label: 'Authorised' },
  { value: 'pending_authorisation', label: 'Pending authorisation' },
  { value: 'awaiting_provider_review', label: 'Provider review' },
  { value: 'opted_out', label: 'Opted out' },
] as const;

type Mode = 'urls' | 'csv' | 'provider';
const MODES = [
  { value: 'urls', label: 'Paste URLs' },
  { value: 'csv', label: 'Upload CSV' },
  { value: 'provider', label: 'Provider client list' },
] as const;

function SubmitPanel({ onSubmitted }: { onSubmitted: () => void }) {
  const [mode, setMode] = useState<Mode>('urls');
  const [urls, setUrls] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [policies, setPolicies] = useState<ProviderPolicy[]>([]);
  const [policyId, setPolicyId] = useState('');
  const [results, setResults] = useState<IntakeResult[] | null>(null);
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (mode !== 'provider') return;
    void api<ProviderPolicy[]>('/admin/scraper/provider-policies').then(setPolicies).catch(() => {});
  }, [mode]);
  const eligible = policies.filter((p) => p.status === 'allowed' && p.basis === 'written_agreement' && p.agreementReference);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const response = await run(async () => {
      if (mode === 'urls') {
        const list = urls.split(/\s+/).map((u) => u.trim()).filter(Boolean);
        return api<IntakeResult[]>('/admin/scraper/websites', { method: 'POST', body: JSON.stringify({ urls: list }) });
      }
      if (!file) throw new Error('Choose a CSV file');
      const form = new FormData();
      form.append('file', file);
      if (mode === 'provider') form.append('providerPolicyId', policyId);
      return api<IntakeResult[]>(mode === 'csv' ? '/admin/scraper/websites/csv' : '/admin/scraper/websites/provider-client-list', {
        method: 'POST',
        body: form,
      });
    });
    if (response) {
      setResults(response);
      setUrls('');
      setFile(null);
      onSubmitted();
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <h2 className="font-display text-lg font-extrabold">Submit websites</h2>
        <Tabs tabs={MODES} active={mode} onChange={(m) => { setMode(m); setResults(null); }} />
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <ErrorNote error={error} />
        {mode === 'urls' && (
          <textarea
            required
            rows={4}
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            placeholder={'One website per line, e.g.\nhttps://www.pizza-palace.co.uk\ncurryhouse-leeds.co.uk'}
            className={inputClass}
          />
        )}
        {mode !== 'urls' && (
          <>
            {mode === 'provider' && (
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-extrabold">Provider</span>
                <select required value={policyId} onChange={(e) => setPolicyId(e.target.value)} className={inputClass}>
                  <option value="">Choose a provider…</option>
                  {eligible.map((p) => (
                    <option key={p._id} value={p._id}>{p.name} · agreement {p.agreementReference}</option>
                  ))}
                </select>
                <span className="text-[12px] font-semibold text-muted">
                  Only providers with an allowed policy and a written data-sharing agreement reference can supply client lists.
                  {eligible.length === 0 && ' None qualify yet: record the agreement under Policies & opt-outs.'}
                </span>
              </label>
            )}
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm font-semibold"
            />
            <span className="text-[12px] font-semibold text-muted">
              One website per row, in a column headed url, website, domain or site (or the first column). Up to 5,000 rows, 1 MB.
            </span>
          </>
        )}
        <div>
          <button type="submit" disabled={busy} className={btn.dark}>
            {busy ? 'Submitting…' : 'Submit and analyse'}
          </button>
        </div>
      </form>
      {results && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[12px] uppercase text-muted">
                <th className="py-2 pr-4">Input</th>
                <th className="py-2 pr-4">Outcome</th>
                <th className="py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={`${r.input}-${i}`} className="border-t border-line align-top">
                  <td className="py-2 pr-4 font-semibold break-all">
                    {r.websiteId ? <Link href={`/admin/scraper/websites/${r.websiteId}`} className="hover:text-primary">{r.domain ?? r.input}</Link> : r.input}
                  </td>
                  <td className="py-2 pr-4"><StatusPill status={r.outcome === 'queued' ? 'completed' : r.outcome === 'rejected' ? 'failed' : 'delayed'} label={r.outcome.replace('_', ' ')} /></td>
                  <td className="py-2 text-muted font-semibold">{r.message ?? (r.runId ? 'Crawl queued' : '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function WebsitesPage() {
  const { refresh } = useOverview();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<WebsiteListItem> | null>(null);
  const { error, run } = useAction();

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: '25' });
    if (filter !== 'all') params.set('status', filter);
    if (query.trim()) params.set('q', query.trim());
    void api<Paged<WebsiteListItem>>(`/admin/scraper/websites?${params}`).then(setData).catch(() => {});
  }, [filter, query, page]);

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get('status') as Filter | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the filter comes from the URL, which is only readable after mount
    if (initial && FILTERS.some((f) => f.value === initial)) setFilter(initial);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(path: string, body: unknown, method = 'PATCH') {
    await run(() => api(path, { method, body: JSON.stringify(body) }));
    load();
    refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <SubmitPanel onSubmitted={() => { load(); refresh(); }} />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Tabs tabs={FILTERS} active={filter} onChange={(f) => { setFilter(f); setPage(1); }} />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          placeholder="Search domains"
          className={`${inputClass} w-full sm:w-64`}
        />
      </div>
      <ErrorNote error={error} />

      <div className="flex flex-col gap-3">
        {data?.items.map((site) => {
          const provider = typeof site.providerRef === 'object' ? site.providerRef : null;
          return (
            <div key={site._id} className="bg-card border border-line rounded-2xl px-6 py-4 flex flex-col md:flex-row md:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <Link href={`/admin/scraper/websites/${site._id}`} className="font-extrabold hover:text-primary break-all">
                    {site.domain}
                  </Link>
                  <StatusPill status={site.authorisationStatus} />
                  {provider && <span className="text-[12px] font-bold text-muted">via {provider.name} ({provider.status})</span>}
                </div>
                <div className="text-[13px] font-semibold text-muted mt-1">
                  {site.discoveredFrom ? `Linked from ${site.discoveredFrom} · ` : ''}
                  {site.adapterId ? `${site.adapterId} ${site.adapterVersion} · ` : ''}
                  {site.lastRun ? `Last run: ${site.lastRun.stage.replace(/_/g, ' ')} ${site.lastRun.status}` : 'Never run'}
                  {site.lastSuccessfulCheckAt ? ` · checked ${formatDate(site.lastSuccessfulCheckAt)}` : ''}
                  {site.candidates.pending_review ? ` · ${site.candidates.pending_review} to review` : ''}
                  {site.lastError ? ` · ${site.lastError}` : ''}
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                {site.authorisationStatus === 'pending_authorisation' && (
                  <>
                    <button className={btn.good} onClick={() => act(`/admin/scraper/websites/${site._id}/authorise`, { decision: 'approve' })}>
                      Authorise
                    </button>
                    <button className={btn.danger} onClick={() => act(`/admin/scraper/websites/${site._id}/authorise`, { decision: 'deny' })}>
                      Deny
                    </button>
                  </>
                )}
                {site.authorisationStatus === 'authorised' && (
                  <button className={btn.outline} onClick={() => act(`/admin/scraper/websites/${site._id}/analyse`, undefined, 'POST')}>
                    Analyse now
                  </button>
                )}
                <Link href={`/admin/scraper/websites/${site._id}`} className={btn.outline}>
                  Details
                </Link>
              </div>
            </div>
          );
        })}
        {data && data.items.length === 0 && <EmptyState>No websites here.</EmptyState>}
      </div>
      {data && <Pager page={data.page} pages={data.pages} onChange={setPage} />}
    </div>
  );
}
