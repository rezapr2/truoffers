'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { AdapterListItem, AuthorisedNetwork, Fingerprint, NetworkView, ProviderPolicy } from '@/lib/scraper-types';
import { useOverview } from '../_components/overview';
import { useJob } from '../_components/useJob';
import { btn, Card, EmptyState, ErrorNote, formatDate, inputClass, Pager, SectionTitle, StatusPill, useAction } from '../_components/ui';

type Filters = {
  status: string;
  matchCategory: string;
  fingerprintId: string;
  providerId: string;
  adapterKey: string;
  networkId: string;
  minScore: string;
  hasErrors: boolean;
  checkedBefore: string;
  q: string;
  groupBy: 'fingerprint' | 'provider' | 'adapter';
};

const EMPTY: Filters = { status: '', matchCategory: '', fingerprintId: '', providerId: '', adapterKey: '', networkId: '', minScore: '', hasErrors: false, checkedBefore: '', q: '', groupBy: 'fingerprint' };

const BULK = [
  { action: 'authorise', label: 'Authorise', style: btn.good },
  { action: 'run', label: 'Run extraction', style: btn.dark },
  { action: 'match_fingerprint', label: 'Match templates', style: btn.outline },
  { action: 'pause', label: 'Pause', style: btn.outline },
  { action: 'resume', label: 'Resume', style: btn.outline },
  { action: 'opt_out', label: 'Opt out', style: btn.danger },
] as const;

function NetworksPanel({ providers, onChanged }: { providers: ProviderPolicy[]; onChanged: () => void }) {
  const [networks, setNetworks] = useState<AuthorisedNetwork[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ name: '', sitemapUrls: '', basis: 'written_agreement', agreementReference: '', basisNotes: '', providerId: '' });
  const [discovery, setDiscovery] = useState<{ networkId: string; jobId: string } | null>(null);
  const load = useCallback(() => void api<AuthorisedNetwork[]>('/admin/scraper/networks').then(setNetworks).catch(() => {}), []);
  const job = useJob(discovery?.jobId, () => {
    load();
    onChanged();
  });
  const { busy, error, run } = useAction();
  useEffect(load, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const created = await run(() =>
      api('/admin/scraper/networks', {
        method: 'POST',
        body: JSON.stringify({
          name: draft.name,
          sitemapUrls: draft.sitemapUrls.split(/\s+/).filter(Boolean),
          basis: draft.basis,
          agreementReference: draft.agreementReference || undefined,
          basisNotes: draft.basisNotes || undefined,
          providerId: draft.providerId || undefined,
        }),
      }),
    );
    if (created) {
      setOpen(false);
      load();
    }
  }

  return (
    <Card>
      <SectionTitle aside={<button className={btn.outline} onClick={() => setOpen(!open)}>{open ? 'Close' : 'Register a network'}</button>}>Authorised networks</SectionTitle>
      <p className="text-[13px] font-semibold text-muted mb-3">
        Websites listed in an authorised network’s sitemap (for example a provider’s client directory shared under an agreement) are registered as authorised.
        Websites that are only linked stay pending until an admin approves them.
      </p>
      <ErrorNote error={error} />
      {open && (
        <form onSubmit={create} className="grid md:grid-cols-2 gap-3 border border-line rounded-2xl p-4 mb-4">
          <label className="flex flex-col gap-1"><span className="text-[12px] font-extrabold">Name</span><input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} /></label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-extrabold">Provider (optional)</span>
            <select value={draft.providerId} onChange={(e) => setDraft({ ...draft, providerId: e.target.value })} className={inputClass}>
              <option value="">None</option>
              {providers.map((p) => <option key={p._id} value={p._id}>{p.name} ({p.status})</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 md:col-span-2"><span className="text-[12px] font-extrabold">Sitemap URLs (one per line)</span><textarea required rows={2} value={draft.sitemapUrls} onChange={(e) => setDraft({ ...draft, sitemapUrls: e.target.value })} className={inputClass} /></label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-extrabold">Basis</span>
            <select value={draft.basis} onChange={(e) => setDraft({ ...draft, basis: e.target.value })} className={inputClass}>
              <option value="written_agreement">Written agreement</option>
              <option value="terms_review">Reviewed terms</option>
            </select>
          </label>
          {draft.basis === 'written_agreement' ? (
            <label className="flex flex-col gap-1"><span className="text-[12px] font-extrabold">Agreement reference *</span><input required value={draft.agreementReference} onChange={(e) => setDraft({ ...draft, agreementReference: e.target.value })} className={inputClass} /></label>
          ) : (
            <label className="flex flex-col gap-1"><span className="text-[12px] font-extrabold">What the terms allow *</span><input required value={draft.basisNotes} onChange={(e) => setDraft({ ...draft, basisNotes: e.target.value })} className={inputClass} /></label>
          )}
          <div className="md:col-span-2"><button disabled={busy} className={btn.dark}>Register network</button></div>
        </form>
      )}
      <div className="flex flex-col divide-y divide-line">
        {networks.map((network) => (
          <div key={network._id} className="py-3 flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-extrabold">{network.name}</span>
                {!network.active && <StatusPill status="paused" label="inactive" />}
                <span className="text-[12px] font-bold text-muted">{network.basis.replace(/_/g, ' ')}{network.agreementReference ? ` ${network.agreementReference}` : ''}</span>
              </div>
              <div className="text-[13px] font-semibold text-muted break-all">
                {network.sitemapUrls.join(', ')} · {Object.entries(network.websites).map(([s, n]) => `${n} ${s.replace(/_/g, ' ')}`).join(', ') || 'no websites yet'} · last discovered {formatDate(network.lastDiscoveredAt)}
              </div>
              {discovery?.networkId === network._id && (
                <div className="text-[13px] font-bold mt-1">
                  {job.finished
                    ? job.succeeded
                      ? `Discovery finished: ${Object.entries(job.job?.resultCounts ?? {}).map(([k, v]) => `${k} ${v}`).join(', ')}`
                      : `Discovery ${job.job?.status}: ${job.job?.errorLog?.at(-1)?.message}`
                    : 'Reading sitemaps…'}
                </div>
              )}
            </div>
            <button
              disabled={busy || !network.active || (discovery?.networkId === network._id && !job.finished)}
              className={btn.outline}
              onClick={async () => {
                const started = await run(() => api<{ jobId: string }>(`/admin/scraper/networks/${network._id}/discover`, { method: 'POST' }));
                if (started) setDiscovery({ networkId: network._id, jobId: started.jobId });
              }}
            >
              Discover websites
            </button>
          </div>
        ))}
        {networks.length === 0 && !open && <p className="text-sm font-semibold text-muted py-2">No networks registered.</p>}
      </div>
    </Card>
  );
}

