'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { FingerprintDetail, FingerprintMarker, Thresholds } from '@/lib/scraper-types';
import MarkerTable from '../../_components/MarkerTable';
import { useJob } from '../../_components/useJob';
import { btn, Card, ErrorNote, formatDate, inputClass, SectionTitle, StatusPill, useAction } from '../../_components/ui';

export default function FingerprintDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<FingerprintDetail | null>(null);
  const [markers, setMarkers] = useState<FingerprintMarker[]>([]);
  const [thresholds, setThresholds] = useState<Thresholds>({ exact: 95, high: 80, possible: 55 });
  const [jobId, setJobId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  const load = useCallback(
    () =>
      void api<FingerprintDetail>(`/admin/scraper/fingerprints/${id}`)
        .then((next) => {
          setDetail(next);
          setMarkers(next.fingerprint.markers);
          setThresholds(next.fingerprint.thresholds);
        })
        .catch(() => setNotice('Fingerprint not found')),
    [id],
  );
  const analysis = useJob(jobId, load);
  useEffect(load, [load]);

  if (!detail) return <div className="py-16 text-center text-muted font-bold">{notice ?? 'Loading…'}</div>;
  const { fingerprint } = detail;

  async function save(patch: Record<string, unknown>) {
    const saved = await run(() => api(`/admin/scraper/fingerprints/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }));
    if (saved) {
      setNotice('Saved');
      load();
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Link href="/admin/scraper/fingerprints" className="text-[13px] font-bold text-muted hover:text-primary">← Templates</Link>
            <h2 className="font-display text-2xl font-extrabold flex items-center gap-2 flex-wrap">
              {fingerprint.name} {!fingerprint.active && <StatusPill status="paused" label="inactive" />}
            </h2>
            <div className="text-[13px] font-semibold text-muted">
              v{fingerprint.version} · examples {fingerprint.exampleDomains.join(', ')} · analysed {formatDate(fingerprint.analysedAt)}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button disabled={busy || (!!jobId && !analysis.finished)} className={btn.outline} onClick={async () => {
              if (!confirm('Re-analyse the examples? Suggested traits replace the current ones.')) return;
              const started = await run(() => api<{ jobId: string }>(`/admin/scraper/fingerprints/${id}/analyse`, { method: 'POST' }));
              if (started) setJobId(started.jobId);
            }}>
              {jobId && !analysis.finished ? 'Analysing…' : 'Re-analyse examples'}
            </button>
            <button disabled={busy} className={btn.outline} onClick={async () => {
              const result = await run(() => api<{ queued: number }>('/admin/scraper/fingerprints/match', { method: 'POST', body: JSON.stringify({ allAuthorised: true }) }));
              if (result) setNotice(`${result.queued} match jobs queued`);
            }}>
              Match all authorised websites
            </button>
            <button disabled={busy} className={fingerprint.active ? btn.danger : btn.good} onClick={() => save({ active: !fingerprint.active })}>
              {fingerprint.active ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <ErrorNote error={error} />
          {notice && <div className="text-sm font-bold text-verified">{notice}</div>}
        </div>
      </Card>

      <Card>
        <SectionTitle aside={<button disabled={busy} className={btn.dark} onClick={() => save({ markers })}>Save traits</button>}>Traits ({markers.length})</SectionTitle>
        <MarkerTable markers={markers} onChange={setMarkers} />
      </Card>

      <Card>
        <SectionTitle>Match thresholds</SectionTitle>
        <div className="flex gap-3 flex-wrap items-end">
          {(['exact', 'high', 'possible'] as const).map((key) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="text-[12px] font-extrabold">{key === 'high' ? 'High confidence' : key === 'exact' ? 'Exact' : 'Possible'}</span>
              <input type="number" min={1} max={100} value={thresholds[key]} onChange={(e) => setThresholds({ ...thresholds, [key]: Number(e.target.value) })} className={`${inputClass} w-28`} />
            </label>
          ))}
          <button disabled={busy} className={btn.dark} onClick={() => save({ thresholds })}>Save thresholds</button>
        </div>
        <p className="text-[12px] font-semibold text-muted mt-3">
          Selector adapters run only on high-confidence or exact matches. Fewer than three matching kinds of trait caps a score at 54, and one kind at 30.
        </p>
      </Card>

      <Card>
        <SectionTitle>Matched websites ({detail.matchedSites.length})</SectionTitle>
        <div className="flex flex-col divide-y divide-line text-sm">
          {detail.matchedSites.map((site) => (
            <div key={site._id} className="py-2 flex items-center gap-2 flex-wrap">
              <Link href={`/admin/scraper/websites/${site._id}`} className="font-bold hover:text-primary">{site.domain}</Link>
              {site.matchCategory && <StatusPill status={site.matchCategory} label={`${site.matchCategory.replace(/_/g, ' ')} ${site.matchScore ?? ''}`} />}
              <StatusPill status={site.authorisationStatus} />
              {site.adapterId && <span className="text-muted font-semibold">{site.adapterId} v{site.adapterVersion}</span>}
            </div>
          ))}
        </div>
        {detail.adapters.length > 0 && (
          <div className="mt-4 text-sm font-semibold">
            Adapters:{' '}
            {detail.adapters.map((a) => (
              <Link key={a._id} href={`/admin/scraper/adapters/${a.key}`} className="text-primary font-bold mr-3">{a.name} v{a.version} ({a.status})</Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
