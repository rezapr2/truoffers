'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, btn, Detail, Drawer, Feedback, Field, inputClass, Modal, SectionTitle, Spinner, StatusPill, Tabs, Tag, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { can, useAuth } from '@/lib/auth-context';
import { useAction, useApi, useDebounced } from '@/lib/hooks';
import { date, dateTime, humanise, money } from '@/lib/format';
import type { Category, Plan } from '@/lib/types';
import { AuditTrail, type AuditEntry } from '../_components/admin-ui';

interface BusinessDetail {
  business: {
    _id: string;
    name: string;
    slug: string;
    description?: string;
    address?: string;
    postcode: string;
    town?: string;
    phone?: string;
    email?: string;
    website?: string;
    orderUrl?: string;
    delivery?: boolean;
    collection?: boolean;
    categories: { _id: string; name: string }[];
    verificationLevel: number;
    verifiedAt?: string;
    reverificationDueAt?: string;
    status: string;
    source?: string;
    frozen?: boolean;
    featured?: boolean;
    isFoodbellClient?: boolean;
    trustScore: number;
    fhrsRating?: string;
    suspendedAt?: string;
    suspensionReason?: string;
    suspensionReview?: { flaggedAt?: string; reason?: string; resolvedAt?: string; resolution?: string };
    mergedInto?: string;
    activeOfferCount: number;
    followerCount: number;
    createdAt: string;
    members: { userId: string; role: string; addedAt?: string; user?: { _id: string; name: string; email: string; status: string; lastLoginAt?: string } }[];
  };
  orderLinkCheck: string;
  offers: { _id: string; title: string; status: string; displayLabel: string; origin?: string; impressions: number; orderClicks: number; createdAt: string }[];
  subscription?: { _id: string; planKey: string; status: string; interval: string; price: number; comp?: boolean; currentPeriodEnd?: string; cancelAtPeriodEnd?: boolean };
  payments: { _id: string; number?: string; description?: string; total: number; status: string; createdAt: string }[];
  claims: { _id: string; status: string; kind: string; userId?: { name: string; email: string }; submittedAt?: string; decidedAt?: string; reasonCode?: string }[];
  reportCases: { _id: string; status: string; reportCount: number; offerId?: { title: string } }[];
  strikesInWindow: number;
  trail: AuditEntry[];
}

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'edit', label: 'Edit profile' },
  { value: 'team', label: 'Team & owner' },
  { value: 'offers', label: 'Offers' },
  { value: 'billing', label: 'Billing' },
  { value: 'history', label: 'History' },
] as const;
type Tab = (typeof TABS)[number]['value'];

const LEVELS = [
  { value: 0, label: '0 · Listed, unclaimed' },
  { value: 1, label: '1 · Claim pending (drafts only)' },
  { value: 2, label: '2 · Verified' },
  { value: 3, label: '3 · Verified + trusted' },
];

type EditFields = Partial<Pick<BusinessDetail['business'], 'name' | 'description' | 'address' | 'postcode' | 'town' | 'phone' | 'email' | 'website' | 'orderUrl' | 'delivery' | 'collection'>> & { categories?: string[] };

