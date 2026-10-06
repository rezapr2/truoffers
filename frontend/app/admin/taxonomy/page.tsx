'use client';

import { useState } from 'react';
import { btn, EmptyState, Feedback, Field, inputClass, Modal, Spinner, Tabs, Tag, Toggle } from '@/components/ui';
import { PlusIcon } from '@/components/icons';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import type { Category } from '@/lib/types';
import { AdminPage, RequireCapability, Table, Td, Th } from '../_components/admin-ui';

interface Area {
  _id: string;
  name: string;
  slug: string;
  icon?: string;
  sortOrder: number;
  seoText?: string;
  postcodeDistricts: string[];
  active: boolean;
}

interface OfferType {
  _id: string;
  key: string;
  label: string;
  icon?: string;
  sortOrder: number;
  active: boolean;
}

const TABS = [
  { value: 'cuisines', label: 'Cuisines' },
  { value: 'areas', label: 'Cities & areas' },
  { value: 'types', label: 'Offer types' },
] as const;
type Tab = (typeof TABS)[number]['value'];

type Editing<T> = { item: T | null; form: Record<string, string | number | boolean> } | null;

function Cuisines() {
  const { data, error, reload } = useApi<Category[]>('/admin/taxonomy/categories');
  const action = useAction();
  const [editing, setEditing] = useState<Editing<Category>>(null);

  const open = (c: Category | null) =>
    setEditing({ item: c, form: { name: c?.name ?? '', slug: c?.slug ?? '', emoji: c?.emoji ?? '', sortOrder: c?.sortOrder ?? 0, seoText: c?.seoText ?? '', active: c?.active !== false } });

  const save = async () => {
    if (!editing) return;
    const body = { ...editing.form, sortOrder: Number(editing.form.sortOrder) };
    const r = await action.run('save', () => (editing.item ? api(`/admin/taxonomy/categories/${editing.item._id}`, { method: 'PATCH', body: JSON.stringify(body) }) : api('/admin/taxonomy/categories', { method: 'POST', body: JSON.stringify(body) })), 'Saved');
    if (r !== undefined) {
      setEditing(null);
      await reload();
    }
  };

  const remove = async (c: Category) => {
    if (!window.confirm(`Delete ${c.name}?`)) return;
    await action.run(c._id, () => api(`/admin/taxonomy/categories/${c._id}`, { method: 'DELETE' }), 'Deleted');
    await reload();
  };

  const form = editing?.form;
  const set = (key: string, value: string | number | boolean) => editing && setEditing({ ...editing, form: { ...editing.form, [key]: value } });

  return (
    <>
      <div className="flex justify-end mb-4">
        <button className={btn.primary} onClick={() => open(null)}>
          <PlusIcon className="w-4 h-4" /> Add cuisine
        </button>
      </div>
      <Feedback error={action.error ?? error} notice={action.notice} className="mb-4" />
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <EmptyState title="No cuisines" />
      ) : (
        <Table>
          <thead className="bg-surface">
            <tr>
              <Th>Cuisine</Th>
              <Th>Address</Th>
              <Th>Takeaways</Th>
              <Th>Order</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c._id} className="border-t border-line hover:bg-surface/60 cursor-pointer" onClick={() => open(c)}>
                <Td className="font-extrabold">
                  {c.emoji} {c.name}
                </Td>
                <Td className="font-mono text-[12.5px]">/categories/{c.slug}</Td>
                <Td>{c.businessCount}</Td>
                <Td>{c.sortOrder ?? 0}</Td>
                <Td>{c.active === false ? <Tag>Hidden</Tag> : <Tag tone="good">Shown</Tag>}</Td>
                <Td>
                  <button
                    className={btn.smallDanger}
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(c);
                    }}
                  >
                    Delete
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.item ? `Edit ${editing.item.name}` : 'Add cuisine'}
        footer={
          <>
            <button className={btn.secondary} onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className={btn.primary} disabled={!form?.name || !!action.busy} onClick={save}>
              Save
            </button>
          </>
        }
      >
        {form && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-[1fr_100px] gap-4">
              <Field label="Name" required>
                <input className={inputClass} value={String(form.name)} onChange={(e) => set('name', e.target.value)} />
              </Field>
              <Field label="Emoji">
                <input className={inputClass} value={String(form.emoji)} onChange={(e) => set('emoji', e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Address" hint="Empty = from the name">
                <input className={inputClass} value={String(form.slug)} onChange={(e) => set('slug', e.target.value)} />
              </Field>
              <Field label="Sort order">
                <input type="number" className={inputClass} value={Number(form.sortOrder)} onChange={(e) => set('sortOrder', Number(e.target.value))} />
              </Field>
            </div>
            <Field label="SEO text" hint="Shown on the cuisine page.">
              <textarea rows={4} className={inputClass} value={String(form.seoText)} onChange={(e) => set('seoText', e.target.value)} />
            </Field>
            <Toggle checked={!!form.active} onChange={(v) => set('active', v)} label="Shown on the site" />
          </div>
        )}
      </Modal>
    </>
  );
}

