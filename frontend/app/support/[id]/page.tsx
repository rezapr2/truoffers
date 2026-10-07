'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, use, useState } from 'react';
import { Alert, btn, Feedback, inputClass, Spinner, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { dateTime } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

interface Ticket {
  _id: string;
  number: string;
  subject: string;
  status: 'open' | 'pending' | 'closed';
  name: string;
  createdAt: string;
  messages: { _id: string; from: string; name?: string; body: string; createdAt: string }[];
}

const STATUS_TEXT = { open: 'With our team', pending: 'Waiting for your reply', closed: 'Closed' };

function Conversation({ id }: { id: string }) {
  const params = useSearchParams();
  const token = params.get('t') ?? undefined;
  const { user, loading } = useAuth();
  const path = loading ? null : `/support/tickets/${id}${token ? `?t=${encodeURIComponent(token)}` : ''}`;
  const { data, error, setData } = useApi<Ticket>(path);
  const action = useAction();
  const [reply, setReply] = useState('');

  if (error) {
    return (
      <Alert tone="danger" title="We couldn’t open this request">
        {user ? 'It may belong to another account.' : 'Open it from the link in our email, or sign in with the account you used.'}
      </Alert>
    );
  }
  if (!data) return <Spinner />;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const updated = await action.run('reply', () => api<Ticket>(`/support/tickets/${id}/messages`, { method: 'POST', body: JSON.stringify({ body: reply, t: token }) }), 'Sent. We’ll reply by email.');
    if (updated) {
      setData(updated);
      setReply('');
    }
  };

  return (
    <>
      <div className="flex items-start gap-4 flex-wrap mb-6">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-muted">{data.number}</div>
          <h1 className="font-display text-2xl md:text-3xl font-extrabold tracking-tight">{data.subject}</h1>
        </div>
        <StatusPill status={data.status === 'closed' ? 'ended' : data.status === 'pending' ? 'info_requested' : 'open'} label={STATUS_TEXT[data.status]} />
      </div>
      <div className="flex flex-col gap-3 mb-6">
        {data.messages.map((m) => (
          <div
            key={m._id}
            className={`rounded-2xl px-5 py-4 text-[15px] ${m.from === 'customer' ? 'bg-surface self-end max-w-[90%]' : m.from === 'system' ? 'bg-page text-muted text-sm self-center' : 'bg-tint-blue self-start max-w-[90%]'}`}
          >
            <div className="text-[12px] font-bold text-muted mb-1">
              {m.from === 'customer' ? 'You' : m.from === 'system' ? 'TruOffers' : 'TruOffers support'} · {dateTime(m.createdAt)}
            </div>
            <div className="whitespace-pre-wrap leading-relaxed">{m.body}</div>
          </div>
        ))}
      </div>
      <form onSubmit={send} className="flex flex-col gap-3">
        <textarea className={inputClass} rows={4} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={data.status === 'closed' ? 'Write here to open this request again…' : 'Add a reply…'} />
        <Feedback error={action.error} notice={action.notice} />
        <div>
          <button className={btn.primary} disabled={!reply.trim() || !!action.busy}>
            Send reply
          </button>
        </div>
      </form>
    </>
  );
}

export default function SupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className="mx-auto max-w-3xl px-5 md:px-10 py-10">
      <Link href="/account" className="text-sm font-bold text-muted hover:text-primary">
        ← Your account
      </Link>
      <div className="mt-4">
        <Suspense fallback={<Spinner />}>
          <Conversation id={id} />
        </Suspense>
      </div>
    </div>
  );
}
