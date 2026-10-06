'use client';

import { useEffect, useState } from 'react';
import { api, assetUrl, errorMessage, upload } from '@/lib/api';
import { useBusiness } from '@/lib/business-context';
import { useApi } from '@/lib/hooks';
import type { Business, Category } from '@/lib/types';
import { Alert, btn, Card, Field, inputClass, SectionTitle, Spinner, Toggle } from '@/components/ui';
import { TrashIcon, UploadIcon } from '@/components/icons';
import { DashboardPage } from '../_components/shared';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const LINK_CHECK: Record<string, [string, 'success' | 'warning' | 'danger' | 'info']> = {
  own_domain: ['Your order link is on your own website.', 'success'],
  ordering_provider: ['Your order link is on a known ordering provider.', 'success'],
  mismatch: ['Your order link is not on your website or a known ordering provider, so a moderator checks it.', 'warning'],
  invalid: ['Your order link is not a valid web address.', 'danger'],
  none: ['Add a link to where customers order online.', 'info'],
};

interface MenuItem {
  _id: string;
  name: string;
  description?: string;
  price: number;
  section: string;
}

type Form = {
  name: string;
  description: string;
  address: string;
  postcode: string;
  town: string;
  phone: string;
  email: string;
  website: string;
  orderUrl: string;
  categories: string[];
  openingHours: Record<string, string>;
  logoUrl: string;
  coverUrl: string;
  photos: string[];
  delivery: boolean;
  collection: boolean;
  socialLinks: { facebook: string; instagram: string; tiktok: string; x: string };
  menuPdfUrl: string;
};

function formOf(b: Business): Form {
  return {
    name: b.name,
    description: b.description ?? '',
    address: b.address ?? '',
    postcode: b.postcode,
    town: b.town ?? '',
    phone: b.phone ?? '',
    email: b.email ?? '',
    website: b.website ?? '',
    orderUrl: b.orderUrl ?? '',
    categories: (b.categories as (Category | string)[]).map((c) => (typeof c === 'string' ? c : c._id)),
    openingHours: Object.fromEntries(DAYS.map((d) => [d, b.openingHours?.[d] ?? ''])),
    logoUrl: b.logoUrl ?? '',
    coverUrl: b.coverUrl ?? '',
    photos: b.photos ?? [],
    delivery: b.delivery !== false,
    collection: b.collection !== false,
    socialLinks: { facebook: b.socialLinks?.facebook ?? '', instagram: b.socialLinks?.instagram ?? '', tiktok: b.socialLinks?.tiktok ?? '', x: b.socialLinks?.x ?? '' },
    menuPdfUrl: b.menuPdfUrl ?? '',
  };
}

function MenuEditor({ businessId }: { businessId: string }) {
  const { data: items, reload } = useApi<MenuItem[]>(`/businesses/${businessId}/menu`);
  const [draft, setDraft] = useState({ section: '', name: '', description: '', price: '' });
  const [error, setError] = useState<string | null>(null);
  const sections = [...new Set((items ?? []).map((i) => i.section))];

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api(`/businesses/${businessId}/menu`, { method: 'POST', body: JSON.stringify({ ...draft, price: Number(draft.price) || 0, section: draft.section || 'Menu' }) });
      setDraft({ ...draft, name: '', description: '', price: '' });
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {sections.map((section) => (
        <div key={section}>
          <div className="font-extrabold mb-2">{section}</div>
          <ul className="flex flex-col gap-1">
            {(items ?? [])
              .filter((i) => i.section === section)
              .map((item) => (
                <li key={item._id} className="flex items-center gap-3 bg-surface rounded-xl px-4 py-2 text-sm">
                  <span className="flex-1 min-w-0">
                    <strong>{item.name}</strong>
                    {item.description && <span className="text-muted"> · {item.description}</span>}
                  </span>
                  <span className="font-bold">£{item.price.toFixed(2)}</span>
                  <button aria-label={`Remove ${item.name}`} className="text-muted hover:text-danger cursor-pointer" onClick={() => api(`/businesses/${businessId}/menu/${item._id}`, { method: 'DELETE' }).then(reload)}>
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </li>
              ))}
          </ul>
        </div>
      ))}
      {error && <Alert tone="danger">{error}</Alert>}
      <form onSubmit={add} className="grid sm:grid-cols-[140px_1fr_1fr_100px_auto] gap-2 items-end">
        <Field label="Section">
          <input value={draft.section} list="menu-sections" onChange={(e) => setDraft({ ...draft, section: e.target.value })} placeholder="Pizzas" className={inputClass} />
        </Field>
        <datalist id="menu-sections">
          {sections.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <Field label="Item">
          <input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Description">
          <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Price (£)">
          <input required type="number" min={0} step={0.01} value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} className={inputClass} />
        </Field>
        <button type="submit" className={btn.secondary}>
          Add
        </button>
      </form>
    </div>
  );
}

