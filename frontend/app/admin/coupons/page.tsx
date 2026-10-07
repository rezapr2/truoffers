'use client';

import { useState } from 'react';
import { btn, EmptyState, Feedback, Field, inputClass, Modal, Spinner, Tag, Toggle } from '@/components/ui';
import { PlusIcon } from '@/components/icons';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { date, humanise, money } from '@/lib/format';
import { AdminPage, RequireCapability, Table, Td, Th } from '../_components/admin-ui';

interface Coupon {
  _id: string;
  code: string;
  description?: string;
  percentOff?: number;
  amountOff?: number;
  duration: 'once' | 'repeating' | 'forever';
  durationInMonths?: number;
  appliesToPlans: string[];
  maxUses?: number;
  timesUsed: number;
  expiresAt?: string;
  active: boolean;
  createdAt: string;
}

interface CouponForm {
  code: string;
  description: string;
  kind: 'percent' | 'amount';
  value: string;
  duration: 'once' | 'repeating' | 'forever';
  durationInMonths: string;
  appliesToPlans: string[];
  maxUses: string;
  expiresAt: string;
  active: boolean;
}

const EMPTY: CouponForm = { code: '', description: '', kind: 'percent', value: '', duration: 'once', durationInMonths: '3', appliesToPlans: [], maxUses: '', expiresAt: '', active: true };
const PLANS = ['standard', 'professional'];

const discount = (c: Coupon) => (c.percentOff ? `${c.percentOff}% off` : `${money(c.amountOff)} off`) + (c.duration === 'forever' ? ', forever' : c.duration === 'repeating' ? ` for ${c.durationInMonths} months` : ', first payment');

