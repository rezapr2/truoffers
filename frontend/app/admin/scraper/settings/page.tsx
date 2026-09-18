'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AdapterStats, ScraperSettings } from '@/lib/scraper-types';
import { btn, Card, ErrorNote, formatDate, inputClass, SectionTitle, StatusPill, useAction } from '../_components/ui';

export default function SettingsPage() {
  const [settings, setSettings] = useState<ScraperSettings | null>(null);
  const [draft, setDraft] = useState({ aiExtractionEnabled: false, renderingEnabled: false, providerReviewRequired: false, defaultRateLimitMs: 2000, defaultPageCap: 50, extraNeverCrawlDomains: '' });
  const [released, setReleased] = useState(0);
  const [adapters, setAdapters] = useState<AdapterStats[]>([]);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();

  const load = useCallback(() => {
    void api<ScraperSettings>('/admin/scraper/settings').then((s) => {
      setSettings(s);
      setDraft({
        aiExtractionEnabled: s.aiExtractionEnabled,
        renderingEnabled: s.renderingEnabled ?? false,
        providerReviewRequired: s.providerReviewRequired ?? false,
        defaultRateLimitMs: s.defaultRateLimitMs,
        defaultPageCap: s.defaultPageCap,
        extraNeverCrawlDomains: s.extraNeverCrawlDomains.join('\n'),
      });
    }).catch(() => {});
    void api<AdapterStats[]>('/admin/scraper/adapters').then(setAdapters).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    const result = await run(() =>
      api<ScraperSettings & { websitesReleased?: number }>('/admin/scraper/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          aiExtractionEnabled: draft.aiExtractionEnabled,
          renderingEnabled: draft.renderingEnabled,
          providerReviewRequired: draft.providerReviewRequired,
          defaultRateLimitMs: Number(draft.defaultRateLimitMs),
          defaultPageCap: Number(draft.defaultPageCap),
          extraNeverCrawlDomains: draft.extraNeverCrawlDomains.split('\n').map((d) => d.trim()).filter(Boolean),
        }),
      }),
    );
    if (result) {
      setSaved(true);
      setReleased(result.websitesReleased ?? 0);
      load();
    }
  }

  async function toggleAdapter(adapter: AdapterStats) {
    const reason = adapter.status === 'active' ? prompt(`Why pause ${adapter.name}? (optional)`) : undefined;
    if (reason === null) return;
    await run(() =>
      api(`/admin/scraper/adapters/${adapter.key}`, { method: 'PATCH', body: JSON.stringify({ paused: adapter.status === 'active', reason: reason || undefined }) }),
    );
    load();
  }

  if (!settings) return <div className="py-16 text-center text-muted font-bold">Loading…</div>;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <SectionTitle>Crawl defaults</SectionTitle>
        <form onSubmit={save} className="flex flex-col gap-4">
          <ErrorNote error={error} />
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 accent-primary"
              checked={draft.aiExtractionEnabled}
              disabled={!settings.aiAvailable && !draft.aiExtractionEnabled}
              onChange={(e) => setDraft({ ...draft, aiExtractionEnabled: e.target.checked })}
            />
            <span>
              <span className="font-extrabold">AI extraction fallback</span>
              <span className="block text-[13px] font-semibold text-muted">
                When the standard extractors find no offers on a website, send offer-relevant text from up to 3 pages to Claude. Every date,
                price and code it returns must appear word for word on the page, and results still go to review.
                {!settings.aiAvailable && ' Unavailable: ANTHROPIC_API_KEY is not configured on this server.'}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 accent-primary"
              checked={draft.renderingEnabled}
              onChange={(e) => setDraft({ ...draft, renderingEnabled: e.target.checked })}
            />
            <span>
              <span className="font-extrabold">Render JavaScript-only websites</span>
              <span className="block text-[13px] font-semibold text-muted">
                When a website’s offers only appear after JavaScript runs, open up to 3 of its pages in Chromium. Images, fonts and
                trackers are never loaded, and every request passes the same permission checks. The AI fallback is skipped for a
                website that was rendered.
                {settings.renderWorkers > 0
                  ? ` ${settings.renderWorkers} render worker${settings.renderWorkers === 1 ? '' : 's'} running.`
                  : ' No render worker is running, so nothing will be rendered until one is started (it needs about 1 GB of memory).'}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 accent-primary"
              checked={draft.providerReviewRequired}
              onChange={(e) => setDraft({ ...draft, providerReviewRequired: e.target.checked })}
            />
            <span>
              <span className="font-extrabold">Review ordering platforms before crawling</span>
              <span className="block text-[13px] font-semibold text-muted">
                Off: websites on an ordering platform such as Foodhub or Grub24 are crawled unless you block the platform on the
                Policies page. On: they wait until you allow the platform and record an agreement or a review of its terms.
                Turning this off releases the websites waiting for a platform that isn’t blocked.
              </span>
            </span>
          </label>
          <div className="grid md:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-extrabold">Milliseconds between requests to a domain</span>
              <input type="number" min={250} max={60000} value={draft.defaultRateLimitMs} onChange={(e) => setDraft({ ...draft, defaultRateLimitMs: Number(e.target.value) })} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-extrabold">Pages per website per run</span>
              <input type="number" min={1} max={1000} value={draft.defaultPageCap} onChange={(e) => setDraft({ ...draft, defaultPageCap: Number(e.target.value) })} className={inputClass} />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-extrabold">Extra never-crawl domains (one per line)</span>
            <textarea rows={4} value={draft.extraNeverCrawlDomains} onChange={(e) => setDraft({ ...draft, extraNeverCrawlDomains: e.target.value })} className={inputClass} />
            <span className="text-[12px] font-semibold text-muted">
              Added to the built-in list of marketplaces, search engines, maps and social networks, which can’t be removed.
            </span>
          </label>
          <div className="flex items-center gap-3">
            <button disabled={busy} className={btn.dark}>{busy ? 'Saving…' : 'Save settings'}</button>
            {saved && (
              <span className="text-sm font-bold text-verified">
                Saved. Workers pick it up within seconds.
                {released > 0 && ` ${released} website${released === 1 ? '' : 's'} released from provider review; start their analysis from Websites.`}
              </span>
            )}
            {settings.updatedAt && <span className="text-[12px] font-semibold text-muted">Last changed {formatDate(settings.updatedAt)}</span>}
          </div>
        </form>
      </Card>

      <Card>
        <SectionTitle>Adapters</SectionTitle>
        <div className="flex flex-col divide-y divide-line">
          {adapters.map((adapter) => (
            <div key={adapter._id} className="py-3 flex flex-col md:flex-row md:items-center gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-extrabold">{adapter.name}</span>
                  <span className="text-[12px] font-bold text-muted">{adapter.key} {adapter.version} · priority {adapter.priority}</span>
                  <StatusPill status={adapter.status} />
                </div>
                <div className="text-[13px] font-semibold text-muted">
                  {adapter.websites} websites · {Object.entries(adapter.candidates).map(([s, n]) => `${n} ${s.replace(/_/g, ' ')}`).join(' · ') || 'no candidates yet'}
                  {adapter.approvalRate !== null && ` · ${Math.round(adapter.approvalRate * 100)}% approved`}
                  {adapter.pausedReason && ` · paused: ${adapter.pausedReason}`}
                </div>
              </div>
              <button disabled={busy} className={adapter.status === 'active' ? btn.danger : btn.good} onClick={() => toggleAdapter(adapter)}>
                {adapter.status === 'active' ? 'Pause' : 'Resume'}
              </button>
            </div>
          ))}
          {adapters.length === 0 && <p className="text-sm font-semibold text-muted py-3">Adapters register when the worker starts or the migration runs.</p>}
        </div>
      </Card>
    </div>
  );
}
