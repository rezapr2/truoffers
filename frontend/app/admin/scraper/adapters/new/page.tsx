'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type {
  AdapterDetail,
  Fingerprint,
  FingerprintDetail,
  FingerprintMarker,
  NetworkView,
  Paged,
  SelectorConfig,
  WebsiteListItem,
} from '@/lib/scraper-types';
import MarkerTable from '../../_components/MarkerTable';
import SelectorConfigEditor, { EMPTY_CONFIG } from '../../_components/SelectorConfigEditor';
import TestResults from '../../_components/TestResults';
import { useJob } from '../../_components/useJob';
import { btn, Card, ErrorNote, inputClass, SectionTitle, StatusPill, useAction } from '../../_components/ui';

const STEPS = ['Choose examples', 'Structural analysis', 'Review selectors', 'Test on examples', 'Approve', 'Run on matching websites'];

function StepHeader({ step }: { step: number }) {
  return (
    <ol className="flex gap-2 flex-wrap">
      {STEPS.map((label, i) => (
        <li
          key={label}
          className={`text-[13px] font-bold px-3 py-1.5 rounded-full ${i === step ? 'bg-tint-blue text-primary' : i < step ? 'bg-verified/10 text-verified' : 'bg-card border border-line text-muted'}`}
        >
          {i + 1}. {label}
        </li>
      ))}
    </ol>
  );
}

