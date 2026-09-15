'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Fingerprint } from '@/lib/scraper-types';
import { btn, Card, EmptyState, formatDate, SectionTitle, StatusPill } from '../_components/ui';

export default function FingerprintsPage() {
  const [fingerprints, setFingerprints] = useState<Fingerprint[] | null>(null);
  useEffect(() => void api<Fingerprint[]>('/admin/scraper/fingerprints').then(setFingerprints).catch(() => {}), []);

  return (
    <Card>
      <SectionTitle aside={<Link href="/admin/scraper/adapters/new" className={btn.dark}>Fingerprint a new template</Link>}>Website templates (fingerprints)</SectionTitle>
      <div className="flex flex-col divide-y divide-line">
        {fingerprints?.map((fp) => (
          <Link key={fp._id} href={`/admin/scraper/fingerprints/${fp._id}`} className="py-3 flex flex-col md:flex-row md:items-center gap-2 hover:text-primary">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-extrabold">{fp.name}</span>
                {!fp.active && <StatusPill status="paused" label="inactive" />}
                <span className="text-[12px] font-bold text-muted">v{fp.version} · {fp.markerCount} traits · analysed {formatDate(fp.analysedAt)}</span>
              </div>
              <div className="text-[13px] font-semibold text-muted">
                Examples: {fp.exampleDomains.join(', ')} · matched:{' '}
                {Object.entries(fp.matches ?? {}).map(([c, n]) => `${n} ${c.replace(/_/g, ' ')}`).join(', ') || 'none yet'}
                {fp.adapters?.length ? ` · adapters: ${fp.adapters.map((a) => `${a.name} v${a.version}`).join(', ')}` : ''}
              </div>
            </div>
          </Link>
        ))}
      </div>
      {fingerprints?.length === 0 && <EmptyState>No templates fingerprinted yet. The adapter builder creates one from example websites.</EmptyState>}
    </Card>
  );
}