function Areas() {
  const { data, error, reload } = useApi<Area[]>('/admin/taxonomy/areas');
  const action = useAction();
  const [editing, setEditing] = useState<Editing<Area>>(null);

  const open = (a: Area | null) =>
    setEditing({
      item: a,
      form: { name: a?.name ?? '', slug: a?.slug ?? '', icon: a?.icon ?? '', sortOrder: a?.sortOrder ?? 0, seoText: a?.seoText ?? '', postcodeDistricts: (a?.postcodeDistricts ?? []).join(', '), active: a?.active !== false },
    });

  const save = async () => {
    if (!editing) return;
    const body = {
      ...editing.form,
      sortOrder: Number(editing.form.sortOrder),
      postcodeDistricts: String(editing.form.postcodeDistricts)
        .split(/[\s,]+/)
        .filter(Boolean),
    };
    const r = await action.run('save', () => (editing.item ? api(`/admin/taxonomy/areas/${editing.item._id}`, { method: 'PATCH', body: JSON.stringify(body) }) : api('/admin/taxonomy/areas', { method: 'POST', body: JSON.stringify(body) })), 'Saved');
    if (r !== undefined) {
      setEditing(null);
      await reload();
    }
  };

  const remove = async (a: Area) => {
    if (!window.confirm(`Delete ${a.name}?`)) return;
    await action.run(a._id, () => api(`/admin/taxonomy/areas/${a._id}`, { method: 'DELETE' }), 'Deleted');
    await reload();
  };

  const form = editing?.form;
  const set = (key: string, value: string | number | boolean) => editing && setEditing({ ...editing, form: { ...editing.form, [key]: value } });

  return (
    <>
      <div className="flex justify-end mb-4">
        <button className={btn.primary} onClick={() => open(null)}>
          <PlusIcon className="w-4 h-4" /> Add city
        </button>
      </div>
      <Feedback error={action.error ?? error} notice={action.notice} className="mb-4" />
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <EmptyState title="No cities yet">Cities give the takeaway directory its own pages, e.g. /takeaways/manchester, with SEO text.</EmptyState>
      ) : (
        <Table>
          <thead className="bg-surface">
            <tr>
              <Th>City</Th>
              <Th>Address</Th>
              <Th>Postcode districts</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.map((a) => (
              <tr key={a._id} className="border-t border-line hover:bg-surface/60 cursor-pointer" onClick={() => open(a)}>
                <Td className="font-extrabold">
                  {a.icon} {a.name}
                </Td>
                <Td className="font-mono text-[12.5px]">/takeaways/{a.slug}</Td>
                <Td className="text-[13px] max-w-[280px] truncate">{a.postcodeDistricts.join(', ') || '—'}</Td>
                <Td>{a.active ? <Tag tone="good">Shown</Tag> : <Tag>Hidden</Tag>}</Td>
                <Td>
                  <button
                    className={btn.smallDanger}
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(a);
                    }}
                  >
                    Delete
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.item ? `Edit ${editing.item.name}` : 'Add city'}
        footer={
          <>
            <button className={btn.secondary} onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className={btn.primary} disabled={!form?.name || !!action.busy} onClick={save}>
              Save
            </button>
          </>
        }
      >
        {form && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-[1fr_100px] gap-4">
              <Field label="Name" required>
                <input className={inputClass} value={String(form.name)} onChange={(e) => set('name', e.target.value)} />
              </Field>
              <Field label="Icon">
                <input className={inputClass} value={String(form.icon)} onChange={(e) => set('icon', e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Address" hint="Matches the town name, e.g. manchester">
                <input className={inputClass} value={String(form.slug)} onChange={(e) => set('slug', e.target.value)} />
              </Field>
              <Field label="Sort order">
                <input type="number" className={inputClass} value={Number(form.sortOrder)} onChange={(e) => set('sortOrder', Number(e.target.value))} />
              </Field>
            </div>
            <Field label="Postcode districts" hint="e.g. M1, M2, M14">
              <input className={inputClass} value={String(form.postcodeDistricts)} onChange={(e) => set('postcodeDistricts', e.target.value)} />
            </Field>
            <Field label="SEO text" hint="Shown at the bottom of the city page.">
              <textarea rows={5} className={inputClass} value={String(form.seoText)} onChange={(e) => set('seoText', e.target.value)} />
            </Field>
            <Toggle checked={!!form.active} onChange={(v) => set('active', v)} label="Shown on the site" />
          </div>
        )}
      </Modal>
    </>
  );
}

