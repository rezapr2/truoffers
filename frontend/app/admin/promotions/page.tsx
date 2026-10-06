'use client';

import Link from 'next/link';
import { useState } from 'react';
import { btn, Card, EmptyState, Feedback, Field, inputClass, Modal, Spinner, StatusPill, Tabs, Tag, Toggle } from '@/components/ui';
import { PlusIcon } from '@/components/icons';
import { api } from '@/lib/api';
import { can, useAuth } from '@/lib/auth-context';
import { useAction, useApi, useDebounced } from '@/lib/hooks';
import { date, dateTime, humanise, money } from '@/lib/format';
import type { Category, PromotionBooking, PromotionPrice, PromotionProduct } from '@/lib/types';
import { AdminPage, ListToolbar, qs, Table, Td, Th } from '../_components/admin-ui';

const TABS = [
  { value: 'bookings', label: 'Bookings' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'products', label: 'Products & prices' },
] as const;
type Tab = (typeof TABS)[number]['value'];

const SCOPE_LABELS: Record<string, string> = { area: 'Per postcode area', category_city: 'Per category and city', site: 'Site-wide' };
const UNIT_LABELS: Record<string, string> = { day: 'day', week: 'week', deal: 'deal' };

function scopeText(b: PromotionBooking) {
  const parts = [b.scope.area, typeof b.scope.categoryId === 'object' ? b.scope.categoryId?.name : undefined, b.scope.city ? humanise(b.scope.city) : undefined].filter(Boolean);
  return parts.join(' · ') || 'Site-wide';
}

