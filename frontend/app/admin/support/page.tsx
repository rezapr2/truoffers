'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, btn, Detail, Drawer, EmptyState, Feedback, Field, inputClass, Pager, SectionTitle, Spinner, StatusPill, Tabs, Tag, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { age, date, dateTime, humanise } from '@/lib/format';
import { useAction, useApi, useDebounced } from '@/lib/hooks';
import { SUPPORT_TOPICS } from '@/components/ContactForm';
import { AdminPage, ListToolbar, qs, RequireCapability, Table, Td, Th } from '../_components/admin-ui';

interface TicketRow {
  _id: string;
  number: string;
  subject: string;
  topic: string;
  status: 'open' | 'pending' | 'closed';
  priority: string;
  name: string;
  email: string;
  businessId?: { _id: string; name: string; slug: string };
  assignedTo?: { _id: string; name: string };
  waitingHours: number | null;
  updatedAt: string;
}

interface TicketDetail {
  ticket: TicketRow & {
    userId?: string;
    createdAt: string;
    messages: { _id: string; from: string; userId?: { name: string }; name?: string; body: string; internal: boolean; createdAt: string }[];
    businessId?: { _id: string; name: string; slug: string; verificationLevel: number; status: string };
    assignedTo?: { _id: string; name: string; email: string };
  };
  account?: { _id: string; name: string; email: string; role: string; status: string; createdAt: string } | null;
  others: { _id: string; number: string; subject: string; status: string; createdAt: string }[];
}

