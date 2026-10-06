'use client';

import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useBusiness } from '@/lib/business-context';
import { useApi } from '@/lib/hooks';
import { date, dateTime } from '@/lib/format';
import { Alert, btn, Card, EmptyState, inputClass, Spinner, StatusPill } from '@/components/ui';
import { DashboardPage } from '../_components/shared';

interface ReportCase {
  _id: string;
  offer: { _id: string; title: string; status: string };
  status: string;
  reportCount: number;
  reasons: { label: string; count: number }[];
  decisionReason?: string;
  decisionNote?: string;
  decidedAt?: string;
  infoMessage?: string;
  infoDeadline?: string;
  businessReplies: { message: string; at: string }[];
  appeal?: { message: string; at: string; status: string; response?: string };
  canAppeal: boolean;
  canReply: boolean;
}

function CaseCard({ c, businessId, onChange }: { c: ReportCase; businessId: string; onChange: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function send(kind: 'reply' | 'appeal') {
    setBusy(true);
    setError(null);
    try {
      await api(`/businesses/${businessId}/reports/${c._id}/${kind}`, { method: 'POST', body: JSON.stringify({ message: text }) });
      setText('');
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="font-extrabold">{c.offer?.title}</div>
          <div className="text-[13px] text-muted">
            {c.reportCount} report{c.reportCount === 1 ? '' : 's'}: {c.reasons.map((r) => `${r.label} (${r.count})`).join(', ')}
          </div>
        </div>
        <StatusPill status={c.status} label={c.status === 'upheld' ? 'Offer removed' : c.status === 'rejected' ? 'No action' : 'We need your reply'} />
      </div>
      {c.status === 'info_requested' && (
        <Alert tone="warning" title={`Please reply by ${dateTime(c.infoDeadline)}`}>
          {c.infoMessage}
        </Alert>
      )}
      {c.status === 'upheld' && (
        <Alert tone="danger" title={`Removed on ${date(c.decidedAt)}: ${c.decisionReason}`}>
          {c.decisionNote}
        </Alert>
      )}
      {c.status === 'rejected' && <p className="text-sm text-ink-soft">We looked into it and took no action{c.decisionNote ? `: ${c.decisionNote}` : '.'}</p>}
      {c.businessReplies.map((r) => (
        <div key={r.at} className="bg-surface rounded-xl px-4 py-2.5 text-sm">
          <span className="text-[12px] text-muted">You · {dateTime(r.at)}</span>
          <div>{r.message}</div>
        </div>
      ))}
      {c.appeal && (
        <div className="bg-surface rounded-xl px-4 py-2.5 text-sm">
          <div className="text-[12px] text-muted">Your appeal · {dateTime(c.appeal.at)} · {c.appeal.status === 'open' ? 'being reviewed' : c.appeal.status}</div>
          <div>{c.appeal.message}</div>
          {c.appeal.response && <div className="mt-1 font-bold">Our answer: {c.appeal.response}</div>}
        </div>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {(c.canReply || c.canAppeal) && (
        <div className="flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={c.canReply ? 'Your reply to our team' : 'Why should we put the offer back? (one appeal)'} className={inputClass} />
          <button className={btn.secondary} disabled={busy || text.trim().length < 3} onClick={() => send(c.canReply ? 'reply' : 'appeal')}>
            {c.canReply ? 'Reply' : 'Appeal'}
          </button>
        </div>
      )}
    </Card>
  );
}

export default function ReportsPage() {
  const { business } = useBusiness();
  const { data, reload } = useApi<ReportCase[]>(business ? `/businesses/${business._id}/reports` : null);
  if (!business || !data) return <Spinner />;
  return (
    <DashboardPage title="Customer reports" subtitle="When customers report an offer, you see our decision and the reasons here. We never share who reported.">
      {data.length === 0 ? (
        <EmptyState title="No reports">Nice. Customers haven’t reported any of your offers.</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {data.map((c) => (
            <CaseCard key={c._id} c={c} businessId={business._id} onChange={reload} />
          ))}
        </div>
      )}
    </DashboardPage>
  );
}
