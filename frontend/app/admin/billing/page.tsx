'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { btn, Detail, Drawer, EmptyState, Feedback, Field, inputClass, Modal, Pager, SectionTitle, Spinner, StatusPill, Tabs, Tag, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { can, useAuth } from '@/lib/auth-context';
import { useAction, useApi, useDebounced } from '@/lib/hooks';
import { date, dateTime, humanise, money } from '@/lib/format';
import type { Payment, Subscription } from '@/lib/types';
import { AdminPage, ListToolbar, qs, RequireCapability, Table, Td, Th } from '../_components/admin-ui';

type BizRef = { _id: string; name: string; slug?: string; town?: string };
type Sub = Omit<Subscription, 'businessId'> & { businessId?: BizRef; userId?: { name: string; email: string } };
type Pay = Omit<Payment, 'businessId'> & { businessId?: BizRef; couponCode?: string };

const TABS = [
  { value: 'subscriptions', label: 'Subscriptions' },
  { value: 'payments', label: 'Payments' },
  { value: 'failed', label: 'Failed & past due' },
] as const;
type Tab = (typeof TABS)[number]['value'];

const PLAN_OPTIONS = ['standard', 'professional', 'starter', 'premium'].map((p) => ({ value: p, label: humanise(p) }));

function BusinessLink({ b }: { b?: BizRef }) {
  if (!b) return <span className="text-muted">—</span>;
  return (
    <Link href={`/admin/businesses?open=${b._id}`} onClick={(e) => e.stopPropagation()} className="font-bold hover:text-primary">
      {b.name}
    </Link>
  );
}