function ProfileForm({ initial, onSubmit, busy, submitLabel }: { initial: EditFields; onSubmit: (fields: EditFields) => void; busy: boolean; submitLabel: string }) {
  const [form, setForm] = useState<EditFields>(initial);
  const { data: categories } = useApi<Category[]>('/categories');
  const set = (key: keyof EditFields, value: unknown) => setForm({ ...form, [key]: value });
  const text = (key: keyof EditFields, label: string, required = false) => (
    <Field label={label} required={required}>
      <input className={inputClass} value={(form[key] as string) ?? ''} onChange={(e) => set(key, e.target.value)} />
    </Field>
  );
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
    >
      {text('name', 'Name', true)}
      <Field label="Description">
        <textarea rows={3} className={inputClass} value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} />
      </Field>
      {text('address', 'Address')}
      <div className="grid grid-cols-2 gap-4">
        {text('town', 'Town')}
        {text('postcode', 'Postcode', true)}
      </div>
      <div className="grid grid-cols-2 gap-4">
        {text('phone', 'Phone')}
        {text('email', 'Email')}
      </div>
      {text('website', 'Website')}
      {text('orderUrl', 'Order link')}
      <Field label="Categories" hint="Up to 5">
        <div className="flex gap-1.5 flex-wrap">
          {categories?.map((c) => {
            const on = form.categories?.includes(c._id);
            return (
              <button
                type="button"
                key={c._id}
                className={on ? btn.smallPrimary : btn.small}
                onClick={() => set('categories', on ? form.categories?.filter((id) => id !== c._id) : [...(form.categories ?? []), c._id].slice(0, 5))}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      </Field>
      <div className="flex gap-6">
        <Toggle checked={form.delivery !== false} onChange={(v) => set('delivery', v)} label="Delivery" />
        <Toggle checked={form.collection !== false} onChange={(v) => set('collection', v)} label="Collection" />
      </div>
      <div>
        <button className={btn.primary} disabled={busy || !form.name || !form.postcode}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

/** Spec: "Create, edit any field, merge duplicates, change owner, set verification level, suspend, impersonate (logged)." */
export function BusinessDrawer({ id, onClose, onChanged, onOpen }: { id: string; onClose: () => void; onChanged: () => void; onOpen: (id: string) => void }) {
  const { user, impersonate } = useAuth();
  const router = useRouter();
  const { data, error, reload } = useApi<BusinessDetail>(`/admin/businesses/${id}`);
  const plans = useApi<Plan[]>(can(user, 'billing.manage') ? '/billing/plans?audience=takeaway' : null);
  const action = useAction();
  const [tab, setTab] = useState<Tab>('overview');
  const [modal, setModal] = useState<null | 'level' | 'suspend' | 'flag' | 'resolve' | 'owner' | 'merge' | 'plan' | 'archive'>(null);
  const [text, setText] = useState('');
  const [level, setLevel] = useState(2);
  const [keepOwners, setKeepOwners] = useState(false);
  const [mergeQuery, setMergeQuery] = useState('');
  const [mergeInto, setMergeInto] = useState<{ _id: string; name: string } | null>(null);
  const [planForm, setPlanForm] = useState({ planKey: 'standard', interval: 'monthly', comp: true, months: 1 });
  const mergeSearch = useDebounced(mergeQuery);
  const mergeResults = useApi<{ items: { _id: string; name: string; postcode: string; town?: string }[] }>(modal === 'merge' && mergeSearch.length >= 2 ? `/admin/businesses?q=${encodeURIComponent(mergeSearch)}` : null);

  const b = data?.business;

  const refresh = async (result: unknown) => {
    if (result === undefined) return;
    setModal(null);
    setText('');
    await reload();
    onChanged();
  };

  const post = (path: string, body: object, success: string) =>
    action.run(path, () => api(`/admin/businesses/${id}${path}`, { method: 'POST', body: JSON.stringify(body) }), success).then(refresh);

  const viewAs = async () => {
    const session = await action.run('impersonate', () => api<{ accessToken: string; businessId: string }>(`/admin/businesses/${id}/impersonate`, { method: 'POST' }));
    if (!session) return;
    try {
      localStorage.setItem('truoffers_business', session.businessId);
    } catch {
      /* storage unavailable */
    }
    await impersonate(session.accessToken);
    router.push('/dashboard');
  };

  const modalBody = () => {
    switch (modal) {
      case 'level':
        return (
          <div className="flex flex-col gap-4">
            <Field label="Verification level">
              <select className={inputClass} value={level} onChange={(e) => setLevel(Number(e.target.value))}>
                {LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Why (kept in the audit log)">
              <textarea rows={3} className={inputClass} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
          </div>
        );
      case 'suspend':
      case 'flag':
      case 'resolve':
        return (
          <Field
            label={modal === 'resolve' ? 'Resolution' : 'Reason'}
            hint={modal === 'suspend' ? 'The listing and its offers disappear from the site. The owner is emailed this reason.' : modal === 'flag' ? 'An admin will decide whether to suspend.' : undefined}
            required
          >
            <textarea rows={3} className={inputClass} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        );
      case 'owner':
        return (
          <div className="flex flex-col gap-4">
            <Field label="New owner’s email" hint="They need a TruOffers account already." required>
              <input type="email" className={inputClass} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <Toggle checked={keepOwners} onChange={setKeepOwners} label="Keep the current owners on the team" />
          </div>
        );
      case 'merge':
        return (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              Offers, team, claims, followers and a paid plan move to the listing you pick. <strong>{b?.name}</strong> is archived and points there.
            </p>
            <Field label="Merge into">
              <input className={inputClass} placeholder="Search by name or postcode" value={mergeQuery} onChange={(e) => setMergeQuery(e.target.value)} />
            </Field>
            <div className="flex flex-col gap-1.5">
              {mergeResults.data?.items
                .filter((r) => r._id !== id)
                .map((r) => (
                  <button
                    key={r._id}
                    type="button"
                    onClick={() => setMergeInto(r)}
                    className={`text-left rounded-2xl px-4 py-2.5 text-sm cursor-pointer ${mergeInto?._id === r._id ? 'bg-tint-blue font-extrabold' : 'bg-surface font-bold hover:bg-tint-blue/60'}`}
                  >
                    {r.name} <span className="text-muted font-semibold">· {[r.town, r.postcode].filter(Boolean).join(' · ')}</span>
                  </button>
                ))}
            </div>
          </div>
        );
      case 'plan':
        return (
          <div className="flex flex-col gap-4">
            <Field label="Plan">
              <select className={inputClass} value={planForm.planKey} onChange={(e) => setPlanForm({ ...planForm, planKey: e.target.value })}>
                {(plans.data ?? []).map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Toggle checked={planForm.comp} onChange={(v) => setPlanForm({ ...planForm, comp: v })} label="Complimentary (no charge)" hint="Off: the business is charged through Stripe on its saved card." />
            {planForm.comp ? (
              <Field label="For how many months">
                <input type="number" min={1} max={36} className={inputClass} value={planForm.months} onChange={(e) => setPlanForm({ ...planForm, months: Number(e.target.value) })} />
              </Field>
            ) : (
              <Field label="Billing">
                <select className={inputClass} value={planForm.interval} onChange={(e) => setPlanForm({ ...planForm, interval: e.target.value })}>
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual</option>
                </select>
              </Field>
            )}
            <Field label="Note">
              <input className={inputClass} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
          </div>
        );
      case 'archive':
        return <p className="text-sm">The listing is hidden everywhere. Use this for closed takeaways; use merge for duplicates.</p>;
      default:
        return null;
    }
  };

  const confirm = () => {
    switch (modal) {
      case 'level':
        return post('/level', { level, note: text || undefined }, `Level set to ${level}`);
      case 'suspend':
        return post('/suspend', { reason: text }, 'Suspended');
      case 'flag':
        return post('/suspension-review', { reason: text }, 'Flagged for an admin to review');
      case 'resolve':
        return post('/suspension-review/resolve', { resolution: text }, 'Review closed');
      case 'owner':
        return post('/owner', { email: text, keepPreviousOwners: keepOwners }, 'Owner changed');
      case 'merge':
        return mergeInto && post('/merge', { intoId: mergeInto._id }, `Merged into ${mergeInto.name}`).then(() => onOpen(mergeInto._id));
      case 'archive':
        return post('/archive', {}, 'Archived');
      case 'plan':
        return action
          .run(
            'plan',
            () =>
              api(`/admin/billing/businesses/${id}/plan`, {
                method: 'POST',
                body: JSON.stringify({ ...planForm, months: planForm.comp ? planForm.months : undefined, note: text || undefined }),
              }),
            'Plan changed',
          )
          .then(refresh);
    }
  };

  const confirmDisabled =
    !!action.busy ||
    (['suspend', 'flag'].includes(modal ?? '') && text.trim().length < 3) ||
    (modal === 'resolve' && text.trim().length < 2) ||
    (modal === 'owner' && !text.includes('@')) ||
    (modal === 'merge' && !mergeInto);

  const open = (m: typeof modal) => {
    setText('');
    if (m === 'level' && b) setLevel(b.verificationLevel);
    setModal(m);
  };

  const reviewOpen = b?.suspensionReview?.flaggedAt && !b.suspensionReview.resolvedAt;

  return (
    <Drawer
      open
      onClose={onClose}
      title={b?.name ?? 'Business'}
      subtitle={
        b && (
          <span className="flex items-center gap-2 flex-wrap">
            <StatusPill status={b.status} />
            <Tag tone={b.verificationLevel >= 2 ? 'good' : 'neutral'}>Level {b.verificationLevel}</Tag>
            {b.isFoodbellClient && <Tag tone="info">Foodbell partner</Tag>}
            {b.frozen && <Tag tone="bad">Frozen</Tag>}
            <Link href={`/takeaway/${b.slug}`} target="_blank" className="text-primary font-bold">
              Public page ↗
            </Link>
          </span>
        )
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {!data || !b ? (
        !error && <Spinner />
      ) : (
        <div className="flex flex-col gap-5">
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
          <Feedback error={action.error} notice={action.notice} />

          {tab === 'overview' && (
            <>
              {b.status === 'suspended' && (
                <Alert tone="danger" title={`Suspended ${date(b.suspendedAt)}`}>
                  {b.suspensionReason}
                </Alert>
              )}
              {reviewOpen && (
                <Alert tone="warning" title="Suspension review requested">
                  {b.suspensionReview?.reason}
                </Alert>
              )}
              {b.mergedInto && (
                <Alert tone="info" action={<button className={btn.small} onClick={() => onOpen(b.mergedInto!)}>Open</button>}>
                  Merged into another listing.
                </Alert>
              )}
              <dl>
                <Detail label="Address">{[b.address, b.town, b.postcode].filter(Boolean).join(', ')}</Detail>
                <Detail label="Phone">{b.phone ?? '—'}</Detail>
                <Detail label="Email">{b.email ?? '—'}</Detail>
                <Detail label="Website">{b.website ?? '—'}</Detail>
                <Detail label="Order link">
                  <span className="break-all">{b.orderUrl ?? '—'}</span> <Tag tone={['own_domain', 'ordering_provider'].includes(data.orderLinkCheck) ? 'good' : data.orderLinkCheck === 'none' ? 'neutral' : 'bad'}>{humanise(data.orderLinkCheck)}</Tag>
                </Detail>
                <Detail label="Categories">{b.categories.map((c) => c.name).join(', ') || '—'}</Detail>
                <Detail label="Verified">
                  {b.verifiedAt ? `${date(b.verifiedAt)} · re-check due ${date(b.reverificationDueAt)}` : 'No'}
                </Detail>
                <Detail label="Source">{humanise(b.source)}</Detail>
                <Detail label="Trust score">{b.trustScore}</Detail>
                <Detail label="FHRS rating">{b.fhrsRating ?? '—'}</Detail>
                <Detail label="Live offers">{b.activeOfferCount}</Detail>
                <Detail label="Followers">{b.followerCount}</Detail>
                <Detail label="Strikes (90 days)">{data.strikesInWindow}</Detail>
                <Detail label="Added">{dateTime(b.createdAt)}</Detail>
              </dl>

              <div className="flex gap-2 flex-wrap">
                {can(user, 'business.manage') && (
                  <>
                    <button className={btn.small} onClick={() => open('level')}>
                      Set level
                    </button>
                    <button className={btn.small} onClick={() => post('/flags', { isFoodbellClient: !b.isFoodbellClient }, b.isFoodbellClient ? 'Foodbell tag removed' : 'Tagged as Foodbell partner')}>
                      {b.isFoodbellClient ? 'Remove Foodbell tag' : 'Tag as Foodbell partner'}
                    </button>
                    <button className={btn.small} onClick={() => post('/flags', { featured: !b.featured }, b.featured ? 'No longer featured' : 'Featured')}>
                      {b.featured ? 'Unfeature' : 'Feature'}
                    </button>
                    <button className={btn.small} onClick={() => open('merge')}>
                      Merge into…
                    </button>
                  </>
                )}
                {can(user, 'business.impersonate') && b.members.some((m) => m.role === 'owner') && (
                  <button className={btn.small} disabled={!!action.busy} onClick={viewAs}>
                    View as business
                  </button>
                )}
                {can(user, 'business.suspend') && b.status !== 'suspended' && (
                  <button className={btn.smallDanger} onClick={() => open('suspend')}>
                    Suspend
                  </button>
                )}
                {can(user, 'business.suspend') && b.status === 'suspended' && (
                  <button className={btn.small} onClick={() => post('/unsuspend', {}, 'Unsuspended')}>
                    Unsuspend
                  </button>
                )}
                {can(user, 'business.suspend') && reviewOpen && (
                  <button className={btn.small} onClick={() => open('resolve')}>
                    Close review without suspending
                  </button>
                )}
                {!can(user, 'business.suspend') && can(user, 'business.suspension_suggest') && !reviewOpen && (
                  <button className={btn.smallDanger} onClick={() => open('flag')}>
                    Suggest suspension
                  </button>
                )}
                {can(user, 'business.manage') && b.status !== 'archived' && (
                  <button className={btn.smallDanger} onClick={() => open('archive')}>
                    Archive
                  </button>
                )}
              </div>

              <div>
                <SectionTitle>Claims</SectionTitle>
                {data.claims.length === 0 ? (
                  <p className="text-sm text-muted">No claims.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {data.claims.map((c) => (
                      <li key={c._id} className="flex items-center gap-2">
                        <Link href={`/admin/claims/${c._id}`} className="flex-1 font-bold hover:text-primary truncate">
                          {c.userId?.name ?? 'Unknown'} · {humanise(c.kind)} · {date(c.submittedAt)}
                        </Link>
                        <StatusPill status={c.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {data.reportCases.length > 0 && (
                <div>
                  <SectionTitle>Reports</SectionTitle>
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {data.reportCases.map((r) => (
                      <li key={r._id} className="flex items-center gap-2">
                        <span className="flex-1 font-bold truncate">
                          {r.offerId?.title ?? 'Offer'} · {r.reportCount} report{r.reportCount === 1 ? '' : 's'}
                        </span>
                        <StatusPill status={r.status} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {tab === 'edit' &&
            (can(user, 'business.edit') ? (
              <ProfileForm
                key={b._id}
                initial={{
                  name: b.name,
                  description: b.description,
                  address: b.address,
                  postcode: b.postcode,
                  town: b.town,
                  phone: b.phone,
                  email: b.email,
                  website: b.website,
                  orderUrl: b.orderUrl,
                  delivery: b.delivery,
                  collection: b.collection,
                  categories: b.categories.map((c) => c._id),
                }}
                busy={!!action.busy}
                submitLabel="Save changes"
                onSubmit={(fields) =>
                  action
                    .run(
                      'save',
                      () =>
                        api(`/admin/businesses/${id}`, {
                          method: 'PATCH',
                          body: JSON.stringify(Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== null))),
                        }),
                      'Saved',
                    )
                    .then(refresh)
                }
              />
            ) : (
              <Alert tone="info">Your role can’t edit businesses.</Alert>
            ))}

          {tab === 'team' && (
            <>
              <ul className="flex flex-col gap-2">
                {b.members.length === 0 && <p className="text-sm text-muted">Nobody manages this listing.</p>}
                {b.members.map((m) => (
                  <li key={m.userId} className="bg-surface rounded-2xl px-4 py-3 flex items-center gap-3 text-sm">
                    <div className="flex-1 min-w-0">
                      <Link href={`/admin/users?open=${m.userId}`} className="font-extrabold hover:text-primary">
                        {m.user?.name ?? 'Unknown'}
                      </Link>
                      <div className="text-[12.5px] text-muted truncate">
                        {m.user?.email} · last login {m.user?.lastLoginAt ? dateTime(m.user.lastLoginAt) : 'never'}
                      </div>
                    </div>
                    <Tag tone={m.role === 'owner' ? 'info' : 'neutral'}>{humanise(m.role)}</Tag>
                  </li>
                ))}
              </ul>
              {can(user, 'business.manage') && (
                <div>
                  <button className={btn.secondary} onClick={() => open('owner')}>
                    Change owner
                  </button>
                </div>
              )}
            </>
          )}

          {tab === 'offers' &&
            (data.offers.length === 0 ? (
              <p className="text-sm text-muted">No offers.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.offers.map((o) => (
                  <li key={o._id} className="flex items-center gap-3 text-sm bg-surface rounded-2xl px-4 py-3">
                    <Link href={`/admin/offers?status=all&open=${o._id}`} className="flex-1 min-w-0">
                      <div className="font-extrabold truncate">{o.title}</div>
                      <div className="text-[12.5px] text-muted">
                        {o.displayLabel} · {o.impressions} views · {o.orderClicks} order clicks{o.origin === 'scraper' ? ' · imported' : ''}
                      </div>
                    </Link>
                    <StatusPill status={o.status} />
                  </li>
                ))}
              </ul>
            ))}

          {tab === 'billing' && (
            <>
              <dl>
                <Detail label="Plan">
                  {data.subscription ? `${humanise(data.subscription.planKey)}${data.subscription.comp ? ' (complimentary)' : ''}` : 'Free'}
                </Detail>
                {data.subscription && (
                  <>
                    <Detail label="Status">
                      <StatusPill status={data.subscription.status} />
                    </Detail>
                    <Detail label="Price">
                      {money(data.subscription.price)} / {data.subscription.interval === 'annual' ? 'year' : 'month'}
                    </Detail>
                    <Detail label={data.subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews'}>{date(data.subscription.currentPeriodEnd)}</Detail>
                  </>
                )}
              </dl>
              {can(user, 'billing.manage') && (
                <div>
                  <button className={btn.secondary} onClick={() => open('plan')}>
                    Set plan
                  </button>
                </div>
              )}
              <SectionTitle>Payments</SectionTitle>
              {data.payments.length === 0 ? (
                <p className="text-sm text-muted">No payments.</p>
              ) : (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {data.payments.map((p) => (
                    <li key={p._id} className="flex items-center gap-3">
                      <span className="flex-1 truncate font-bold">
                        {p.number ?? '—'} · {p.description}
                      </span>
                      <span className="font-extrabold">{money(p.total)}</span>
                      <StatusPill status={p.status} />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {tab === 'history' && <AuditTrail entries={data.trail} />}
        </div>
      )}

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={
          {
            level: 'Set verification level',
            suspend: `Suspend ${b?.name}`,
            flag: 'Suggest a suspension',
            resolve: 'Close the suspension review',
            owner: 'Change owner',
            merge: 'Merge duplicate listing',
            plan: 'Set plan',
            archive: `Archive ${b?.name}?`,
          }[modal ?? 'level']
        }
        footer={
          <>
            <button className={btn.secondary} onClick={() => setModal(null)}>
              Cancel
            </button>
            <button className={['suspend', 'archive', 'merge'].includes(modal ?? '') ? btn.danger : btn.primary} disabled={confirmDisabled} onClick={() => void confirm()}>
              Confirm
            </button>
          </>
        }
      >
        {modalBody()}
      </Modal>
    </Drawer>
  );
}

export function CreateBusinessModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const action = useAction();
  if (!open) return null;
  return (
    <Modal open onClose={onClose} title="Add a business" wide>
      <p className="text-sm text-muted mb-4">The listing goes live at level 0 (unclaimed). Owners can then claim it.</p>
      <Feedback error={action.error} className="mb-4" />
      <ProfileForm
        initial={{ delivery: true, collection: true, categories: [] }}
        busy={!!action.busy}
        submitLabel="Create listing"
        onSubmit={async (fields) => {
          const created = await action.run('create', () =>
            api<{ _id: string }>('/admin/businesses', { method: 'POST', body: JSON.stringify(Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== ''))) }),
          );
          if (created) onCreated(created._id);
        }}
      />
    </Modal>
  );
}