/** Spec "Coupons": create, limit, expire and switch off discount codes. Terms are fixed once created. */
function Coupons() {
  const { data, error, reload } = useApi<Coupon[]>('/admin/coupons');
  const action = useAction();
  const [editing, setEditing] = useState<Coupon | 'new' | null>(null);
  const [form, setForm] = useState<CouponForm>(EMPTY);
  const creating = editing === 'new';

  const open = (c: Coupon | 'new') => {
    setEditing(c);
    setForm(
      c === 'new'
        ? EMPTY
        : {
            ...EMPTY,
            code: c.code,
            description: c.description ?? '',
            appliesToPlans: c.appliesToPlans,
            maxUses: c.maxUses ? String(c.maxUses) : '',
            expiresAt: c.expiresAt ? c.expiresAt.slice(0, 10) : '',
            active: c.active,
          },
    );
  };

  const save = async () => {
    const common = {
      description: form.description || undefined,
      appliesToPlans: form.appliesToPlans,
      maxUses: form.maxUses ? Number(form.maxUses) : null,
      expiresAt: form.expiresAt || null,
      active: form.active,
    };
    const body = creating
      ? {
          ...common,
          code: form.code,
          percentOff: form.kind === 'percent' ? Number(form.value) : undefined,
          amountOff: form.kind === 'amount' ? Number(form.value) : undefined,
          duration: form.duration,
          durationInMonths: form.duration === 'repeating' ? Number(form.durationInMonths) : undefined,
        }
      : common;
    const result = await action.run(
      'save',
      () => (creating ? api('/admin/coupons', { method: 'POST', body: JSON.stringify(body) }) : api(`/admin/coupons/${(editing as Coupon)._id}`, { method: 'PATCH', body: JSON.stringify(body) })),
      creating ? `${form.code.toUpperCase()} created` : 'Coupon saved',
    );
    if (result !== undefined) {
      setEditing(null);
      await reload();
    }
  };

  return (
    <AdminPage
      title="Coupons"
      subtitle="Discount codes businesses can enter at checkout."
      actions={
        <button className={btn.primary} onClick={() => open('new')}>
          <PlusIcon className="w-4 h-4" /> New coupon
        </button>
      }
    >
      <Feedback error={action.error ?? error} notice={action.notice} className="mb-4" />
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <EmptyState title="No coupons yet" />
      ) : (
        <Table>
          <thead className="bg-surface">
            <tr>
              <Th>Code</Th>
              <Th>Discount</Th>
              <Th>Plans</Th>
              <Th>Used</Th>
              <Th>Expires</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((c) => {
              const expired = c.expiresAt && new Date(c.expiresAt) < new Date();
              return (
                <tr key={c._id} className="border-t border-line hover:bg-surface/60 cursor-pointer" onClick={() => open(c)}>
                  <Td>
                    <div className="font-mono font-extrabold">{c.code}</div>
                    {c.description && <div className="text-[12.5px] text-muted">{c.description}</div>}
                  </Td>
                  <Td>{discount(c)}</Td>
                  <Td>{c.appliesToPlans.length ? c.appliesToPlans.map(humanise).join(', ') : 'All'}</Td>
                  <Td>
                    {c.timesUsed}
                    {c.maxUses ? ` / ${c.maxUses}` : ''}
                  </Td>
                  <Td className="text-[13px]">{c.expiresAt ? date(c.expiresAt) : 'Never'}</Td>
                  <Td>{!c.active ? <Tag>Off</Tag> : expired ? <Tag tone="warn">Expired</Tag> : c.maxUses && c.timesUsed >= c.maxUses ? <Tag tone="warn">Used up</Tag> : <Tag tone="good">Active</Tag>}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={creating ? 'New coupon' : `Coupon ${form.code}`}
        footer={
          <>
            <button className={btn.secondary} onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className={btn.primary} disabled={!!action.busy || (creating && (!form.code || !(Number(form.value) > 0)))} onClick={save}>
              Save
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {creating ? (
            <>
              <Field label="Code" hint="3–30 letters, numbers, - or _" required>
                <input className={`${inputClass} font-mono uppercase`} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Discount">
                  <select className={inputClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as CouponForm['kind'] })}>
                    <option value="percent">Percentage</option>
                    <option value="amount">Amount (£)</option>
                  </select>
                </Field>
                <Field label={form.kind === 'percent' ? 'Percent off' : 'Pounds off'} required>
                  <input type="number" min={0.01} max={form.kind === 'percent' ? 100 : undefined} className={inputClass} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Applies to">
                  <select className={inputClass} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value as CouponForm['duration'] })}>
                    <option value="once">The first payment</option>
                    <option value="repeating">Several months</option>
                    <option value="forever">Every payment</option>
                  </select>
                </Field>
                {form.duration === 'repeating' && (
                  <Field label="Months">
                    <input type="number" min={1} max={36} className={inputClass} value={form.durationInMonths} onChange={(e) => setForm({ ...form, durationInMonths: e.target.value })} />
                  </Field>
                )}
              </div>
            </>
          ) : (
            editing && <p className="text-sm text-muted">{discount(editing)}. The discount itself can’t change once created; make a new code instead.</p>
          )}
          <Field label="Description (internal)">
            <input className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Plans" hint="None selected = every paid plan">
            <div className="flex gap-2">
              {PLANS.map((p) => {
                const on = form.appliesToPlans.includes(p);
                return (
                  <button key={p} type="button" className={on ? btn.smallPrimary : btn.small} onClick={() => setForm({ ...form, appliesToPlans: on ? form.appliesToPlans.filter((x) => x !== p) : [...form.appliesToPlans, p] })}>
                    {humanise(p)}
                  </button>
                );
              })}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Maximum uses" hint="Empty = unlimited">
              <input type="number" min={1} className={inputClass} value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} />
            </Field>
            <Field label="Expires">
              <input type="date" className={inputClass} value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
            </Field>
          </div>
          <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Active" />
        </div>
      </Modal>
    </AdminPage>
  );
}

export default function AdminCouponsPage() {
  return (
    <RequireCapability capability="coupons.manage">
      <Coupons />
    </RequireCapability>
  );
}
