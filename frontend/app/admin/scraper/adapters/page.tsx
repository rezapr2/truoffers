'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AdapterListItem } from '@/lib/scraper-types';
import { btn, Card, ErrorNote, humanise, SectionTitle, StatusPill, useAction } from '../_components/ui';

export default function AdaptersPage() {
  const [adapters, setAdapters] = useState<AdapterListItem[] | null>(null);
  const { busy, error, run } = useAction();

  const load = useCallback(() => void api<AdapterListItem[]>('/admin/scraper/adapters').then(setAdapters).catch(() => {}), []);
  useEffect(load, [load]);

  async function togglePause(adapter: AdapterListItem) {
    const pausing = adapter.status !== 'paused';
    const reason = pausing ? prompt(`Why pause ${adapter.name}? Websites using it will wait until it resumes.`) : undefined;
    if (reason === null) return;
    await run(() => api(`/admin/scraper/adapters/${adapter.key}`, { method: 'PATCH', body: JSON.stringify({ paused: pausing, reason: reason || undefined }) }));
    load();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <SectionTitle aside={<Link href="/admin/scraper/adapters/new" className={btn.dark}>Build a selector adapter</Link>}>Adapters</SectionTitle>
        <p className="text-[13px] font-semibold text-muted mb-4">
          For each website, the robot uses the highest-priority adapter that recognises it: provider adapters (400), then selector adapters built for a
          template (300), then structured data (200), then generic HTML (100).
        </p>
        <ErrorNote error={error} />
        <div className="flex flex-col divide-y divide-line">
          {adapters?.map((adapter) => {
            const fingerprint = typeof adapter.fingerprintRef === 'object' ? adapter.fingerprintRef : null;
            const running = ['active', 'approved'].includes(adapter.status);
            return (
              <div key={adapter.key} className="py-4 flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/admin/scraper/adapters/${adapter.key}`} className="font-extrabold hover:text-primary">{adapter.name}</Link>
                    <StatusPill status={adapter.status} />
                    <span className="text-[12px] font-bold text-muted">
                      {humanise(adapter.type)} · priority {adapter.priority} · v{adapter.version}
                      {adapter.versions > 1 ? ` of ${adapter.versions}` : ''}
                    </span>
                  </div>
                  <div className="text-[13px] font-semibold text-muted mt-1">
                    {fingerprint ? `Template: ${fingerprint.name} · ` : ''}
                    {adapter.websites} websites ·{' '}
                    {Object.entries(adapter.candidates ?? {}).map(([s, n]) => `${n} ${s.replace(/_/g, ' ')}`).join(' · ') || 'no candidates yet'}
                    {adapter.approvalRate != null && ` · ${Math.round(adapter.approvalRate * 100)}% approved`}
                    {adapter.pausedReason && ` · paused: ${adapter.pausedReason}`}
                  </div>
                </div>
                <div className="flex gap-2">
                  {(running || adapter.status === 'paused') && (
                    <button disabled={busy} className={running ? btn.danger : btn.good} onClick={() => togglePause(adapter)}>
                      {running ? 'Pause' : 'Resume'}
                    </button>
                  )}
                  <Link href={`/admin/scraper/adapters/${adapter.key}`} className={btn.outline}>Details</Link>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