export default function ProfilePage() {
  const { business, manage, reload } = useBusiness();
  const { data: categories } = useApi<Category[]>('/categories');
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the form starts from the loaded business
    if (business && manage) setForm(formOf(manage.business));
  }, [business, manage]);

  if (!business || !manage || !form) return <Spinner />;
  const locked = manage.lockedFields;
  const lockHint = (field: string) => (locked.includes(field) ? 'Changes to this are checked by a moderator before they show.' : undefined);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const maxPhotos = manage.plan.limits.maxPhotos;
  const [linkText, linkTone] = LINK_CHECK[manage.orderLinkCheck] ?? LINK_CHECK.none;

  async function uploadImage(file: File, apply: (url: string) => void, key: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await upload<{ url: string }>(key === 'menu' ? '/uploads/menu' : '/uploads/image', file);
      apply(res.url);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ heldFields: string[] }>(`/businesses/${business!._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...form, openingHours: Object.fromEntries(Object.entries(form.openingHours).filter(([, v]) => v.trim())) }),
      });
      await reload();
      setNotice(res.heldFields.length ? `Saved. Your change to ${res.heldFields.join(', ')} is waiting for a moderator.` : 'Profile saved.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <DashboardPage title="Business profile" subtitle="What customers see on your page.">
      <form onSubmit={save} className="flex flex-col gap-6">
        {error && <Alert tone="danger">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
        {business.frozen && <Alert tone="danger">Changes are paused while we review a dispute about this listing.</Alert>}

        <Card className="flex flex-col gap-4">
          <SectionTitle>Basics</SectionTitle>
          <Field label="Business name" required hint={lockHint('name')}>
            <input required value={form.name} onChange={(e) => set('name', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Description">
            <textarea rows={4} maxLength={1500} value={form.description} onChange={(e) => set('description', e.target.value)} className={`${inputClass} resize-none`} />
          </Field>
          <Field label="Cuisines" hint="Up to 5.">
            <div className="flex gap-2 flex-wrap">
              {(categories ?? []).map((c) => {
                const on = form.categories.includes(c._id);
                return (
                  <button
                    type="button"
                    key={c._id}
                    aria-pressed={on}
                    onClick={() => set('categories', on ? form.categories.filter((x) => x !== c._id) : form.categories.length < 5 ? [...form.categories, c._id] : form.categories)}
                    className={`text-sm font-bold px-3 py-1.5 rounded-full border cursor-pointer ${on ? 'bg-primary text-white border-primary' : 'border-line hover:border-primary'}`}
                  >
                    {c.emoji} {c.name}
                  </button>
                );
              })}
            </div>
          </Field>
          <div className="flex gap-6 flex-wrap">
            <Toggle checked={form.delivery} onChange={(v) => set('delivery', v)} label="We deliver" />
            <Toggle checked={form.collection} onChange={(v) => set('collection', v)} label="Collection available" />
          </div>
        </Card>

        <Card className="flex flex-col gap-4">
          <SectionTitle>Location and contact</SectionTitle>
          <Field label="Address" hint={lockHint('address')}>
            <input value={form.address} onChange={(e) => set('address', e.target.value)} className={inputClass} />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Postcode" required hint={lockHint('postcode')}>
              <input required value={form.postcode} onChange={(e) => set('postcode', e.target.value.toUpperCase())} className={inputClass} />
            </Field>
            <Field label="Town" hint={lockHint('town')}>
              <input value={form.town} onChange={(e) => set('town', e.target.value)} className={inputClass} />
            </Field>
            <Field label="Shop phone" hint={lockHint('phone') ?? 'Verification codes go to this number.'}>
              <input value={form.phone} onChange={(e) => set('phone', e.target.value)} className={inputClass} />
            </Field>
            <Field label="Email">
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={inputClass} />
            </Field>
            <Field label="Website">
              <input value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" className={inputClass} />
            </Field>
            <Field label="Online ordering link" hint={lockHint('orderUrl')}>
              <input value={form.orderUrl} onChange={(e) => set('orderUrl', e.target.value)} placeholder="https://" className={inputClass} />
            </Field>
          </div>
          <Alert tone={linkTone}>{linkText}</Alert>
          <div className="grid sm:grid-cols-2 gap-4">
            {(['facebook', 'instagram', 'tiktok', 'x'] as const).map((network) => (
              <Field key={network} label={network === 'x' ? 'X (Twitter)' : network.charAt(0).toUpperCase() + network.slice(1)}>
                <input value={form.socialLinks[network]} onChange={(e) => set('socialLinks', { ...form.socialLinks, [network]: e.target.value })} placeholder="https://" className={inputClass} />
              </Field>
            ))}
          </div>
        </Card>

        <Card className="flex flex-col gap-4">
          <SectionTitle>Opening hours</SectionTitle>
          <div className="grid sm:grid-cols-2 gap-3">
            {DAYS.map((d) => (
              <Field key={d} label={<span className="capitalize">{d}</span>}>
                <input value={form.openingHours[d]} onChange={(e) => set('openingHours', { ...form.openingHours, [d]: e.target.value })} placeholder="17:00–23:00 or Closed" className={inputClass} />
              </Field>
            ))}
          </div>
        </Card>

        <Card className="flex flex-col gap-5">
          <SectionTitle>Logo and photos</SectionTitle>
          <div className="flex gap-6 flex-wrap">
            {(['logoUrl', 'coverUrl'] as const).map((key) => (
              <div key={key} className="flex flex-col gap-2">
                <span className="text-sm font-extrabold">{key === 'logoUrl' ? 'Logo' : 'Cover photo'}</span>
                <div className={`${key === 'logoUrl' ? 'w-24 h-24 rounded-full' : 'w-48 h-24 rounded-2xl'} bg-surface overflow-hidden flex items-center justify-center text-muted text-xs`}>
                  {form[key] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={assetUrl(form[key])} alt="" className="w-full h-full object-cover" />
                  ) : (
                    'None'
                  )}
                </div>
                <label className={`${btn.small} cursor-pointer`}>
                  {busy === key ? 'Uploading…' : 'Upload'}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0], (url) => set(key, url), key)} />
                </label>
              </div>
            ))}
          </div>
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-sm font-extrabold">Gallery</span>
              <span className="text-[13px] text-muted">
                {form.photos.length} of {maxPhotos < 0 ? 'unlimited' : maxPhotos} photos on your plan
              </span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {form.photos.map((photo) => (
                <div key={photo} className="relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={assetUrl(photo)} alt="" className="w-full aspect-square object-cover rounded-xl" />
                  <button type="button" aria-label="Remove photo" onClick={() => set('photos', form.photos.filter((p) => p !== photo))} className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-card/90 flex items-center justify-center cursor-pointer">
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {(maxPhotos < 0 || form.photos.length < maxPhotos) && (
                <label className="aspect-square rounded-xl border-2 border-dashed border-line flex flex-col items-center justify-center gap-1 text-muted text-xs font-bold cursor-pointer hover:border-primary">
                  <UploadIcon className="w-5 h-5" />
                  {busy === 'photo' ? 'Uploading…' : 'Add photo'}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0], (url) => set('photos', [...form.photos, url]), 'photo')} />
                </label>
              )}
            </div>
          </div>
        </Card>

        <Card className="flex flex-col gap-4">
          <SectionTitle>Menu</SectionTitle>
          <div className="flex items-center gap-3 flex-wrap">
            {form.menuPdfUrl ? (
              <>
                <a href={assetUrl(form.menuPdfUrl)} target="_blank" rel="noopener noreferrer" className={btn.link}>
                  View your PDF menu
                </a>
                <button type="button" className="text-sm font-bold text-muted hover:text-danger cursor-pointer" onClick={() => set('menuPdfUrl', '')}>
                  Remove
                </button>
              </>
            ) : (
              <span className="text-sm text-muted">Upload a PDF menu, add sections below, or both.</span>
            )}
            <label className={`${btn.small} cursor-pointer`}>
              {busy === 'menu' ? 'Uploading…' : form.menuPdfUrl ? 'Replace PDF' : 'Upload PDF menu'}
              <input type="file" accept="application/pdf" className="sr-only" onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0], (url) => set('menuPdfUrl', url), 'menu')} />
            </label>
          </div>
          <MenuEditor businessId={business._id} />
        </Card>

        <div className="sticky bottom-0 bg-card/95 backdrop-blur py-4 border-t border-line flex gap-3">
          <button type="submit" disabled={busy === 'save' || business.frozen} className={btn.primary}>
            {busy === 'save' ? 'Saving…' : 'Save profile'}
          </button>
          <button type="button" className={btn.secondary} onClick={() => setForm(formOf(manage.business))}>
            Discard changes
          </button>
        </div>
      </form>
    </DashboardPage>
  );
}
