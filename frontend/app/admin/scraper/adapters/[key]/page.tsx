'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AdapterDetail, AdapterVersion, SelectorConfig } from '@/lib/scraper-types';
import SelectorConfigEditor from '../../_components/SelectorConfigEditor';
import TestResults from '../../_components/TestResults';
import { useJob } from '../../_components/useJob';
import { btn, Card, ErrorNote, formatDate, inputClass, SectionTitle, StatusPill, useAction } from '../../_components/ui';

function VersionPanel({ adapterKey, version, onChanged }: { adapterKey: string; version: AdapterVersion; onChanged: () => void }) {
  const editable = version.status === 'draft' || version.status === 'testing';
  const [config, setConfig] = useState<SelectorConfig>(version.configuration as SelectorConfig);
  const [examples, setExamples] = useState(version.exampleDomains.join(', '));
  const [testJobId, setTestJobId] = useState<string | null>(version.status === 'testing' && !version.testedAt ? (version.lastTestJobRef ?? null) : null);
  const { job, finished } = useJob(testJobId, onChanged);
  const { busy, error, run } = useAction();
  const fingerprint = typeof version.fingerprintRef === 'object' ? version.fingerprintRef : null;

  const path = `/admin/scraper/adapters/${adapterKey}/versions/${version.version}`;
  async function save() {
    const saved = await run(() =>
      api(path, { method: 'PATCH', body: JSON.stringify({ configuration: config, exampleDomains: examples.split(',').map((d) => d.trim()).filter(Boolean) }) }),
    );
    if (saved) onChanged();
  }
  async function test() {
    if (editable && version.status === 'draft') await save();
    const started = await run(() => api<{ jobId: string }>(`${path}/test`, { method: 'POST' }));
    if (started) setTestJobId(started.jobId);
  }
  async function action(suffix: string, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    const done = await run(() => api(`${path}/${suffix}`, { method: 'POST' }));
    if (done) onChanged();
  }

  return (
    <Card>
      <SectionTitle
        aside={
          <div className="flex gap-2 flex-wrap">
            {editable && (
              <>
                <button disabled={busy} className={btn.outline} onClick={save}>Save</button>
                <button disabled={busy || (!!testJobId && !finished)} className={btn.dark} onClick={test}>
                  {testJobId && !finished ? 'Testing…' : 'Test on examples'}
                </button>
                <button disabled={busy || !version.testResults} className={btn.good} onClick={() => action('approve', 'Approve this version? It becomes the version websites on this template use.')}>
                  Approve
                </button>
              </>
            )}
            {!editable && (
              <button disabled={busy} className={btn.outline} onClick={() => action('new-version')}>
                Start a new version from this
              </button>
            )}
          </div>
        }
      >
        <span className="flex items-center gap-2 flex-wrap">
          Version {version.version} <StatusPill status={version.status} />
          {version.isCurrent && <StatusPill status="active" label="current" />}
        </span>
      </SectionTitle>
      <div className="text-[13px] font-semibold text-muted mb-4">
        {fingerprint ? <>Template <Link href={`/admin/scraper/fingerprints/${fingerprint._id}`} className="font-bold text-primary">{fingerprint.name}</Link> · </> : null}
        created {formatDate(version.createdAt)}
        {version.basedOnVersion ? ` from v${version.basedOnVersion}` : ''}
        {version.approvedAt ? ` · approved ${formatDate(version.approvedAt)}${version.approvedBy ? ` by ${version.approvedBy.name}` : ''}` : ''}
        {version.withdrawnAt ? ` · withdrawn ${formatDate(version.withdrawnAt)}${version.withdrawnReason ? `: ${version.withdrawnReason}` : ''}` : ''}
        {version.approvalRate != null ? ` · ${Math.round(version.approvalRate * 100)}% of its candidates approved` : ''}
      </div>
      <ErrorNote error={error} />
      <div className="flex flex-col gap-5">
        <label className="grid grid-cols-[140px_1fr] gap-2 items-center">
          <span className="text-[13px] font-extrabold">Example websites</span>
          <input value={examples} disabled={!editable} onChange={(e) => setExamples(e.target.value)} className={`${inputClass} text-[13px] py-2`} />
        </label>
        <SelectorConfigEditor value={config} onChange={setConfig} disabled={!editable} />
        {testJobId && !finished && <div className="text-sm font-bold text-muted">Test running: {job?.progress?.message ?? job?.status ?? 'queued'}</div>}
        {job && finished && job.status !== 'completed' && <div className="text-sm font-bold text-primary">The test run {job.status}: {job.errorLog?.at(-1)?.message}</div>}
        {version.testResults && <TestResults results={version.testResults} />}
      </div>
    </Card>
  );
}

