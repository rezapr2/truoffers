'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AuditEntry } from '@/lib/scraper-types';
import { btn, Card, EmptyState, formatDate, inputClass } from '../_components/ui';

const ACTIONS = [
  'candidate.approved', 'candidate.rejected', 'candidate.edited', 'candidate.merged', 'candidate.business_attached',
  'candidate.merchant_confirmation_requested', 'candidate.reextraction_requested', 'candidate.source_blocked',
  'branch.match_decided', 'business.created_from_import', 'website.submitted', 'website.authorised',
  'website.authorisation_denied', 'website.paused', 'website.resumed', 'provider_policy.created', 'provider_policy.updated',
  'provider_policy.deleted', 'opt_out.added', 'opt_out.acknowledged', 'opt_out.lifted', 'removal.requested',
  'adapter.paused', 'adapter.resumed', 'queue.emergency_stop', 'queue.resumed', 'job.retried', 'run.cancelled',
  'settings.updated', 'offer.merchant_confirmed', 'offer.removed',
];

function summarise(value?: Record<string, unknown>) {
  if (!value || Object.keys(value).length === 0) return null;
  return Object.entries(value)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

export default function AuditPage() {
  const [action, setAction] = useState('');
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [more, setMore] = useState(true);

  const fetchPage = useCallback(
    (before?: string) => {
      const params = new URLSearchParams();
      if (action) params.set('action', action);
      if (before) params.set('before', before);
      return api<AuditEntry[]>(`/admin/scraper/audit-log?${params}`);
    },
    [action],
  );

  useEffect(() => {
    void fetchPage().then((page) => {
      setEntries(page);
      setMore(page.length === 50);
    }).catch(() => {});
  }, [fetchPage]);

  async function loadOlder() {
    const page = await fetchPage(entries[entries.length - 1]?.createdAt);
    setEntries([...entries, ...page]);
    setMore(page.length === 50);
  }

  return (
    <div className="flex flex-col gap-5">
      <select value={action} onChange={(e) => setAction(e.target.value)} className={`${inputClass} self-start`}>
        <option value="">All actions</option>
        {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <Card>
        <div className="flex flex-col divide-y divide-line">
          {entries.map((entry) => (
            <div key={entry._id} className="py-3 text-[13px] font-semibold">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-extrabold text-ink">{entry.action}</span>
                <span className="text-muted">
                  {entry.targetType}{entry.targetId ? ` ${entry.targetId}` : ''} · {formatDate(entry.createdAt)}
                </span>
              </div>
              <div className="text-muted">
                {entry.actor.userId ? `${entry.actor.userId.name} (${entry.actor.role})` : entry.actor.component ? `system: ${entry.actor.component}` : entry.actor.kind}
                {entry.actor.ip ? ` · ${entry.actor.ip}` : ''}
              </div>
              {summarise(entry.before) && <div className="text-ink-soft">Before: {summarise(entry.before)}</div>}
              {summarise(entry.after) && <div className="text-ink-soft">After: {summarise(entry.after)}</div>}
              {entry.note && <div className="text-ink-soft">Note: {entry.note}</div>}
            </div>
          ))}
        </div>
        {entries.length === 0 && <EmptyState>No audit entries yet.</EmptyState>}
        {more && entries.length > 0 && (
          <div className="mt-4 text-center">
            <button className={btn.outline} onClick={loadOlder}>Load older</button>
          </div>
        )}
      </Card>
    </div>
  );
}