export default function AdapterBuilderPage() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [websites, setWebsites] = useState<WebsiteListItem[]>([]);
  const [selected, setSelected] = useState<WebsiteListItem[]>([]);
  const [fingerprintJob, setFingerprintJob] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<Fingerprint | null>(null);
  const [markers, setMarkers] = useState<FingerprintMarker[]>([]);
  const [config, setConfig] = useState<SelectorConfig>(EMPTY_CONFIG);
  const [adapterKey, setAdapterKey] = useState<string | null>(null);
  const [testJob, setTestJob] = useState<string | null>(null);
  const [adapter, setAdapter] = useState<AdapterDetail | null>(null);
  const [matchQueued, setMatchQueued] = useState<number | null>(null);
  const [matched, setMatched] = useState<NetworkView | null>(null);
  const [runSummary, setRunSummary] = useState<string | null>(null);
  async function loadFingerprint(id: string) {
    const detail = await api<FingerprintDetail>(`/admin/scraper/fingerprints/${id}`);
    setFingerprint(detail.fingerprint);
    setMarkers(detail.fingerprint.markers);
    setConfig(detail.fingerprint.suggestedConfig?.config ?? EMPTY_CONFIG);
  }

  const analysis = useJob(fingerprintJob, (job) => {
    if (job.status === 'completed' && fingerprint) void loadFingerprint(fingerprint._id);
  });
  const testing = useJob(testJob, () => {
    if (adapterKey) void api<AdapterDetail>(`/admin/scraper/adapters/${adapterKey}`).then(setAdapter).catch(() => {});
  });
  const { busy, error, setError, run } = useAction();

  useEffect(() => {
    const params = new URLSearchParams({ status: 'authorised', limit: '50' });
    if (query.trim()) params.set('q', query.trim());
    void api<Paged<WebsiteListItem>>(`/admin/scraper/websites?${params}`).then((page) => setWebsites(page.items)).catch(() => {});
  }, [query]);

  const draft = adapter?.versions.find((v) => v.status === 'draft' || v.status === 'testing') ?? adapter?.versions[0];

  async function analyse() {
    const created = await run(() =>
      api<{ fingerprint: Fingerprint; jobId: string }>('/admin/scraper/fingerprints', {
        method: 'POST',
        body: JSON.stringify({ name, exampleWebsiteIds: selected.map((s) => s._id) }),
      }),
    );
    if (!created) return;
    setFingerprint(created.fingerprint);
    setFingerprintJob(created.jobId);
    setStep(1);
  }

  async function saveMarkersAndContinue() {
    if (!fingerprint) return;
    const saved = await run(() => api(`/admin/scraper/fingerprints/${fingerprint._id}`, { method: 'PATCH', body: JSON.stringify({ markers }) }));
    if (saved) setStep(2);
  }

  async function saveAndTest() {
    if (!fingerprint) return;
    const exampleDomains = selected.map((s) => s.domain);
    const key = await run(async () => {
      if (!adapterKey) {
        const created = await api<{ key: string }>('/admin/scraper/adapters', {
          method: 'POST',
          body: JSON.stringify({ name, fingerprintId: fingerprint._id, exampleDomains, configuration: config }),
        });
        return created.key;
      }
      await api(`/admin/scraper/adapters/${adapterKey}/versions/${draft?.version ?? '1'}`, { method: 'PATCH', body: JSON.stringify({ configuration: config, exampleDomains }) });
      return adapterKey;
    });
    if (!key) return;
    setAdapterKey(key);
    const started = await run(() => api<{ jobId: string }>(`/admin/scraper/adapters/${key}/versions/${draft?.version ?? '1'}/test`, { method: 'POST' }));
    if (!started) return;
    setAdapter(null);
    setTestJob(started.jobId);
    setStep(3);
  }

  async function approve() {
    if (!adapterKey || !draft) return;
    const approved = await run(() => api(`/admin/scraper/adapters/${adapterKey}/versions/${draft.version}/approve`, { method: 'POST' }));
    if (approved) setStep(5);
  }

  async function matchNetwork() {
    const result = await run(() => api<{ websites: number; queued: number }>('/admin/scraper/fingerprints/match', { method: 'POST', body: JSON.stringify({ allAuthorised: true }) }));
    if (result) setMatchQueued(result.queued);
  }

  async function refreshMatched() {
    if (!fingerprint) return;
    const [exact, high] = await Promise.all(
      ['exact_match', 'high_confidence_match'].map((category) =>
        api<NetworkView>(`/admin/scraper/network?fingerprintId=${fingerprint._id}&matchCategory=${category}&limit=200`),
      ),
    );
    setMatched({ ...exact, items: [...exact.items, ...high.items], total: exact.total + high.total });
  }

  async function runMatched() {
    if (!matched?.items.length) return;
    const result = await run(() =>
      api<{ succeeded: number; failed: number }>('/admin/scraper/network/bulk', { method: 'POST', body: JSON.stringify({ websiteIds: matched.items.map((i) => i._id), action: 'run' }) }),
    );
    if (result) setRunSummary(`Started extraction on ${result.succeeded} websites${result.failed ? `; ${result.failed} could not start` : ''}.`);
  }

  const offersPerExample = fingerprint?.examples.map((e) => e.offersFound.length) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/scraper/adapters" className="text-[13px] font-bold text-muted hover:text-primary">← Adapters</Link>
        <h2 className="font-display text-2xl font-extrabold mb-3">Build a selector adapter</h2>
        <StepHeader step={step} />
      </div>
      <ErrorNote error={error} />

      {step === 0 && (
        <Card>
          <SectionTitle>1. Choose two or more authorised websites built on the same template</SectionTitle>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-extrabold">Adapter name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Saffron Theme" className={inputClass} />
            </label>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search authorised websites" className={inputClass} />
            <div className="flex flex-col divide-y divide-line max-h-80 overflow-y-auto border border-line rounded-xl">
              {websites.map((site) => {
                const checked = selected.some((s) => s._id === site._id);
                return (
                  <label key={site._id} className="flex items-center gap-3 px-4 py-2 text-sm font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={checked}
                      onChange={(e) => setSelected(e.target.checked ? [...selected, site] : selected.filter((s) => s._id !== site._id))}
                    />
                    <span className="font-bold">{site.domain}</span>
                    {site.adapterId && <span className="text-muted">{site.adapterId}</span>}
                  </label>
                );
              })}
              {websites.length === 0 && <p className="px-4 py-3 text-sm text-muted font-semibold">No authorised websites match.</p>}
            </div>
            <div className="flex items-center gap-3">
              <button disabled={busy || selected.length < 2 || name.trim().length < 2} className={btn.dark} onClick={analyse}>
                Analyse {selected.length} example{selected.length === 1 ? '' : 's'}
              </button>
              <span className="text-[12px] font-semibold text-muted">The worker reads each example’s homepage and offer pages, following the usual crawl rules.</span>
            </div>
          </div>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <SectionTitle>2. Structural analysis</SectionTitle>
          {!analysis.finished && <p className="text-sm font-bold text-muted">Analysing: {analysis.job?.progress?.message ?? analysis.job?.status ?? 'queued'}…</p>}
          {analysis.finished && !analysis.succeeded && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-bold text-primary">The analysis {analysis.job?.status}: {analysis.job?.errorLog?.at(-1)?.message}</p>
              <button className={btn.outline} onClick={() => setStep(0)}>Choose different examples</button>
            </div>
          )}
          {analysis.succeeded && fingerprint?.analysedAt && (
            <div className="flex flex-col gap-4">
              <div className="grid md:grid-cols-2 gap-3">
                {fingerprint.examples.map((example) => (
                  <div key={example.domain} className="border border-line rounded-xl px-4 py-3 text-[13px] font-semibold">
                    <div className="font-extrabold">{example.domain}</div>
                    {example.error ? (
                      <div className="text-primary font-bold">{example.error}</div>
                    ) : (
                      <>
                        <div className="text-muted">{example.pages.length} pages · {example.markers} traits · {example.offersFound.length} offers found</div>
                        <ul className="list-disc pl-5 mt-1">{example.offersFound.slice(0, 5).map((o) => <li key={o.title}>{o.title}</li>)}</ul>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[13px] font-semibold text-muted">
                Traits every example shares. Required traits must be present for a confident match; a negative trait rules a site out. Remove anything too generic.
              </p>
              <MarkerTable markers={markers} onChange={setMarkers} />
              <div>
                <button disabled={busy || markers.length === 0 || offersPerExample.some((n) => n === 0)} className={btn.dark} onClick={saveMarkersAndContinue}>
                  Save traits and review selectors
                </button>
                {offersPerExample.some((n) => n === 0) && <p className="text-[12px] font-bold text-primary mt-2">Every example needs at least one offer for selectors to be suggested.</p>}
              </div>
            </div>
          )}
        </Card>
      )}

      {step === 2 && (
        <Card>
          <SectionTitle>3. Review the suggested selectors</SectionTitle>
          {fingerprint?.suggestedConfig?.notes.length ? (
            <ul className="text-[13px] font-semibold text-ink-soft list-disc pl-5 mb-4">{fingerprint.suggestedConfig.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          ) : null}
          <SelectorConfigEditor value={config} onChange={setConfig} />
          <div className="mt-5 flex gap-2">
            <button disabled={busy || !config.offers.container || !config.offers.fields.title.selector} className={btn.dark} onClick={saveAndTest}>
              Save as draft and test
            </button>
            <button className={btn.outline} onClick={() => setStep(1)}>Back</button>
          </div>
        </Card>
      )}

      {(step === 3 || step === 4) && (
        <Card>
          <SectionTitle>4. Test on the examples</SectionTitle>
          {!testing.finished && <p className="text-sm font-bold text-muted">Testing: {testing.job?.progress?.message ?? testing.job?.status ?? 'queued'}…</p>}
          {testing.finished && !testing.succeeded && <p className="text-sm font-bold text-primary">The test run {testing.job?.status}: {testing.job?.errorLog?.at(-1)?.message}</p>}
          {draft?.testResults && <TestResults results={draft.testResults} />}
          {testing.finished && (
            <div className="mt-5 flex gap-2 flex-wrap">
              <button className={btn.outline} onClick={() => { setError(null); setStep(2); }}>Adjust selectors</button>
              <button
                disabled={busy || !draft?.testResults || draft.testResults.summary.handled < draft.testResults.summary.domains || draft.testResults.summary.offers === 0}
                className={btn.good}
                onClick={approve}
              >
                5. Approve version {draft?.version}
              </button>
            </div>
          )}
        </Card>
      )}

      {step === 5 && fingerprint && (
        <Card>
          <SectionTitle>6. Run on the approved website list</SectionTitle>
          <p className="text-[13px] font-semibold text-muted mb-4">
            The adapter runs only on authorised websites that match the {fingerprint.name} template with high confidence. Match every authorised website, then start
            extraction on the ones that match.
          </p>
          <div className="flex flex-col gap-3">
            <div className="flex gap-2 flex-wrap items-center">
              <button disabled={busy} className={btn.dark} onClick={matchNetwork}>Match all authorised websites</button>
              {matchQueued !== null && <span className="text-sm font-bold text-muted">{matchQueued} match jobs queued. Refresh once they finish.</span>}
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              <button disabled={busy} className={btn.outline} onClick={refreshMatched}>Show matching websites</button>
              {matched && <span className="text-sm font-bold">{matched.total} match with high confidence</span>}
            </div>
            {matched?.items.map((site) => (
              <div key={site._id} className="text-sm font-semibold flex items-center gap-2">
                {site.domain} <StatusPill status={site.matchCategory ?? 'no_match'} label={`${(site.matchCategory ?? '').replace(/_/g, ' ')} ${site.matchScore ?? ''}`} />
              </div>
            ))}
            {matched && matched.items.length > 0 && (
              <div>
                <button disabled={busy} className={btn.good} onClick={runMatched}>Start extraction on these websites</button>
              </div>
            )}
            {runSummary && <p className="text-sm font-bold text-verified">{runSummary}</p>}
            <div className="flex gap-3 text-sm font-bold">
              {adapterKey && <Link className="text-primary" href={`/admin/scraper/adapters/${adapterKey}`}>Open the adapter</Link>}
              <Link className="text-primary" href={`/admin/scraper/network?fingerprintId=${fingerprint._id}`}>Open in the website network</Link>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
