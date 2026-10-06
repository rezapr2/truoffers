'use client';

import { useState } from 'react';
import { Alert, btn, Card, Drawer, EmptyState, Feedback, Field, inputClass, Spinner, Tag, Toggle } from '@/components/ui';
import { PlusIcon } from '@/components/icons';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { money } from '@/lib/format';
import type { Plan, PlanFlags, PlanLimits } from '@/lib/types';
import { AdminPage, RequireCapability } from '../_components/admin-ui';

type PlanForm = Partial<Omit<Plan, 'features'>> & { features?: string[]; migrateExisting?: boolean };

const NEW_PLAN: PlanForm = {
  key: '',
  name: '',
  audience: 'takeaway',
  monthlyPrice: 0,
  annualPrice: 0,
  trialDays: 0,
  limits: { maxLiveOffers: 1, maxPhotos: 3, maxBranches: 1 },
  flags: { scheduledOffers: false, couponCodes: false, analytics: 'views', aiOfferWriter: false, qrCodes: false, rankingBoost: 0, prioritySupport: false, freeTopOfSearchWeeksPerMonth: 0 },
  features: [],
  autoApprove: false,
  isPublic: true,
  sortOrder: 10,
};

const limit = (n: number) => (n === -1 ? 'Unlimited' : String(n));