function SubscriptionDrawer({ sub, onClose, onChanged }: { sub: Sub; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const action = useAction();
  const [immediately, setImmediately] = useState(false);
  const [note, setNote] = useState('');
  const live = ['active', 'trialing', 'past_due'].includes(sub.status);

  const cancel = async () => {
    const r = await action.run('cancel', () => api(`/admin/billing/subscriptions/${sub._id}/cancel`, { method: 'POST', body: JSON.stringify({ immediately, note: note || undefined }) }), immediately ? 'Cancelled now' : 'Set to end at the period end');
    if (r !== undefined) onChanged();
  };

  return (
    <Drawer open onClose={onClose} title={sub.businessId?.name ?? 'Subscription'} subtitle={<StatusPill status={sub.status} />}>
      <div className="flex flex-col gap-5">
        <Feedback error={action.error} notice={action.notice} />
        <dl>
          <Detail label="Plan">
            {humanise(sub.planKey)} {sub.comp && <Tag tone="info">Complimentary</Tag>}
          </Detail>
          <Detail label="Price">
            {money(sub.price)} / {sub.interval === 'annual' ? 'year' : 'month'}
          </Detail>
          <Detail label={sub.cancelAtPeriodEnd ? 'Ends' : 'Renews'}>{date(sub.currentPeriodEnd)}</Detail>
          {sub.pendingPlanKey && <Detail label="Changing to">{humanise(sub.pendingPlanKey)} at renewal</Detail>}
          {sub.pastDueSince && <Detail label="Past due since">{date(sub.pastDueSince)}</Detail>}
          <Detail label="Payer">{sub.userId ? `${sub.userId.name} (${sub.userId.email})` : '—'}</Detail>
          <Detail label="Stripe ID">{sub.stripeSubscriptionId ?? 'Not on Stripe'}</Detail>
          {sub.compNote && <Detail label="Note">{sub.compNote}</Detail>}
          <Detail label="Started">{dateTime(sub.createdAt)}</Detail>
        </dl>
        {can(user, 'billing.manage') && live && (
          <div className="bg-surface rounded-3xl p-5 flex flex-col gap-4">
            <SectionTitle className="!mb-0">Cancel</SectionTitle>
            <Toggle checked={immediately} onChange={setImmediately} label="Cancel immediately" hint="Off: it runs to the end of the paid period, then drops to Free." />
            <Field label="Note (audit log)">
              <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div>
              <button className={btn.danger} disabled={!!action.busy || (sub.cancelAtPeriodEnd && !immediately)} onClick={cancel}>
                Cancel subscription
              </button>
            </div>
          </div>
        )}
        {sub.businessId && (
          <p className="text-sm text-muted">
            To change the plan, open the{' '}
            <Link className={btn.link} href={`/admin/businesses?open=${sub.businessId._id}`}>
              business
            </Link>{' '}
            → Billing → Set plan.
          </p>
        )}
      </div>
    </Drawer>
  );
}

function RefundModal({ payment, onClose, onDone }: { payment: Pay; onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const remaining = Math.round((payment.total - payment.refundedAmount) * 100) / 100;
  const [amount, setAmount] = useState(String(remaining));
  const [reason, setReason] = useState('');
  const refund = async () => {
    const r = await action.run('refund', () => api(`/admin/billing/payments/${payment._id}/refund`, { method: 'POST', body: JSON.stringify({ amount: Number(amount), reason: reason || undefined }) }));
    if (r !== undefined) onDone();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Refund ${payment.number ?? 'payment'}`}
      footer={
        <>
          <button className={btn.secondary} onClick={onClose}>
            Cancel
          </button>
          <button className={btn.danger} disabled={!!action.busy || !(Number(amount) > 0) || Number(amount) > remaining} onClick={refund}>
            Refund {money(Number(amount) || 0)}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Feedback error={action.error} />
        <p className="text-sm text-muted">
          {payment.description} · paid {money(payment.total)}
          {payment.refundedAmount ? `, ${money(payment.refundedAmount)} already refunded` : ''}. Refunds go back to the card through Stripe.
        </p>
        <Field label="Amount (£)" hint={`Up to ${money(remaining)}`}>
          <input type="number" min={0.01} max={remaining} step={0.01} className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Reason">
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function Subscriptions() {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ status: '', plan: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Sub | null>(null);
  const q = useDebounced(search);
  const query = { ...filters, q, page };
  const { data, error, loading, reload } = useApi<{ items: Sub[]; total: number; page: number; pages: number }>(`/admin/billing/subscriptions${qs(query)}`);
  return (
    <>
      <ListToolbar
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Business name"
        filters={[
          { key: 'status', label: 'Status', options: ['active', 'trialing', 'past_due', 'cancelled', 'incomplete'].map((s) => ({ value: s, label: humanise(s) })) },
          { key: 'plan', label: 'Plan', options: PLAN_OPTIONS },
        ]}
        values={filters}
        onFilter={(k, v) => {
          setFilters({ ...filters, [k]: v });
          setPage(1);
        }}
        csvPath={`/admin/billing/subscriptions${qs({ ...query, page: undefined, format: 'csv' })}`}
        csvName="subscriptions.csv"
      />
      <Feedback error={error} className="mb-4" />
      {!data && loading ? (
        <Spinner />
      ) : data && data.items.length === 0 ? (
        <EmptyState title="No subscriptions" />
      ) : data ? (
        <>
          <Table>
            <thead className="bg-surface">
              <tr>
                <Th>Business</Th>
                <Th>Plan</Th>
                <Th>Price</Th>
                <Th>Renews / ends</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s._id} className="border-t border-line hover:bg-surface/60 cursor-pointer" onClick={() => setOpen(s)}>
                  <Td>
                    <BusinessLink b={s.businessId} />
                  </Td>
                  <Td>
                    {humanise(s.planKey)} {s.comp && <Tag tone="info">Comp</Tag>}
                  </Td>
                  <Td>
                    {money(s.price)} / {s.interval === 'annual' ? 'yr' : 'mo'}
                  </Td>
                  <Td className="text-[13px] whitespace-nowrap">
                    {date(s.currentPeriodEnd)} {s.cancelAtPeriodEnd && <Tag tone="warn">Ending</Tag>}
                  </Td>
                  <Td>
                    <StatusPill status={s.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pager page={data.page} pages={data.pages} onChange={setPage} />
        </>
      ) : null}
      {open && (
        <SubscriptionDrawer
          sub={open}
          onClose={() => setOpen(null)}
          onChanged={() => {
            setOpen(null);
            void reload();
          }}
        />
      )}
    </>
  );
}

function Payments() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ status: '', kind: '' });
  const [page, setPage] = useState(1);
  const [refunding, setRefunding] = useState<Pay | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const q = useDebounced(search);
  const query = { ...filters, q, page };
  const { data, error, loading, reload } = useApi<{ items: Pay[]; total: number; page: number; pages: number; last30Days: { total: number; refunded: number } }>(`/admin/billing/payments${qs(query)}`);
  return (
    <>
      {data && (
        <p className="text-sm font-bold text-muted mb-4">
          Last 30 days: {money(data.last30Days.total)} taken, {money(data.last30Days.refunded)} refunded.
        </p>
      )}
      <ListToolbar
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Business name"
        filters={[
          { key: 'status', label: 'Status', options: ['paid', 'open', 'failed', 'refunded', 'partially_refunded'].map((s) => ({ value: s, label: humanise(s) })) },
          { key: 'kind', label: 'Kind', options: [{ value: 'subscription', label: 'Subscription' }, { value: 'promotion', label: 'Promotion' }] },
        ]}
        values={filters}
        onFilter={(k, v) => {
          setFilters({ ...filters, [k]: v });
          setPage(1);
        }}
        csvPath={`/admin/billing/payments${qs({ ...query, page: undefined, format: 'csv' })}`}
        csvName="payments.csv"
      />
      <Feedback error={error} notice={notice} className="mb-4" />
      {!data && loading ? (
        <Spinner />
      ) : data && data.items.length === 0 ? (
        <EmptyState title="No payments" />
      ) : data ? (
        <>
          <Table minWidth={900}>
            <thead className="bg-surface">
              <tr>
                <Th>Date</Th>
                <Th>Invoice</Th>
                <Th>Business</Th>
                <Th>Description</Th>
                <Th>Total</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p._id} className="border-t border-line">
                  <Td className="text-[13px] whitespace-nowrap">{date(p.createdAt)}</Td>
                  <Td className="font-mono text-[12.5px]">
                    {p.hostedUrl ? (
                      <a href={p.hostedUrl} target="_blank" rel="noopener noreferrer" className="text-primary">
                        {p.number ?? 'View'}
                      </a>
                    ) : (
                      (p.number ?? '—')
                    )}
                    {p.mock && <Tag>Test</Tag>}
                  </Td>
                  <Td>
                    <BusinessLink b={p.businessId} />
                  </Td>
                  <Td className="text-[13px]">
                    {p.description}
                    {p.couponCode && <Tag tone="info">{p.couponCode}</Tag>}
                  </Td>
                  <Td className="font-bold whitespace-nowrap">
                    {money(p.total)}
                    {p.refundedAmount > 0 && <div className="text-[12px] text-muted">−{money(p.refundedAmount)}</div>}
                  </Td>
                  <Td>
                    <StatusPill status={p.status} />
                  </Td>
                  <Td>
                    {can(user, 'billing.manage') && ['paid', 'partially_refunded'].includes(p.status) && (
                      <button className={btn.small} onClick={() => setRefunding(p)}>
                        Refund
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pager page={data.page} pages={data.pages} onChange={setPage} />
        </>
      ) : null}
      {refunding && (
        <RefundModal
          payment={refunding}
          onClose={() => setRefunding(null)}
          onDone={() => {
            setRefunding(null);
            setNotice('Refund issued');
            void reload();
          }}
        />
      )}
    </>
  );
}

function Failed() {
  const { data, error } = useApi<{ pastDue: Sub[]; payments: Pay[] }>('/admin/billing/failed');
  if (error) return <Feedback error={error} />;
  if (!data) return <Spinner />;
  return (
    <div className="flex flex-col gap-8">
      <section>
        <SectionTitle>Past-due subscriptions</SectionTitle>
        {data.pastDue.length === 0 ? (
          <EmptyState title="None">Every subscription is paid up.</EmptyState>
        ) : (
          <Table>
            <thead className="bg-surface">
              <tr>
                <Th>Business</Th>
                <Th>Plan</Th>
                <Th>Past due since</Th>
                <Th>Contact</Th>
              </tr>
            </thead>
            <tbody>
              {data.pastDue.map((s) => (
                <tr key={s._id} className="border-t border-line">
                  <Td>
                    <BusinessLink b={s.businessId} />
                  </Td>
                  <Td>
                    {humanise(s.planKey)} · {money(s.price)}
                  </Td>
                  <Td>{date(s.pastDueSince)}</Td>
                  <Td className="text-[13px]">{s.userId?.email ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
      <section>
        <SectionTitle>Failed payments</SectionTitle>
        {data.payments.length === 0 ? (
          <EmptyState title="None" />
        ) : (
          <Table>
            <thead className="bg-surface">
              <tr>
                <Th>Date</Th>
                <Th>Business</Th>
                <Th>Description</Th>
                <Th>Amount</Th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p._id} className="border-t border-line">
                  <Td>{dateTime(p.createdAt)}</Td>
                  <Td>
                    <BusinessLink b={p.businessId} />
                  </Td>
                  <Td className="text-[13px]">{p.description}</Td>
                  <Td className="font-bold">{money(p.total)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}

function Billing() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'subscriptions';
  return (
    <AdminPage title="Subscriptions & payments" subtitle="Stripe is the source of truth: these update from its webhooks.">
      <div className="mb-5">
        <Tabs tabs={TABS} active={tab} onChange={(v) => router.replace(v === 'subscriptions' ? '/admin/billing' : `/admin/billing?tab=${v}`)} />
      </div>
      {tab === 'subscriptions' && <Subscriptions />}
      {tab === 'payments' && <Payments />}
      {tab === 'failed' && <Failed />}
    </AdminPage>
  );
}

export default function AdminBillingPage() {
  return (
    <RequireCapability capability="billing.view">
      <Suspense fallback={<Spinner />}>
        <Billing />
      </Suspense>
    </RequireCapability>
  );
}