function Bookings({ products, manage }: { products: PromotionProduct[]; manage: boolean }) {
  const [filters, setFilters] = useState({ product: '', status: '' });
  const { data, error, reload } = useApi<PromotionBooking[]>(`/admin/promotions/bookings${qs(filters)}`);
  const action = useAction();

  const act = async (b: PromotionBooking, kind: 'approve' | 'reject' | 'cancel') => {
    let note: string | undefined;
    if (kind !== 'approve') {
      const answer = window.prompt(kind === 'reject' ? 'Why is this booking rejected? The business is told and refunded.' : 'Why is this promotion being cancelled?');
      if (answer === null) return;
      note = answer || undefined;
    }
    const call =
      kind === 'approve'
        ? () => api(`/admin/promotions/bookings/${b._id}/approve`, { method: 'POST' })
        : kind === 'reject'
          ? () => api(`/admin/promotions/bookings/${b._id}/reject`, { method: 'POST', body: JSON.stringify({ note }) })
          : () => api(`/admin/promotions/bookings/${b._id}`, { method: 'DELETE', body: JSON.stringify({ note }) });
    await action.run(b._id, call, kind === 'approve' ? 'Approved' : kind === 'reject' ? 'Rejected' : 'Cancelled');
    await reload();
  };

  return (
    <>
      <ListToolbar
        filters={[
          { key: 'product', label: 'Product', options: products.map((p) => ({ value: p.key, label: p.name })) },
          { key: 'status', label: 'Status', options: ['pending_approval', 'pending_payment', 'scheduled', 'active', 'ended', 'cancelled', 'rejected'].map((s) => ({ value: s, label: humanise(s) })) },
        ]}
        values={filters}
        onFilter={(k, v) => setFilters({ ...filters, [k]: v })}
      />
      <Feedback error={action.error ?? error} notice={action.notice} className="mb-4" />
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <EmptyState title="No bookings" />
      ) : (
        <Table minWidth={980}>
          <thead className="bg-surface">
            <tr>
              <Th>Product</Th>
              <Th>Business & offer</Th>
              <Th>Where</Th>
              <Th>When</Th>
              <Th>Price</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.map((b) => {
              const biz = typeof b.businessId === 'object' ? b.businessId : null;
              const offer = typeof b.offerId === 'object' ? b.offerId : null;
              return (
                <tr key={b._id} className="border-t border-line">
                  <Td className="font-bold">{products.find((p) => p.key === b.productKey)?.name ?? humanise(b.productKey)}</Td>
                  <Td>
                    {biz && (
                      <Link href={`/admin/businesses?open=${biz._id}`} className="font-bold hover:text-primary">
                        {biz.name}
                      </Link>
                    )}
                    <div className="text-[12.5px] text-muted">{offer?.title}</div>
                  </Td>
                  <Td className="text-[13px]">{scopeText(b)}</Td>
                  <Td className="text-[13px] whitespace-nowrap">
                    {dateTime(b.startsAt)}
                    <div className="text-muted">to {dateTime(b.endsAt)}</div>
                  </Td>
                  <Td>
                    {b.source === 'purchase' ? money(b.price) : <Tag tone="info">{b.source === 'admin_grant' ? 'Granted' : 'Plan credit'}</Tag>}
                  </Td>
                  <Td>
                    <StatusPill status={b.status} />
                  </Td>
                  <Td>
                    {manage && (
                      <div className="flex gap-2 justify-end">
                        {b.status === 'pending_approval' && (
                          <>
                            <button className={btn.smallPrimary} disabled={!!action.busy} onClick={() => act(b, 'approve')}>
                              Approve
                            </button>
                            <button className={btn.smallDanger} disabled={!!action.busy} onClick={() => act(b, 'reject')}>
                              Reject
                            </button>
                          </>
                        )}
                        {['scheduled', 'active'].includes(b.status) && (
                          <button className={btn.smallDanger} disabled={!!action.busy} onClick={() => act(b, 'cancel')}>
                            Cancel
                          </button>
                        )}
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}

interface Calendar {
  products: { key: string; name: string; slots: number; scope: string }[];
  days: { date: string; counts: Record<string, number> }[];
}

function CalendarView() {
  const { data, error } = useApi<Calendar>('/admin/promotions/calendar');
  if (error) return <Feedback error={error} />;
  if (!data) return <Spinner />;
  return (
    <>
      <p className="text-sm text-muted mb-4">
        Booked promotions per day for the next five weeks, across every area. Slots are per area (top of search), per category and city (category feature) or
        site-wide.
      </p>
      <Table minWidth={760}>
        <thead className="bg-surface">
          <tr>
            <Th>Day</Th>
            {data.products.map((p) => (
              <Th key={p.key}>
                {p.name}
                <div className="normal-case font-bold tracking-normal">
                  {p.slots} slot{p.slots === 1 ? '' : 's'} · {SCOPE_LABELS[p.scope]?.toLowerCase()}
                </div>
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.days.map((d) => (
            <tr key={d.date} className="border-t border-line">
              <Td className="font-bold whitespace-nowrap">{date(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}</Td>
              {data.products.map((p) => {
                const n = d.counts[p.key] ?? 0;
                const full = p.scope === 'site' && n >= p.slots;
                return (
                  <Td key={p.key}>
                    {n ? <Tag tone={full ? 'bad' : 'info'}>{n} booked</Tag> : <span className="text-muted">—</span>}
                  </Td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

function ProductCard({ product, manage, onSaved }: { product: PromotionProduct; manage: boolean; onSaved: () => void }) {
  const [form, setForm] = useState(product);
  const action = useAction();
  const dirty = JSON.stringify(form) !== JSON.stringify(product);
  const setPrice = (i: number, patch: Partial<PromotionPrice>) => setForm({ ...form, prices: form.prices.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  const save = async () => {
    const { name, description, prices, slots, maxActivePerBusiness, approvalRequired, minVerificationLevel, active, sortOrder } = form;
    const r = await action.run('save', () =>
      api(`/admin/promotions/products/${product.key}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, description, prices: prices.map((p) => ({ unit: p.unit, price: Number(p.price), hours: Number(p.hours) })), slots, maxActivePerBusiness, approvalRequired, minVerificationLevel, active, sortOrder }),
      }),
      'Saved',
    );
    if (r !== undefined) onSaved();
  };

  return (
    <Card>
      <div className="flex items-start gap-3 mb-4">
        <div className="flex-1">
          <div className="font-display text-lg font-extrabold">{product.name}</div>
          <div className="text-[12.5px] text-muted">{SCOPE_LABELS[product.scope]}</div>
        </div>
        {product.active ? <Tag tone="good">On sale</Tag> : <Tag>Off</Tag>}
      </div>
      <fieldset disabled={!manage} className="flex flex-col gap-4">
        <Field label="Name">
          <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Description">
          <input className={inputClass} value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div>
          <div className="text-sm font-extrabold mb-2">Prices (ex VAT)</div>
          <div className="flex flex-col gap-2">
            {form.prices.map((p, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                <select className={inputClass} value={p.unit} onChange={(e) => setPrice(i, { unit: e.target.value as PromotionPrice['unit'] })} aria-label="Unit">
                  {Object.entries(UNIT_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      Per {l}
                    </option>
                  ))}
                </select>
                <input type="number" min={0} step={0.01} className={inputClass} value={p.price} onChange={(e) => setPrice(i, { price: Number(e.target.value) })} aria-label="Price" />
                <input type="number" min={1} className={inputClass} value={p.hours} onChange={(e) => setPrice(i, { hours: Number(e.target.value) })} aria-label="Hours" title="Length in hours" />
                <button type="button" className={btn.small} disabled={form.prices.length <= 1} onClick={() => setForm({ ...form, prices: form.prices.filter((_, j) => j !== i) })}>
                  ✕
                </button>
              </div>
            ))}
            <p className="text-[12px] text-muted">Unit · price (£) · length in hours</p>
            {form.prices.length < 4 && (
              <button type="button" className={`${btn.link} text-sm self-start`} onClick={() => setForm({ ...form, prices: [...form.prices, { unit: 'day', price: 0, hours: 24 }] })}>
                + Add a price
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Slots">
            <input type="number" min={0} className={inputClass} value={form.slots} onChange={(e) => setForm({ ...form, slots: Number(e.target.value) })} />
          </Field>
          <Field label="Max per business">
            <input type="number" min={1} className={inputClass} value={form.maxActivePerBusiness} onChange={(e) => setForm({ ...form, maxActivePerBusiness: Number(e.target.value) })} />
          </Field>
          <Field label="Min level">
            <input type="number" min={0} max={3} className={inputClass} value={form.minVerificationLevel} onChange={(e) => setForm({ ...form, minVerificationLevel: Number(e.target.value) })} />
          </Field>
        </div>
        <Toggle checked={form.approvalRequired} onChange={(v) => setForm({ ...form, approvalRequired: v })} label="Needs approval" hint="Bookings wait for an admin before they start." />
        <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="On sale" />
      </fieldset>
      <Feedback error={action.error} notice={action.notice} className="mt-4" />
      {manage && (
        <button className={`${btn.primary} mt-4`} disabled={!dirty || !!action.busy} onClick={save}>
          Save
        </button>
      )}
    </Card>
  );
}

function GrantModal({ products, onClose, onDone }: { products: PromotionProduct[]; onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const [businessQuery, setBusinessQuery] = useState('');
  const [business, setBusiness] = useState<{ _id: string; name: string } | null>(null);
  const [form, setForm] = useState({ productKey: products[0]?.key ?? 'top_of_search', offerId: '', area: '', categoryId: '', city: '', startsAt: new Date().toISOString().slice(0, 10), unit: 'week', quantity: 1, note: '' });
  const q = useDebounced(businessQuery);
  const results = useApi<{ items: { _id: string; name: string; town?: string; postcode: string }[] }>(!business && q.length >= 2 ? `/admin/businesses?q=${encodeURIComponent(q)}` : null);
  const offers = useApi<{ items: { _id: string; title: string }[] }>(business ? `/admin/offers?status=active,scheduled&businessId=${business._id}` : null);
  const categories = useApi<Category[]>('/categories');
  const product = products.find((p) => p.key === form.productKey);

  const grant = async () => {
    if (!business) return;
    const r = await action.run('grant', () =>
      api('/admin/promotions/grant', {
        method: 'POST',
        body: JSON.stringify({
          businessId: business._id,
          offerId: form.offerId,
          productKey: form.productKey,
          area: product?.scope === 'area' ? form.area : undefined,
          categoryId: product?.scope === 'category_city' ? form.categoryId : undefined,
          city: product?.scope === 'category_city' ? form.city : undefined,
          startsAt: form.startsAt,
          unit: form.unit,
          quantity: Number(form.quantity),
          note: form.note || undefined,
        }),
      }),
    );
    if (r !== undefined) onDone();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Grant a free promotion"
      footer={
        <>
          <button className={btn.secondary} onClick={onClose}>
            Cancel
          </button>
          <button className={btn.primary} disabled={!business || !form.offerId || !!action.busy} onClick={grant}>
            Grant
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Feedback error={action.error} />
        {business ? (
          <div className="flex items-center gap-3 bg-surface rounded-2xl px-4 py-3">
            <span className="flex-1 font-extrabold">{business.name}</span>
            <button className={btn.link} onClick={() => setBusiness(null)}>
              Change
            </button>
          </div>
        ) : (
          <Field label="Business">
            <input className={inputClass} placeholder="Search by name or postcode" value={businessQuery} onChange={(e) => setBusinessQuery(e.target.value)} />
            <div className="flex flex-col gap-1 mt-1">
              {results.data?.items.slice(0, 6).map((b) => (
                <button key={b._id} type="button" className="text-left text-sm font-bold rounded-xl px-3 py-2 hover:bg-tint-blue cursor-pointer" onClick={() => setBusiness(b)}>
                  {b.name} <span className="text-muted">· {b.town ?? b.postcode}</span>
                </button>
              ))}
            </div>
          </Field>
        )}
        {business && (
          <Field label="Offer" hint="Only live or scheduled offers can be promoted.">
            <select className={inputClass} value={form.offerId} onChange={(e) => setForm({ ...form, offerId: e.target.value })}>
              <option value="">Choose…</option>
              {offers.data?.items.map((o) => (
                <option key={o._id} value={o._id}>
                  {o.title}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Product">
          <select className={inputClass} value={form.productKey} onChange={(e) => setForm({ ...form, productKey: e.target.value as PromotionProduct['key'] })}>
            {products.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        {product?.scope === 'area' && (
          <Field label="Postcode area" hint="e.g. M14">
            <input className={inputClass} value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value.toUpperCase() })} />
          </Field>
        )}
        {product?.scope === 'category_city' && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Category">
              <select className={inputClass} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">Choose…</option>
                {categories.data?.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="City">
              <input className={inputClass} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </Field>
          </div>
        )}
        <div className="grid grid-cols-3 gap-4">
          <Field label="Starts">
            <input type="date" className={inputClass} value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
          </Field>
          <Field label="Unit">
            <select className={inputClass} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
              {(product?.prices ?? []).map((p) => (
                <option key={p.unit} value={p.unit}>
                  {humanise(p.unit)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="How many">
            <input type="number" min={1} max={30} className={inputClass} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
          </Field>
        </div>
        <Field label="Note (audit log)">
          <input className={inputClass} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

export default function AdminPromotionsPage() {
  const { user } = useAuth();
  const manage = can(user, 'promotions.manage');
  const [tab, setTab] = useState<Tab>('bookings');
  const [granting, setGranting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const products = useApi<PromotionProduct[]>('/admin/promotions/products');

  return (
    <AdminPage
      title="Promotions"
      subtitle="Paid placements, labelled “Promoted” on the site."
      actions={
        manage && (
          <button className={btn.primary} onClick={() => setGranting(true)} disabled={!products.data}>
            <PlusIcon className="w-4 h-4" /> Grant free promotion
          </button>
        )
      }
    >
      <div className="mb-5">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>
      <Feedback error={products.error} notice={notice} className="mb-4" />
      {!products.data ? (
        <Spinner />
      ) : tab === 'bookings' ? (
        <Bookings key={version} products={products.data} manage={manage} />
      ) : tab === 'calendar' ? (
        <CalendarView key={version} />
      ) : (
        <div className="grid lg:grid-cols-2 gap-6">
          {products.data.map((p) => (
            <ProductCard key={JSON.stringify(p)} product={p} manage={manage} onSaved={() => void products.reload()} />
          ))}
        </div>
      )}
      {granting && products.data && (
        <GrantModal
          products={products.data}
          onClose={() => setGranting(false)}
          onDone={() => {
            setGranting(false);
            setNotice('Promotion granted');
            setVersion((v) => v + 1);
          }}
        />
      )}
    </AdminPage>
  );
}