/** Spec "Plans and pricing": edit prices, VAT, trial, limits, feature flags, badge; archive; changes are logged. */
function PlanEditor({ plan, onClose, onSaved }: { plan: Plan | null; onClose: () => void; onSaved: () => void }) {
  const creating = !plan;
  const [form, setForm] = useState<PlanForm>(plan ? { ...plan } : NEW_PLAN);
  const [featuresText, setFeaturesText] = useState((plan?.features ?? []).join('\n'));
  const action = useAction();
  const set = (patch: PlanForm) => setForm({ ...form, ...patch });
  const setLimit = (key: keyof PlanLimits, value: number) => set({ limits: { ...(form.limits as PlanLimits), [key]: value } });
  const setFlag = <K extends keyof PlanFlags>(key: K, value: PlanFlags[K]) => set({ flags: { ...(form.flags as PlanFlags), [key]: value } });
  const priceChanged = plan && (plan.monthlyPrice !== form.monthlyPrice || plan.annualPrice !== form.annualPrice);

  const save = async () => {
    const body = {
      ...(creating ? { key: form.key, audience: form.audience } : {}),
      name: form.name,
      monthlyPrice: Number(form.monthlyPrice),
      annualPrice: Number(form.annualPrice),
      vatRatePercent: form.vatRatePercent === undefined || (form.vatRatePercent as unknown) === '' ? null : Number(form.vatRatePercent),
      trialDays: Number(form.trialDays ?? 0),
      bestFor: form.bestFor,
      limits: form.limits,
      flags: form.flags,
      features: featuresText.split('\n').map((f) => f.trim()).filter(Boolean),
      autoApprove: form.autoApprove,
      isPublic: form.isPublic,
      sortOrder: Number(form.sortOrder ?? 0),
      badgeText: form.badgeText ?? '',
      migrateExisting: !creating && priceChanged ? !!form.migrateExisting : undefined,
    };
    const result = await action.run('save', () =>
      creating ? api('/admin/plans', { method: 'POST', body: JSON.stringify(body) }) : api(`/admin/plans/${plan!.key}`, { method: 'PATCH', body: JSON.stringify(body) }),
    );
    if (result !== undefined) onSaved();
  };

  const num = (value: string) => (value === '' ? 0 : Number(value));
  const flags = form.flags as PlanFlags;
  const limits = form.limits as PlanLimits;

  return (
    <Drawer
      open
      onClose={onClose}
      title={creating ? 'New plan' : `Edit ${plan.name}`}
      subtitle={plan ? `${plan.subscribers ?? 0} current subscriber(s)` : undefined}
      footer={
        <>
          <button className={btn.primary} disabled={!!action.busy || !form.name || (creating && !form.key)} onClick={save}>
            {creating ? 'Create plan' : 'Save plan'}
          </button>
          <button className={btn.secondary} onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Feedback error={action.error} />
        {creating && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Key" hint="Lowercase, never changes, e.g. standard" required>
              <input className={inputClass} value={form.key ?? ''} onChange={(e) => set({ key: e.target.value.toLowerCase() })} />
            </Field>
            <Field label="For">
              <select className={inputClass} value={form.audience} onChange={(e) => set({ audience: e.target.value })}>
                <option value="takeaway">Takeaways</option>
                <option value="supplier">Suppliers</option>
              </select>
            </Field>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name" required>
            <input className={inputClass} value={form.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Badge" hint='e.g. "Most popular"'>
            <input className={inputClass} value={form.badgeText ?? ''} onChange={(e) => set({ badgeText: e.target.value })} />
          </Field>
        </div>
        <Field label="Best for">
          <input className={inputClass} value={form.bestFor ?? ''} onChange={(e) => set({ bestFor: e.target.value })} />
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Monthly (£)">
            <input type="number" min={0} step={0.01} className={inputClass} value={form.monthlyPrice ?? 0} disabled={plan?.key === 'free'} onChange={(e) => set({ monthlyPrice: num(e.target.value) })} />
          </Field>
          <Field label="Annual (£)">
            <input type="number" min={0} step={0.01} className={inputClass} value={form.annualPrice ?? 0} disabled={plan?.key === 'free'} onChange={(e) => set({ annualPrice: num(e.target.value) })} />
          </Field>
          <Field label="VAT %" hint="Empty = site rate">
            <input
              type="number"
              min={0}
              max={50}
              className={inputClass}
              value={form.vatRatePercent ?? ''}
              onChange={(e) => set({ vatRatePercent: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          </Field>
        </div>
        {priceChanged && (
          <Alert tone="warning">
            <Toggle
              checked={!!form.migrateExisting}
              onChange={(v) => set({ migrateExisting: v })}
              label="Move current subscribers to the new price"
              hint="Off: only new subscriptions pay the new price. On: current subscribers pay it from their next renewal."
            />
          </Alert>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Free trial (days)">
            <input type="number" min={0} className={inputClass} value={form.trialDays ?? 0} onChange={(e) => set({ trialDays: num(e.target.value) })} />
          </Field>
          <Field label="Sort order">
            <input type="number" className={inputClass} value={form.sortOrder ?? 0} onChange={(e) => set({ sortOrder: num(e.target.value) })} />
          </Field>
        </div>

        <div className="bg-surface rounded-3xl p-5 flex flex-col gap-4">
          <div className="font-extrabold">Limits</div>
          <p className="text-[12.5px] text-muted -mt-3">-1 means unlimited.</p>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Live offers">
              <input type="number" min={-1} className={inputClass} value={limits.maxLiveOffers} onChange={(e) => setLimit('maxLiveOffers', num(e.target.value))} />
            </Field>
            <Field label="Photos">
              <input type="number" min={-1} className={inputClass} value={limits.maxPhotos} onChange={(e) => setLimit('maxPhotos', num(e.target.value))} />
            </Field>
            <Field label="Branches">
              <input type="number" min={-1} className={inputClass} value={limits.maxBranches} onChange={(e) => setLimit('maxBranches', num(e.target.value))} />
            </Field>
          </div>
        </div>

        <div className="bg-surface rounded-3xl p-5 flex flex-col gap-4">
          <div className="font-extrabold">Features</div>
          <Toggle checked={!!form.autoApprove} onChange={(v) => set({ autoApprove: v })} label="Auto-approve offers" hint="For verified businesses only, and only when no moderation rule is hit." />
          <Toggle checked={flags.scheduledOffers} onChange={(v) => setFlag('scheduledOffers', v)} label="Scheduled offers" />
          <Toggle checked={flags.couponCodes} onChange={(v) => setFlag('couponCodes', v)} label="Coupon codes" />
          <Toggle checked={flags.aiOfferWriter} onChange={(v) => setFlag('aiOfferWriter', v)} label="AI offer writer" />
          <Toggle checked={flags.qrCodes} onChange={(v) => setFlag('qrCodes', v)} label="QR codes" />
          <Toggle checked={flags.prioritySupport} onChange={(v) => setFlag('prioritySupport', v)} label="Priority support" />
          <div className="grid grid-cols-3 gap-4">
            <Field label="Insights">
              <select className={inputClass} value={flags.analytics} onChange={(e) => setFlag('analytics', e.target.value as PlanFlags['analytics'])}>
                <option value="views">Views only</option>
                <option value="full">Full</option>
                <option value="full_report">Full + monthly report</option>
              </select>
            </Field>
            <Field label="Ranking boost">
              <select className={inputClass} value={flags.rankingBoost} onChange={(e) => setFlag('rankingBoost', Number(e.target.value))}>
                <option value={0}>None</option>
                <option value={1}>Small</option>
                <option value={2}>Large</option>
              </select>
            </Field>
            <Field label="Free top-of-search weeks / month">
              <input type="number" min={0} max={4} className={inputClass} value={flags.freeTopOfSearchWeeksPerMonth} onChange={(e) => setFlag('freeTopOfSearchWeeksPerMonth', num(e.target.value))} />
            </Field>
          </div>
        </div>

        <Field label="Feature list on the pricing page" hint="One per line">
          <textarea rows={6} className={inputClass} value={featuresText} onChange={(e) => setFeaturesText(e.target.value)} />
        </Field>
        <Toggle checked={form.isPublic !== false} onChange={(v) => set({ isPublic: v })} label="Show on the pricing page" hint="Hidden plans can still be given to a business by an admin." />
      </div>
    </Drawer>
  );
}

function Plans() {
  const { data, error, reload } = useApi<{ plans: Plan[]; stripeEnabled: boolean }>('/admin/plans');
  const action = useAction();
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);

  const archive = (plan: Plan, archived: boolean) =>
    action.run(plan.key, () => api(`/admin/plans/${plan.key}/archive`, { method: 'POST', body: JSON.stringify({ archived }) }), archived ? `${plan.name} archived` : `${plan.name} restored`).then(() => reload());

  const groups = ['takeaway', 'supplier'].map((audience) => ({ audience, plans: data?.plans.filter((p) => p.audience === audience) ?? [] }));

  return (
    <AdminPage
      title="Plans & pricing"
      subtitle="Prices exclude VAT unless set otherwise in Settings. Every change is logged."
      actions={
        <button className={btn.primary} onClick={() => setEditing('new')}>
          <PlusIcon className="w-4 h-4" /> New plan
        </button>
      }
    >
      <Feedback error={action.error ?? error} notice={action.notice} className="mb-4" />
      {data && !data.stripeEnabled && (
        <Alert tone="info" className="mb-5">
          Stripe isn’t connected, so checkouts run in test mode. Add the keys in Settings; plans sync to Stripe when saved.
        </Alert>
      )}
      {!data ? (
        <Spinner />
      ) : data.plans.length === 0 ? (
        <EmptyState title="No plans" />
      ) : (
        groups.map((group) =>
          group.plans.length ? (
            <section key={group.audience} className="mb-8">
              <h2 className="font-display text-lg font-extrabold mb-4">{group.audience === 'takeaway' ? 'Takeaway plans' : 'Supplier plans'}</h2>
              <div className="grid md:grid-cols-2 2xl:grid-cols-3 gap-4">
                {group.plans.map((p) => (
                  <Card key={p.key} className={p.archived ? 'opacity-60' : ''}>
                    <div className="flex items-start gap-3 mb-3">
                      <div className="flex-1">
                        <div className="font-display text-xl font-extrabold">{p.name}</div>
                        <div className="text-[12.5px] text-muted font-mono">{p.key}</div>
                      </div>
                      <div className="flex gap-1 flex-wrap justify-end">
                        {p.badgeText && <Tag tone="info">{p.badgeText}</Tag>}
                        {p.archived ? <Tag tone="bad">Archived</Tag> : !p.isPublic ? <Tag>Hidden</Tag> : <Tag tone="good">Public</Tag>}
                      </div>
                    </div>
                    <div className="text-2xl font-extrabold mb-1">
                      {money(p.monthlyPrice)}
                      <span className="text-sm text-muted font-bold"> / month</span>
                    </div>
                    <div className="text-sm text-muted mb-4">
                      {money(p.annualPrice)} / year{p.trialDays ? ` · ${p.trialDays}-day trial` : ''}
                    </div>
                    <div className="text-sm flex flex-col gap-1 mb-4">
                      <div>
                        {limit(p.limits.maxLiveOffers)} live offers · {limit(p.limits.maxPhotos)} photos · {limit(p.limits.maxBranches)} branches
                      </div>
                      <div className="text-muted">
                        {[p.autoApprove && 'auto-approve', p.flags.scheduledOffers && 'scheduling', p.flags.couponCodes && 'codes', p.flags.aiOfferWriter && 'AI writer', p.flags.qrCodes && 'QR'].filter(Boolean).join(' · ') || 'Basic features'}
                      </div>
                      <div className="font-bold">{p.subscribers ?? 0} subscriber(s)</div>
                    </div>
                    <div className="flex gap-2">
                      <button className={btn.small} onClick={() => setEditing(p)}>
                        Edit
                      </button>
                      {p.key !== 'free' && (
                        <button className={p.archived ? btn.small : btn.smallDanger} disabled={!!action.busy} onClick={() => archive(p, !p.archived)}>
                          {p.archived ? 'Restore' : 'Archive'}
                        </button>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ) : null,
        )
      )}
      {editing && (
        <PlanEditor
          plan={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            action.setNotice('Plan saved');
            void reload();
          }}
        />
      )}
    </AdminPage>
  );
}

export default function AdminPlansPage() {
  return (
    <RequireCapability capability="plans.manage">
      <Plans />
    </RequireCapability>
  );
}
