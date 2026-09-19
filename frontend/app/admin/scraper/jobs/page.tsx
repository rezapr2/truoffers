'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { ImportJob, JobStatus, Paged, QueueStatus } from '@/lib/scraper-types';
import { useOverview } from '../_components/overview';
import { btn, Card, EmptyState, ErrorNote, formatDate, inputClass, Pager, SectionTitle, StatusPill, useAction } from '../_components/ui';

const STATUSES: ('' | JobStatus)[] = ['', 'queued', 'running', 'delayed', 'completed', 'failed', 'cancelled', 'dead_lettered'];
const TYPES = ['', 'analyse_seed_website', 'discover_offer_pages', 'extract_business', 'extract_offers', 'match_business', 'deduplicate_offers', 'recheck_offer', 'review_stale_offer', 'render_pages'];
const ACTIVE: JobStatus[] = ['queued', 'running', 'delayed'];

function LogsDrawer({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const [job, setJob] = useState<ImportJob | null>(null);
  useEffect(() => {
    const load = () => void api<ImportJob>(`/admin/scraper/jobs/${jobId}`).then(setJob).catch(() => {});
    load();
    const timer = setInterval(load, 3_000);
    return () => clearInterval(timer);
  }, [jobId]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" onClick={onClose}>
      <div className="h-full w-full max-w-2xl bg-surface p-6 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl font-extrabold">{job ? job.type.replace(/_/g, ' ') : 'Job'} logs</h2>
          <button className={btn.outline} onClick={onClose}>Close</button>
        </div>
        {!job && <div className="text-muted font-bold">Loading…</div>}
        {job && (
          <div className="flex flex-col gap-4">
            <div className="text-[13px] font-semibold text-ink-soft">
              {job.domain} · <StatusPill status={job.status} /> · attempts {job.attempts} · started {formatDate(job.startedAt)} · finished {formatDate(job.finishedAt)}
              {job.resultCounts && Object.keys(job.resultCounts).length > 0 && (
                <div className="mt-1">Results: {Object.entries(job.resultCounts).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(' · ')}</div>
              )}
            </div>
            {job.errorLog && job.errorLog.length > 0 && (
              <div className="bg-card border border-line rounded-xl p-4">
                <div className="text-[12px] font-extrabold uppercase text-primary mb-2">Errors</div>
                {job.errorLog.map((e, i) => (
                  <div key={i} className="text-[13px] font-semibold">
                    {formatDate(e.at)} · attempt {e.attempt} · {e.code ? `${e.code}: ` : ''}{e.message}{e.retryable ? '' : ' (not retryable)'}
                  </div>
                ))}
              </div>
            )}
            <div className="bg-ink text-surface rounded-xl p-4 font-mono text-[12px] leading-relaxed">
              {(job.logs ?? []).map((line, i) => (
                <div key={i} className={line.level === 'error' ? 'text-red-300' : line.level === 'warn' ? 'text-star' : ''}>
                  {new Date(line.at).toLocaleTimeString('en-GB')} {line.level.toUpperCase()} {line.message}
                  {line.data ? ` ${JSON.stringify(line.data)}` : ''}
                </div>
              ))}
              {(job.logs ?? []).length === 0 && <div className="opacity-60">No log lines yet.</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function JobsPage() {
  const { refresh } = useOverview();
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [jobs, setJobs] = useState<Paged<ImportJob> | null>(null);
  const [filters, setFilters] = useState({ status: '' as '' | JobStatus, type: '', domain: '' });
  const [page, setPage] = useState(1);
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: '50' });
    if (filters.status) params.set('status', filters.status);
    if (filters.type) params.set('type', filters.type);
    if (filters.domain.trim()) params.set('domain', filters.domain.trim());
    void api<Paged<ImportJob>>(`/admin/scraper/jobs?${params}`).then(setJobs).catch(() => {});
    void api<QueueStatus>('/admin/scraper/jobs/status').then(setStatus).catch(() => {});
  }, [filters, page]);

  // Progress refreshes every 3 seconds while this page is open.
  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 3_000);
    return () => clearInterval(timer);
  }, [load]);

  async function act(path: string, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    await run(() => api(`/admin/scraper/jobs/${path}`, { method: 'POST' }));
    load();
    refresh();
  }

  const totals = status
    ? Object.values(status.queues).reduce(
        (sum, q) => ({ waiting: sum.waiting + q.waiting, active: sum.active + q.active, delayed: sum.delayed + q.delayed, failed: sum.failed + q.failed }),
        { waiting: 0, active: 0, delayed: 0, failed: 0 },
      )
    : null;

  return (
    <div className="flex flex-col gap-6">
      <Card className={status?.halted ? 'border-2 border-danger' : ''}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-display text-lg font-extrabold">
              {status?.halted ? 'Emergency stop is active' : status?.paused ? 'Queues are paused' : 'Robot running'}
            </h2>
            <div className="text-[13px] font-semibold text-muted mt-1">
              {status ? (
                <>
                  {status.workers.length} worker{status.workers.length === 1 ? '' : 's'} online
                  {status.workers.length > 0 && ` (${status.workers.map((w) => w.id.split(':')[0]).join(', ')})`}
                  {totals && ` · ${totals.active} active · ${totals.waiting} waiting · ${totals.delayed} delayed · ${totals.failed} failed in queue`}
                </>
              ) : (
                'Loading…'
              )}
            </div>
            {status && status.workers.length === 0 && (
              <div className="text-[13px] font-bold text-primary mt-1">No worker is running: queued jobs wait until one starts.</div>
            )}
          </div>
          {status?.halted || status?.paused ? (
            <button disabled={busy} className={btn.good} onClick={() => act('resume', 'Resume crawling? Paused and halted jobs will continue.')}>
              Resume
            </button>
          ) : (
            <button
              disabled={busy}
              className={btn.primary}
              onClick={() => act('emergency-stop', 'Stop all crawling now? In-flight requests are aborted and nothing runs until you resume.')}
            >
              Emergency stop
            </button>
          )}
        </div>
      </Card>

      <ErrorNote error={error} />

      <div className="flex gap-3 flex-wrap">
        <select value={filters.status} onChange={(e) => { setFilters({ ...filters, status: e.target.value as '' | JobStatus }); setPage(1); }} className={inputClass}>
          {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'Any status'}</option>)}
        </select>
        <select value={filters.type} onChange={(e) => { setFilters({ ...filters, type: e.target.value }); setPage(1); }} className={inputClass}>
          {TYPES.map((t) => <option key={t} value={t}>{t ? t.replace(/_/g, ' ') : 'Any stage'}</option>)}
        </select>
        <input value={filters.domain} onChange={(e) => { setFilters({ ...filters, domain: e.target.value }); setPage(1); }} placeholder="Domain" className={inputClass} />
      </div>

      <Card>
        <SectionTitle>Stage jobs</SectionTitle>
        <div className="flex flex-col divide-y divide-line">
          {jobs?.items.map((job) => {
            const pct = job.progress?.total ? Math.min(100, Math.round((job.progress.current / job.progress.total) * 100)) : null;
            return (
              <div key={job._id} className="py-3 flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-extrabold">{job.type.replace(/_/g, ' ')}</span>
                    <StatusPill status={job.status} />
                    <span className="text-[13px] font-bold text-muted">{job.domain}</span>
                  </div>
                  <div className="text-[12px] font-semibold text-muted mt-0.5">
                    Run {String(job.runId).slice(-6)} · created {formatDate(job.createdAt)}
                    {job.durationMs ? ` · ${(job.durationMs / 1000).toFixed(1)}s` : ''}
                    {job.attempts > 1 ? ` · attempt ${job.attempts}` : ''}
                    {job.progress?.message ? ` · ${job.progress.message}` : ''}
                    {job.submittedBy ? ` · by ${job.submittedBy.name}` : ''}
                  </div>
                  {pct !== null && ACTIVE.includes(job.status) && (
                    <div className="h-1.5 bg-page rounded-full mt-2 max-w-md overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button className={btn.outline} onClick={() => setLogsFor(job._id)}>Logs</button>
                  {(job.status === 'failed' || job.status === 'dead_lettered') && (
                    <button disabled={busy} className={btn.outline} onClick={() => act(`${job._id}/retry`)}>Retry</button>
                  )}
                  {ACTIVE.includes(job.status) && (
                    <button disabled={busy} className={btn.danger} onClick={() => act(`runs/${job.runId}/cancel`, 'Cancel this whole run?')}>
                      Cancel run
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {jobs && jobs.items.length === 0 && <EmptyState>No jobs match. <Link href="/admin/scraper/websites" className="text-primary font-bold">Submit a website</Link>.</EmptyState>}
        {jobs && <div className="mt-4"><Pager page={jobs.page} pages={jobs.pages} onChange={setPage} /></div>}
      </Card>

      {logsFor && <LogsDrawer jobId={logsFor} onClose={() => setLogsFor(null)} />}
    </div>
  );
}
