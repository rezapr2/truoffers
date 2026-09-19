'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { ProviderPolicy, WebsiteDetail } from '@/lib/scraper-types';
import BranchDecision from '../../_components/BranchDecision';
import { useOverview } from '../../_components/overview';
import { btn, Card, ErrorNote, formatDate, humanise, inputClass, SectionTitle, StatusPill, useAction } from '../../_components/ui';

export default function WebsiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { refresh } = useOverview();
  const [data, setData] = useState<WebsiteDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [config, setConfig] = useState({ rateLimitMs: '', pageCap: '', recheckIntervalHours: '' });
  const [consent, setConsent] = useState('');
  const [providers, setProviders] = useState<ProviderPolicy[]>([]);
  // null: the provider dropdown hasn't been touched, so it shows the website's current one.
  const [linkTo, setLinkTo] = useState<string | null>(null);
  const { user } = useAuth();
  const { busy, error, run } = useAction();

  const load = useCallback(() => {
    void api<WebsiteDetail>(`/admin/scraper/websites/${id}`)
      .then((detail) => {
        setData(detail);
        setConfig({
          rateLimitMs: String(detail.config?.rateLimitMs ?? ''),
          pageCap: String(detail.config?.pageCap ?? ''),
          recheckIntervalHours: String(detail.config?.recheckIntervalHours ?? ''),
        });
      })
      .catch(() => setNotFound(true));
  }, [id]);

  useEffect(load, [load]);
  // Linking a website to a provider is for super admins, who can also extend the provider's agreement that way.
  useEffect(() => {
    if (user?.role === 'super_admin') void api<ProviderPolicy[]>('/admin/scraper/provider-policies').then(setProviders).catch(() => {});
  }, [user?.role]);

  if (notFound) return <Card>Website not found.</Card>;
  if (!data) return <div className="py-16 text-center text-muted font-bold">Loading…</div>;
  const { site } = data;
  const provider = typeof site.providerRef === 'object' ? site.providerRef : null;
  // The provider's written agreement sets robots.txt aside for every website linked to it.
  const providerCovers = !!provider?.robotsOverride && provider.status === 'allowed' && provider.basis === 'written_agreement' && !!provider.agreementReference;
  const isSuperAdmin = user?.role === 'super_admin';
  const paused = data.config?.paused;

  async function act(path: string, method: string, body?: unknown) {
    const ok = await run(() => api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }));
    if (ok !== undefined) {
      load();
      refresh();
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="font-display text-2xl font-extrabold break-all">{site.domain}</h2>
              <StatusPill status={site.authorisationStatus} />
              {paused && <StatusPill status="paused" label="crawling paused" />}
            </div>
            <a href={site.seedUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-primary break-all">
              {site.seedUrl}
            </a>
            <dl className="mt-3 text-[13px] font-semibold text-ink-soft grid sm:grid-cols-2 gap-x-8 gap-y-1">
              <div>Source: {humanise(site.authorisationSource)}{site.discoveredFrom ? ` (from ${site.discoveredFrom})` : ''}</div>
              <div>Provider: {provider ? `${provider.name} · ${provider.status}` : 'none detected'}</div>
              <div>Adapter: {site.adapterId ? `${site.adapterId} ${site.adapterVersion}` : '—'}</div>
              <div>
                robots.txt: {site.robots?.status ?? '—'}{site.robots?.crawlDelaySec ? ` · crawl delay ${site.robots.crawlDelaySec}s` : ''}
                {site.robotsOverride && ' · not applied (owner’s consent on record)'}
                {!site.robotsOverride && providerCovers && ` · not applied (${provider!.name}’s agreement)`}
              </div>
              <div>Last checked: {formatDate(site.lastSuccessfulCheckAt)}</div>
              <div>Failures: {site.failureCount}{site.lastError ? ` · ${site.lastError}` : ''}</div>
              <div>Next check: {formatDate(site.nextCheckAt)}</div>
              {site.providerSignals.length > 0 && <div className="sm:col-span-2">Provider signals: {site.providerSignals.join(', ')}</div>}
              {site.authorisationNote && <div className="sm:col-span-2">Note: {site.authorisationNote}</div>}
            </dl>
          </div>
          <div className="flex gap-2 flex-wrap">
            {site.authorisationStatus === 'authorised' && (
              <button disabled={busy} className={btn.dark} onClick={() => act(`/admin/scraper/websites/${id}/analyse`, 'POST')}>
                Analyse now
              </button>
            )}
            {site.authorisationStatus === 'pending_authorisation' && (
              <>
                <button disabled={busy} className={btn.good} onClick={() => act(`/admin/scraper/websites/${id}/authorise`, 'PATCH', { decision: 'approve' })}>
                  Authorise
                </button>
                <button disabled={busy} className={btn.danger} onClick={() => act(`/admin/scraper/websites/${id}/authorise`, 'PATCH', { decision: 'deny' })}>
                  Deny
                </button>
              </>
            )}
            <button
              disabled={busy}
              className={btn.outline}
              onClick={() => {
                const reason = paused ? undefined : prompt('Why pause crawling this website? (optional)') ?? undefined;
                void act(`/admin/scraper/websites/${id}/pause`, 'PATCH', { paused: !paused, reason });
              }}
            >
              {paused ? 'Resume crawling' : 'Pause crawling'}
            </button>
            <Link href={`/admin/scraper/candidates?websiteId=${id}`} className={btn.outline}>
              Candidates ({Object.values(data.candidates).reduce((a, b) => a + (b ?? 0), 0)})
            </Link>
          </div>
        </div>
        <div className="mt-4"><ErrorNote error={error} /></div>
      </Card>

      {(site.robotsOverride || providerCovers || (isSuperAdmin && site.authorisationStatus === 'authorised')) && (
        <Card>
          <SectionTitle>Read despite robots.txt</SectionTitle>
          {providerCovers && (
            <p className="mb-3 text-[13px] font-semibold text-ink-soft">
              robots.txt is not applied here because {provider!.name}’s written agreement ({provider!.agreementReference}) covers reading the websites it hosts:{' '}
              <span className="text-ink">{provider!.robotsOverride!.note}</span>. An opt-out or a removal request still ends it at once.
            </p>
          )}
          {isSuperAdmin && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(`/admin/scraper/websites/${id}/provider`, 'PUT', { providerId: linkTo || null }).then(() => setLinkTo(null));
              }}
              className="mb-4 flex flex-wrap items-end gap-2"
            >
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-extrabold">Hosted by</span>
                <select value={linkTo ?? provider?._id ?? ''} onChange={(e) => setLinkTo(e.target.value)} className={`${inputClass} w-56`}>
                  <option value="">No provider</option>
                  {providers.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                </select>
              </label>
              <button disabled={busy || (linkTo ?? provider?._id ?? '') === (provider?._id ?? '')} className={btn.outline}>Save</button>
              <span className="basis-full text-[12px] font-semibold text-muted">
                Set this when a website blocks the robot from reading its homepage, so it can’t be recognised as the provider’s and the provider’s agreement can apply.
              </span>
            </form>
          )}
          {site.robotsOverride ? (
            <div className="flex flex-col gap-3">
              <p className="text-[13px] font-semibold text-ink-soft">
                robots.txt is not applied to this website. Every other check still is: opt-outs, the never-crawl list, pauses, blocked paths
                and the rate limit. An opt-out or a removal request ends this at once.
              </p>
              <blockquote className="border-l-4 border-line pl-3 text-sm font-semibold">
                {site.robotsOverride.note}
                <span className="block text-[12px] text-muted mt-1">Recorded {formatDate(site.robotsOverride.recordedAt)}</span>
              </blockquote>
              {user?.role === 'super_admin' && (
                <div>
                  <button disabled={busy} className={btn.outline} onClick={() => act(`/admin/scraper/websites/${id}/robots-override`, 'DELETE')}>
                    Apply robots.txt again
                  </button>
                </div>
              )}
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!confirm(`Read ${site.domain} even though its robots.txt asks bots to stay away? Only do this with the owner’s written consent.`)) return;
                void act(`/admin/scraper/websites/${id}/robots-override`, 'PUT', { note: consent }).then(() => setConsent(''));
              }}
              className="flex flex-col gap-3"
            >
              <p className="text-[13px] font-semibold text-ink-soft">
                Only with the owner’s written consent to list their offers, for example when their platform’s robots.txt blocks every bot by mistake.
                It applies to this website alone, is recorded in the audit log, and doesn’t change the rate limit or any other check.
              </p>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-extrabold">Who agreed, how and when *</span>
                <textarea
                  required
                  minLength={10}
                  maxLength={500}
                  rows={2}
                  value={consent}
                  onChange={(e) => setConsent(e.target.value)}
                  placeholder="e.g. Owner replied “yes” to our WhatsApp message on 19 Sep 2026"
                  className={inputClass}
                />
              </label>
              <div>
                <button disabled={busy || consent.trim().length < 10} className={btn.dark}>Read despite robots.txt</button>
              </div>
            </form>
          )}
        </Card>
      )}

      <Card>
        <SectionTitle>Crawl limits for this domain</SectionTitle>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(`/admin/scraper/websites/${id}/crawl-config`, 'PATCH', {
              rateLimitMs: config.rateLimitMs ? Number(config.rateLimitMs) : undefined,
              pageCap: config.pageCap ? Number(config.pageCap) : undefined,
              // null clears the override, so the adapter's or the default interval applies again.
              recheckIntervalHours: config.recheckIntervalHours ? Number(config.recheckIntervalHours) : null,
            });
          }}
          className="flex gap-3 flex-wrap items-end"
        >
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-extrabold">Milliseconds between requests</span>
            <input type="number" min={250} value={config.rateLimitMs} onChange={(e) => setConfig({ ...config, rateLimitMs: e.target.value })} placeholder="default" className={`${inputClass} w-44`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-extrabold">Pages per run</span>
            <input type="number" min={1} max={1000} value={config.pageCap} onChange={(e) => setConfig({ ...config, pageCap: e.target.value })} placeholder="default" className={`${inputClass} w-32`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-extrabold">Hours between rechecks</span>
            <input
              type="number"
              min={1}
              max={720}
              value={config.recheckIntervalHours}
              onChange={(e) => setConfig({ ...config, recheckIntervalHours: e.target.value })}
              placeholder="default"
              className={`${inputClass} w-40`}
            />
          </label>
          <button disabled={busy} className={btn.dark}>Save</button>
          {data.config?.blockedPaths?.length ? (
            <span className="text-[12px] font-semibold text-muted">Blocked paths: {data.config.blockedPaths.join(', ')}</span>
          ) : null}
        </form>
      </Card>

      <Card>
        <SectionTitle>Branches ({site.businesses.length})</SectionTitle>
        <div className="flex flex-col gap-3">
          {site.businesses.map((branch) => (
            <BranchDecision key={branch.branchPath} websiteId={site._id} branch={branch} onDone={() => { load(); refresh(); }} />
          ))}
          {site.businesses.length === 0 && <p className="text-sm font-semibold text-muted">No business details extracted yet.</p>}
        </div>
      </Card>

      <Card>
        <SectionTitle aside={<Link href="/admin/scraper/jobs" className="text-sm font-bold text-primary">All jobs →</Link>}>Runs</SectionTitle>
        <div className="flex flex-col gap-3">
          {data.runs.map((runGroup) => (
            <div key={runGroup.runId} className="border border-line rounded-xl px-4 py-3">
              <div className="text-[12px] font-bold text-muted mb-2">Run {runGroup.runId.slice(-6)} · {formatDate(runGroup.stages[0]?.createdAt)}</div>
              <div className="flex gap-2 flex-wrap">
                {runGroup.stages.map((stage) => (
                  <span key={stage._id} className="inline-flex items-center gap-1.5 text-[12px] font-bold">
                    {stage.type.replace(/_/g, ' ')} <StatusPill status={stage.status} />
                  </span>
                ))}
              </div>
            </div>
          ))}
          {data.runs.length === 0 && <p className="text-sm font-semibold text-muted">No runs yet.</p>}
        </div>
      </Card>
    </div>
  );
}
