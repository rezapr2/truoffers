'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, btn, Card, EmptyState, Feedback, inputClass, Spinner, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { dateTime, humanise } from '@/lib/format';

interface ChangeRequest {
  _id: string;
  status: string;
  createdAt: string;
  reviewedAt?: string;
  note?: string;
  changes: { field: string; from?: unknown; to?: unknown }[];
  businessId?: { _id: string; name: string; slug: string; town?: string; postcode?: string; verificationLevel: number };
  requestedBy?: { name: string; email: string };
  reviewedBy?: { name: string };
}

const FIELD_LABELS: Record<string, string> = { name: 'Name', address: 'Address', postcode: 'Postcode', phone: 'Phone', orderUrl: 'Order link', town: 'Town' };

function show(value: unknown) {
  if (value === undefined || value === null || value === '') return <span className="text-muted">empty</span>;
  return String(value);
}

/** Edits to locked fields (name, address, phone, order link) on a verified listing wait here (spec T2.7). */
export function ChangeRequests({ onDecided }: { onDecided: () => void }) {
  const [status, setStatus] = useState('pending');
  const { data, error, reload } = useApi<ChangeRequest[]>(`/admin/claims/change-requests?status=${status}`);
  const action = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});

  const decide = async (id: string, approve: boolean) => {
    const done = await action.run(
      id,
      () => api(`/admin/claims/change-requests/${id}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: JSON.stringify({ note: notes[id] || undefined }) }),
      approve ? 'Change approved and applied' : 'Change rejected',
    );
    if (done !== undefined) {
      await reload();
      onDecided();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {['pending', 'all'].map((s) => (
          <button key={s} className={status === s ? btn.smallPrimary : btn.small} onClick={() => setStatus(s)}>
            {s === 'pending' ? 'Waiting' : 'All'}
          </button>
        ))}
      </div>
      <Feedback error={action.error ?? error} notice={action.notice} />
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <EmptyState title="No changes waiting">Edits to a verified listing’s name, address, phone or order link appear here.</EmptyState>
      ) : (
        data.map((r) => (
          <Card key={r._id}>
            <div className="flex items-start gap-4 flex-wrap mb-4">
              <div className="flex-1 min-w-0">
                <Link href={`/admin/businesses?open=${r.businessId?._id}`} className="font-display font-extrabold text-lg hover:text-primary">
                  {r.businessId?.name ?? 'Deleted business'}
                </Link>
                <div className="text-sm text-muted">
                  {[r.businessId?.town, r.businessId?.postcode].filter(Boolean).join(' · ')} · asked by {r.requestedBy?.name} ({r.requestedBy?.email}) · {dateTime(r.createdAt)}
                </div>
              </div>
              <StatusPill status={r.status} label={humanise(r.status)} />
            </div>
            <div className="border border-line rounded-2xl overflow-hidden mb-4">
              <table className="w-full text-sm">
                <thead className="bg-surface">
                  <tr>
                    <th className="text-left px-4 py-2 text-[12px] uppercase text-muted">Field</th>
                    <th className="text-left px-4 py-2 text-[12px] uppercase text-muted">Now</th>
                    <th className="text-left px-4 py-2 text-[12px] uppercase text-muted">Asked for</th>
                  </tr>
                </thead>
                <tbody>
                  {r.changes.map((c) => (
                    <tr key={c.field} className="border-t border-line">
                      <td className="px-4 py-2.5 font-bold">{FIELD_LABELS[c.field] ?? humanise(c.field)}</td>
                      <td className="px-4 py-2.5 break-all">{show(c.from)}</td>
                      <td className="px-4 py-2.5 break-all font-bold text-primary">{show(c.to)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {r.status === 'pending' ? (
              <div className="flex gap-3 flex-wrap items-center">
                <input
                  className={`${inputClass} flex-1 min-w-[220px]`}
                  placeholder="Note to the owner (optional)"
                  value={notes[r._id] ?? ''}
                  onChange={(e) => setNotes({ ...notes, [r._id]: e.target.value })}
                />
                <button className={btn.good} disabled={!!action.busy} onClick={() => decide(r._id, true)}>
                  Approve
                </button>
                <button className={btn.danger} disabled={!!action.busy} onClick={() => decide(r._id, false)}>
                  Reject
                </button>
              </div>
            ) : (
              <Alert tone="info">
                {humanise(r.status)} by {r.reviewedBy?.name ?? 'staff'} · {dateTime(r.reviewedAt)}
                {r.note ? ` · “${r.note}”` : ''}
              </Alert>
            )}
          </Card>
        ))
      )}
    </div>
  );
}