export default function AdapterDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const [detail, setDetail] = useState<AdapterDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const { busy, error, run } = useAction();
  const load = useCallback(() => void api<AdapterDetail>(`/admin/scraper/adapters/${key}`).then(setDetail).catch(() => setNotFound(true)), [key]);
  useEffect(load, [load]);

  if (notFound) return <Card>Adapter not found.</Card>;
  if (!detail) return <div className="py-16 text-center text-muted font-bold">Loading…</div>;
  const current = detail.versions.find((v) => v.isCurrent);
  const selector = detail.versions[0].type === 'selector';

  async function rollback() {
    const reason = prompt('Why roll back? The current version is withdrawn and its open candidates are marked for re-extraction.');
    if (reason === null) return;
    const result = await run(() => api<{ withdrawn: string; current: string | null; candidatesNeedingReextraction: number }>(`/admin/scraper/adapters/${key}/rollback`, { method: 'POST', body: JSON.stringify({ reason: reason || undefined }) }));
    if (result) {
      alert(`Withdrew v${result.withdrawn}. ${result.current ? `v${result.current} is current again.` : 'No selector version is current; sites fall back to the built-in adapters.'} ${result.candidatesNeedingReextraction} candidates need re-extraction.`);
      load();
    }
  }
  async function rerun() {
    const version = prompt('Re-extract websites that used which version? Leave empty for all versions.') ?? null;
    if (version === null) return;
    const result = await run(() => api<{ websites: number; runsStarted: number }>(`/admin/scraper/adapters/${key}/rerun`, { method: 'POST', body: JSON.stringify({ version: version || undefined }) }));
    if (result) alert(`Started ${result.runsStarted} runs across ${result.websites} websites.`);
  }

  async function setRecheckInterval() {
    const answer = prompt('Hours between rechecks of websites this adapter reads. Leave empty for the default (24h, or 6h when an offer ends within 48h).', String(current?.recheckIntervalHours ?? ''));
    if (answer === null) return;
    const saved = await run(() =>
      api(`/admin/scraper/adapters/${key}/recheck`, { method: 'PATCH', body: JSON.stringify({ recheckIntervalHours: answer.trim() ? Number(answer) : null }) }),
    );
    if (saved) load();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Link href="/admin/scraper/adapters" className="text-[13px] font-bold text-muted hover:text-primary">← Adapters</Link>
            <h2 className="font-display text-2xl font-extrabold">{detail.versions[0].name}</h2>
            <div className="text-[13px] font-semibold text-muted">
              {key} · {current ? `v${current.version} is current` : 'no current version'} · {detail.affectedWebsites.length} websites ·{' '}
              rechecks {current?.recheckIntervalHours ? `every ${current.recheckIntervalHours}h` : 'on the default schedule'}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button disabled={busy} className={btn.outline} onClick={setRecheckInterval}>Recheck interval</button>
            {selector && (
              <>
                <button disabled={busy || !current} className={btn.danger} onClick={rollback}>Roll back current version</button>
                <button disabled={busy} className={btn.outline} onClick={rerun}>Re-extract its websites</button>
              </>
            )}
          </div>
        </div>
        <div className="mt-3"><ErrorNote error={error} /></div>
      </Card>

      {selector ? (
        detail.versions.map((version) => <VersionPanel key={version._id} adapterKey={key} version={version} onChanged={load} />)
      ) : (
        <Card>This is a built-in adapter defined in code. It can be paused from the adapters list.</Card>
      )}

      <Card>
        <SectionTitle>Websites using this adapter</SectionTitle>
        <div className="flex flex-col divide-y divide-line text-sm">
          {detail.affectedWebsites.map((site) => (
            <div key={site._id} className="py-2 flex items-center gap-3 flex-wrap">
              <Link href={`/admin/scraper/websites/${site._id}`} className="font-bold hover:text-primary">{site.domain}</Link>
              <span className="text-muted font-semibold">v{site.adapterVersion} · checked {formatDate(site.lastSuccessfulCheckAt)}</span>
              {site.matchCategory && <StatusPill status={site.matchCategory} label={`${site.matchCategory.replace(/_/g, ' ')} ${site.matchScore ?? ''}`} />}
            </div>
          ))}
          {detail.affectedWebsites.length === 0 && <p className="text-muted font-semibold py-2">No website has used it yet.</p>}
        </div>
      </Card>
    </div>
  );
}