export default function NetworkPage() {
  const { refresh } = useOverview();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<NetworkView | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fingerprints, setFingerprints] = useState<Fingerprint[]>([]);
  const [providers, setProviders] = useState<ProviderPolicy[]>([]);
  const [adapters, setAdapters] = useState<AdapterListItem[]>([]);
  const [networks, setNetworks] = useState<AuthorisedNetwork[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  useEffect(() => {
    void api<Fingerprint[]>('/admin/scraper/fingerprints').then(setFingerprints).catch(() => {});
    void api<ProviderPolicy[]>('/admin/scraper/provider-policies').then(setProviders).catch(() => {});
    void api<AdapterListItem[]>('/admin/scraper/adapters').then(setAdapters).catch(() => {});
    void api<AuthorisedNetwork[]>('/admin/scraper/networks').then(setNetworks).catch(() => {});
    const fromUrl = new URLSearchParams(window.location.search).get('fingerprintId');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the initial filter comes from the URL, only readable after mount
    if (fromUrl) setFilters((f) => ({ ...f, fingerprintId: fromUrl }));
  }, []);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: '50', groupBy: filters.groupBy });
    for (const [key, value] of Object.entries(filters)) {
      if (key === 'groupBy' || value === '' || value === false) continue;
      params.set(key, String(value));
    }
    void api<NetworkView>(`/admin/scraper/network?${params}`).then(setView).catch(() => {});
  }, [filters, page]);
  useEffect(load, [load]);

  const names = useMemo(() => {
    const map = new Map<string, string>();
    fingerprints.forEach((f) => map.set(f._id, f.name));
    providers.forEach((p) => map.set(p._id, p.name));
    adapters.forEach((a) => map.set(a.key, a.name));
    return map;
  }, [fingerprints, providers, adapters]);

  const set = (patch: Partial<Filters>) => {
    setFilters({ ...filters, ...patch });
    setPage(1);
    setSelected(new Set());
  };

  async function bulk(action: (typeof BULK)[number]['action']) {
    const ids = [...selected];
    let reason: string | undefined;
    if (action === 'opt_out') {
      const answer = prompt(`Opt out ${ids.length} websites? Their imported offers are removed at once. Reason:`);
      if (answer === null) return;
      reason = answer || undefined;
    }
    const outcome = await run(() => api<{ succeeded?: number; failed?: number; queued?: number }>('/admin/scraper/network/bulk', { method: 'POST', body: JSON.stringify({ websiteIds: ids, action, reason }) }));
    if (outcome) {
      setResult(action === 'match_fingerprint' ? `${outcome.queued} match jobs queued` : `${outcome.succeeded} succeeded${outcome.failed ? `, ${outcome.failed} failed` : ''}`);
      setSelected(new Set());
      load();
      refresh();
    }
  }

  const allOnPage = !!view?.items.length && view.items.every((i) => selected.has(i._id));

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <SectionTitle>Website network</SectionTitle>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <select value={filters.status} onChange={(e) => set({ status: e.target.value })} className={inputClass}>
            <option value="">Any authorisation</option>
            {['authorised', 'pending_authorisation', 'awaiting_provider_review', 'opted_out'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
          <select value={filters.matchCategory} onChange={(e) => set({ matchCategory: e.target.value })} className={inputClass}>
            <option value="">Any template match</option>
            {['exact_match', 'high_confidence_match', 'possible_match', 'no_match'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
          <select value={filters.fingerprintId} onChange={(e) => set({ fingerprintId: e.target.value })} className={inputClass}>
            <option value="">Any template</option>
            {fingerprints.map((f) => <option key={f._id} value={f._id}>{f.name}</option>)}
          </select>
          <select value={filters.providerId} onChange={(e) => set({ providerId: e.target.value })} className={inputClass}>
            <option value="">Any provider</option>
            {providers.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
          </select>
          <select value={filters.adapterKey} onChange={(e) => set({ adapterKey: e.target.value })} className={inputClass}>
            <option value="">Any adapter</option>
            {adapters.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
          </select>
          <select value={filters.networkId} onChange={(e) => set({ networkId: e.target.value })} className={inputClass}>
            <option value="">Any network</option>
            {networks.map((n) => <option key={n._id} value={n._id}>{n.name}</option>)}
          </select>
          <input type="number" min={0} max={100} value={filters.minScore} onChange={(e) => set({ minScore: e.target.value })} placeholder="Minimum match score" className={inputClass} />
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-extrabold text-muted">Not checked since</span>
            <input type="date" value={filters.checkedBefore} onChange={(e) => set({ checkedBefore: e.target.value })} className={inputClass} />
          </label>
          <input value={filters.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search domains" className={inputClass} />
          <label className="flex items-center gap-2 text-sm font-bold">
            <input type="checkbox" className="accent-primary" checked={filters.hasErrors} onChange={(e) => set({ hasErrors: e.target.checked })} />
            Only websites with errors
          </label>
          <select value={filters.groupBy} onChange={(e) => set({ groupBy: e.target.value as Filters['groupBy'] })} className={inputClass}>
            <option value="fingerprint">Group by template</option>
            <option value="provider">Group by provider</option>
            <option value="adapter">Group by adapter</option>
          </select>
          <button className={btn.outline} onClick={() => set(EMPTY)}>Clear filters</button>
        </div>

        {view && view.groups.length > 0 && (
          <div className="flex gap-2 flex-wrap mt-4">
            {view.groups.map((group) => {
              const key = group.key;
              const label = key ? (names.get(key) ?? key) : `No ${filters.groupBy}`;
              const filterKey = filters.groupBy === 'fingerprint' ? 'fingerprintId' : filters.groupBy === 'provider' ? 'providerId' : 'adapterKey';
              return (
                <button key={key ?? 'none'} disabled={!key} className="text-[13px] font-bold px-3 py-1.5 rounded-full bg-surface border border-line hover:border-primary cursor-pointer disabled:cursor-default" onClick={() => key && set({ [filterKey]: key } as Partial<Filters>)}>
                  {label} · {group.count}
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <ErrorNote error={error} />
      {result && <div className="text-sm font-bold text-verified">{result}</div>}

      <Card>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <label className="flex items-center gap-2 text-sm font-bold">
            <input
              type="checkbox"
              className="accent-primary"
              checked={allOnPage}
              onChange={(e) => setSelected(e.target.checked ? new Set([...selected, ...(view?.items ?? []).map((i) => i._id)]) : new Set())}
            />
            {selected.size ? `${selected.size} selected` : `${view?.total ?? 0} websites`}
          </label>
          <div className="flex gap-2 flex-wrap">
            {BULK.map((b) => (
              <button key={b.action} disabled={busy || selected.size === 0} className={b.style} onClick={() => bulk(b.action)}>
                {b.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col divide-y divide-line">
          {view?.items.map((site) => (
            <label key={site._id} className="py-3 flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="accent-primary mt-1"
                checked={selected.has(site._id)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(site._id);
                  else next.delete(site._id);
                  setSelected(next);
                }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link href={`/admin/scraper/websites/${site._id}`} className="font-extrabold hover:text-primary" onClick={(e) => e.stopPropagation()}>{site.domain}</Link>
                  <StatusPill status={site.authorisationStatus} />
                  {site.paused && <StatusPill status="paused" label="paused" />}
                  {site.matchCategory && <StatusPill status={site.matchCategory} label={`${site.matchCategory.replace(/_/g, ' ')}${site.matchScore != null ? ` ${site.matchScore}` : ''}`} />}
                </div>
                <div className="text-[13px] font-semibold text-muted">
                  {[
                    site.fingerprintRef ? `template ${site.fingerprintRef.name}` : null,
                    site.providerRef ? `provider ${site.providerRef.name} (${site.providerRef.status})` : null,
                    site.networkRef ? `network ${site.networkRef.name}` : null,
                    site.adapterId ? `adapter ${site.adapterId} v${site.adapterVersion}` : null,
                    `checked ${formatDate(site.lastSuccessfulCheckAt)}`,
                    site.failureCount ? `${site.failureCount} failures: ${site.lastError ?? ''}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            </label>
          ))}
        </div>
        {view && view.items.length === 0 && <EmptyState>No websites match these filters.</EmptyState>}
        {view && <div className="mt-4"><Pager page={view.page} pages={view.pages} onChange={setPage} /></div>}
      </Card>

      <NetworksPanel providers={providers} onChanged={load} />
    </div>
  );
}