function OfferTypes() {
  const { data, error, reload } = useApi<OfferType[]>('/admin/taxonomy/offer-types');
  const action = useAction();
  const [labels, setLabels] = useState<Record<string, string>>({});

  const save = async (t: OfferType, patch: Partial<OfferType>) => {
    await action.run(t.key, () => api(`/admin/taxonomy/offer-types/${t.key}`, { method: 'PATCH', body: JSON.stringify(patch) }), 'Saved');
    await reload();
  };

  return (
    <>
      <p className="text-sm text-muted mb-4">The kinds of offer a business can choose in the offer editor. Hidden types can’t be picked for new offers.</p>
      <Feedback error={action.error ?? error} notice={action.notice} className="mb-4" />
      {!data ? (
        <Spinner />
      ) : (
        <Table minWidth={640}>
          <thead className="bg-surface">
            <tr>
              <Th>Type</Th>
              <Th>Label</Th>
              <Th>Shown</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((t) => (
              <tr key={t.key} className="border-t border-line">
                <Td className="font-mono text-[12.5px]">{t.key}</Td>
                <Td>
                  <div className="flex gap-2">
                    <input className={`${inputClass} !py-1.5`} value={labels[t.key] ?? t.label} onChange={(e) => setLabels({ ...labels, [t.key]: e.target.value })} />
                    {labels[t.key] !== undefined && labels[t.key] !== t.label && (
                      <button className={btn.smallPrimary} disabled={!!action.busy} onClick={() => save(t, { label: labels[t.key] })}>
                        Save
                      </button>
                    )}
                  </div>
                </Td>
                <Td>
                  <Toggle checked={t.active} onChange={(v) => save(t, { active: v })} label="" disabled={!!action.busy} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

export default function AdminTaxonomyPage() {
  const [tab, setTab] = useState<Tab>('cuisines');
  return (
    <RequireCapability capability="taxonomy.manage">
      <AdminPage title="Categories & cities" subtitle="Cuisines, the cities with their own directory pages, and offer types.">
        <div className="mb-5">
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
        </div>
        {tab === 'cuisines' && <Cuisines />}
        {tab === 'areas' && <Areas />}
        {tab === 'types' && <OfferTypes />}
      </AdminPage>
    </RequireCapability>
  );
}