const TABS = [
  { value: 'open', label: 'Waiting on us' },
  { value: 'pending', label: 'Waiting on customer' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
] as const;
type Tab = (typeof TABS)[number]['value'];
const STATUS_PILL = { open: 'open', pending: 'info_requested', closed: 'ended' } as const;
const STATUS_TEXT = { open: 'Waiting on us', pending: 'Waiting on customer', closed: 'Closed' };
const topicLabel = (t: string) => SUPPORT_TOPICS.find((x) => x.value === t)?.label ?? humanise(t);

function TicketDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const { data, error, setData } = useApi<TicketDetail>(`/admin/support/${id}`);
  const action = useAction();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);

  const update = async (patch: Record<string, unknown>, notice: string) => {
    const r = await action.run('update', () => api<TicketDetail>(`/admin/support/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }), notice);
    if (r) {
      setData(r);
      onChanged();
    }
  };

  const send = async () => {
    const r = await action.run('reply', () => api<TicketDetail>(`/admin/support/${id}/messages`, { method: 'POST', body: JSON.stringify({ body, internal }) }), internal ? 'Note added' : 'Reply sent by email');
    if (r) {
      setData(r);
      setBody('');
      onChanged();
    }
  };

  const t = data?.ticket;
  return (
    <Drawer open onClose={onClose} title={t?.subject ?? 'Ticket'} subtitle={t && `${t.number} · ${t.name} <${t.email}> · opened ${dateTime(t.createdAt)}`}>
      {error && <Alert tone="danger">{error}</Alert>}
      {!data || !t ? (
        !error && <Spinner />
      ) : (
        <div className="flex flex-col gap-6">
          <Feedback error={action.error} notice={action.notice} />
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Status">
              <select className={inputClass} value={t.status} onChange={(e) => update({ status: e.target.value }, 'Status changed')} disabled={!!action.busy}>
                {Object.entries(STATUS_TEXT).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Topic">
              <select className={inputClass} value={t.topic} onChange={(e) => update({ topic: e.target.value }, 'Topic changed')} disabled={!!action.busy}>
                {SUPPORT_TOPICS.map((x) => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <select className={inputClass} value={t.priority} onChange={(e) => update({ priority: e.target.value }, 'Priority changed')} disabled={!!action.busy}>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </Field>
          </div>
          <div className="flex gap-2 flex-wrap items-center text-sm">
            <span className="font-bold text-muted">Assigned: {t.assignedTo?.name ?? 'nobody'}</span>
            {t.assignedTo?._id !== user?.id && (
              <button className={btn.small} onClick={() => update({ assignedTo: user?.id }, 'Assigned to you')}>
                Assign to me
              </button>
            )}
            {t.assignedTo && (
              <button className={btn.small} onClick={() => update({ assignedTo: null }, 'Unassigned')}>
                Unassign
              </button>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {t.messages.map((m) => (
              <div
                key={m._id}
                className={`rounded-2xl px-4 py-3 text-sm ${m.internal ? 'bg-sun-soft/60 border border-sun/40' : m.from === 'customer' ? 'bg-surface self-start max-w-[92%]' : m.from === 'system' ? 'bg-page text-muted self-center' : 'bg-tint-blue self-end max-w-[92%]'}`}
              >
                <div className="text-[12px] font-bold text-muted mb-1">
                  {m.internal ? 'Internal note · ' : ''}
                  {m.from === 'customer' ? t.name : m.from === 'system' ? 'TruOffers' : (m.userId?.name ?? m.name ?? 'Staff')} · {dateTime(m.createdAt)}
                </div>
                <div className="whitespace-pre-wrap">{m.body}</div>
              </div>
            ))}
          </div>

          <div className="bg-surface rounded-3xl p-5 flex flex-col gap-3">
            <textarea className={inputClass} rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder={internal ? 'A note only staff can see…' : `Reply to ${t.name}…`} />
            <Toggle checked={internal} onChange={setInternal} label="Internal note" hint="Not sent to the customer." />
            <div>
              <button className={btn.primary} disabled={!body.trim() || !!action.busy} onClick={send}>
                {internal ? 'Add note' : 'Send reply'}
              </button>
            </div>
          </div>

          <div>
            <SectionTitle>About the customer</SectionTitle>
            <dl>
              <Detail label="Account">
                {data.account ? (
                  <Link href={`/admin/users?open=${data.account._id}`} className="text-primary">
                    {data.account.name} · {humanise(data.account.role)} · joined {date(data.account.createdAt)}
                  </Link>
                ) : (
                  'No account (guest)'
                )}
              </Detail>
              {t.businessId && (
                <Detail label="Business">
                  <Link href={`/admin/businesses?open=${t.businessId._id}`} className="text-primary">
                    {t.businessId.name}
                  </Link>{' '}
                  · level {t.businessId.verificationLevel}
                </Detail>
              )}
              <Detail label="Other requests">
                {data.others.length ? (
                  <span className="flex flex-col gap-1">
                    {data.others.map((o) => (
                      <span key={o._id}>
                        {o.number} · {o.subject} · {humanise(o.status)}
                      </span>
                    ))}
                  </span>
                ) : (
                  'None'
                )}
              </Detail>
            </dl>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function SupportInbox() {
  const [tab, setTab] = useState<Tab>('open');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ topic: '', assigned: '' });
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useDebounced(search);
  const query = { status: tab, ...filters, q, page };
  const { data, error, loading, reload } = useApi<{ items: TicketRow[]; total: number; page: number; pages: number; counts: Record<string, number> }>(`/admin/support${qs(query)}`);

  return (
    <AdminPage title="Support" subtitle="Messages from the contact form and from business dashboards, oldest waiting first.">
      <div className="mb-5">
        <Tabs
          tabs={TABS}
          active={tab}
          onChange={(v) => {
            setTab(v);
            setPage(1);
          }}
          counts={{ open: data?.counts.open, pending: data?.counts.pending }}
        />
      </div>
      <ListToolbar
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Ticket number, subject, name or email"
        filters={[
          { key: 'topic', label: 'Topic', options: SUPPORT_TOPICS },
          { key: 'assigned', label: 'Assigned', options: [{ value: 'me', label: 'Assigned to me' }, { value: 'unassigned', label: 'Unassigned' }] },
        ]}
        values={filters}
        onFilter={(k, v) => {
          setFilters({ ...filters, [k]: v });
          setPage(1);
        }}
        csvPath={`/admin/support${qs({ ...query, page: undefined, format: 'csv' })}`}
        csvName="support-tickets.csv"
      />
      <Feedback error={error} className="mb-4" />
      {!data && loading ? (
        <Spinner />
      ) : data && data.items.length === 0 ? (
        <EmptyState title="Nothing here">{tab === 'open' ? 'Every request has an answer.' : 'No tickets match.'}</EmptyState>
      ) : data ? (
        <>
          <Table minWidth={900}>
            <thead className="bg-surface">
              <tr>
                <Th>Ticket</Th>
                <Th>From</Th>
                <Th>Topic</Th>
                <Th>Waiting</Th>
                <Th>Assigned</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((t) => (
                <tr key={t._id} className="border-t border-line hover:bg-surface/60 cursor-pointer" onClick={() => setOpenId(t._id)}>
                  <Td>
                    <div className="font-extrabold">
                      {t.subject} {t.priority === 'high' && <Tag tone="bad">High</Tag>}
                    </div>
                    <div className="text-[12.5px] text-muted">
                      {t.number}
                      {t.businessId ? ` · ${t.businessId.name}` : ''}
                    </div>
                  </Td>
                  <Td>
                    <div className="font-bold">{t.name}</div>
                    <div className="text-[12.5px] text-muted">{t.email}</div>
                  </Td>
                  <Td className="text-[13px]">{topicLabel(t.topic)}</Td>
                  <Td className={t.waitingHours !== null && t.waitingHours >= 24 ? 'text-danger font-extrabold' : 'font-bold'}>{t.waitingHours === null ? '—' : age(t.waitingHours)}</Td>
                  <Td>{t.assignedTo?.name ?? <span className="text-muted">—</span>}</Td>
                  <Td>
                    <StatusPill status={STATUS_PILL[t.status]} label={STATUS_TEXT[t.status]} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pager page={data.page} pages={data.pages} onChange={setPage} />
        </>
      ) : null}
      {openId && <TicketDrawer id={openId} onClose={() => setOpenId(null)} onChanged={() => void reload()} />}
    </AdminPage>
  );
}

export default function AdminSupportPage() {
  return (
    <RequireCapability capability="support.manage">
      <SupportInbox />
    </RequireCapability>
  );
}
