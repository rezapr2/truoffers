'use client';

import { useEffect, useState } from 'react';
import { Alert, btn, Card, Drawer, EmptyState, Feedback, Field, inputClass, SectionTitle, Spinner, StatusPill, Tabs, Tag, Toggle } from '@/components/ui';
import { PlusIcon } from '@/components/icons';
import { api } from '@/lib/api';
import { dateTime, humanise } from '@/lib/format';
import { useAction, useApi, useDebounced } from '@/lib/hooks';
import { AdminPage, qs, RequireCapability, Table, Td, Th } from '../_components/admin-ui';

interface Stats {
  sent: number;
  failed: number;
  skipped: number;
}

interface Campaign {
  _id: string;
  name: string;
  kind: 'marketing' | 'service';
  channels: { email: boolean; sms: boolean; inApp: boolean };
  audience: { roles: string[]; verificationLevels: number[]; plans: string[]; towns: string[]; postcodeAreas: string[]; followersOf?: { _id: string; name: string } | string | null };
  subject: string;
  body: string;
  smsBody: string;
  link?: string;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled';
  scheduledAt?: string;
  startedAt?: string;
  finishedAt?: string;
  recipients: number;
  email: Stats;
  sms: Stats;
  inApp: Stats;
  createdBy?: { name: string };
  createdAt: string;
}

interface Preview {
  total: number;
  email: number;
  sms: number;
  inApp: number;
  smsConfigured: boolean;
}

const ROLES = [
  { value: 'customer', label: 'Customers' },
  { value: 'business_owner', label: 'Business owners' },
  { value: 'business_staff', label: 'Business staff' },
  { value: 'supplier', label: 'Suppliers' },
];
const LEVELS = [
  { value: 0, label: 'Unclaimed' },
  { value: 1, label: 'Claim pending' },
  { value: 2, label: 'Verified' },
  { value: 3, label: 'Verified+' },
];
const PLANS = ['free', 'standard', 'professional', 'starter', 'premium'];
const TABS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'scheduled,sending', label: 'Scheduled' },
  { value: 'sent', label: 'Sent' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;
const STATUS_PILL: Record<Campaign['status'], string> = { draft: 'draft', scheduled: 'scheduled', sending: 'active', sent: 'approved', cancelled: 'cancelled' };
const STOP_SUFFIX = ' Reply STOP to opt out.';

interface Form {
  name: string;
  kind: 'marketing' | 'service';
  channels: { email: boolean; sms: boolean; inApp: boolean };
  roles: string[];
  verificationLevels: number[];
  plans: string[];
  towns: string;
  postcodeAreas: string;
  followersOf: { _id: string; name: string } | null;
  subject: string;
  body: string;
  smsBody: string;
  link: string;
}

const list = (text: string) => text.split(',').map((t) => t.trim()).filter(Boolean);

function toForm(c: Campaign | null): Form {
  return {
    name: c?.name ?? '',
    kind: c?.kind ?? 'marketing',
    channels: c?.channels ?? { email: true, sms: false, inApp: false },
    roles: c?.audience.roles ?? ['customer'],
    verificationLevels: c?.audience.verificationLevels ?? [],
    plans: c?.audience.plans ?? [],
    towns: (c?.audience.towns ?? []).join(', '),
    postcodeAreas: (c?.audience.postcodeAreas ?? []).join(', '),
    followersOf: c?.audience.followersOf && typeof c.audience.followersOf === 'object' ? c.audience.followersOf : null,
    subject: c?.subject ?? '',
    body: c?.body ?? '',
    smsBody: c?.smsBody ?? '',
    link: c?.link ?? '',
  };
}

function toBody(f: Form) {
  return {
    name: f.name,
    kind: f.kind,
    channels: f.channels,
    audience: { roles: f.roles, verificationLevels: f.verificationLevels, plans: f.plans, towns: list(f.towns), postcodeAreas: list(f.postcodeAreas).map((a) => a.toUpperCase()), followersOf: f.followersOf?._id ?? null },
    subject: f.subject,
    body: f.body,
    smsBody: f.smsBody,
    link: f.link || undefined,
  };
}

function toggle<T>(items: T[], item: T): T[] {
  return items.includes(item) ? items.filter((x) => x !== item) : [...items, item];
}

function FollowersPicker({ value, onChange }: { value: Form['followersOf']; onChange: (v: Form['followersOf']) => void }) {
  const [query, setQuery] = useState('');
  const q = useDebounced(query);
  const { data } = useApi<{ items: { _id: string; name: string; town?: string }[] }>(!value && q.length >= 2 ? `/admin/businesses?q=${encodeURIComponent(q)}` : null);
  if (value) {
    return (
      <div className="flex items-center gap-3 bg-card rounded-xl px-4 py-2.5 text-sm">
        <span className="flex-1 font-bold">Followers of {value.name}</span>
        <button type="button" className={btn.link} onClick={() => onChange(null)}>
          Remove
        </button>
      </div>
    );
  }
  return (
    <div>
      <input className={inputClass} placeholder="Only followers of a takeaway (search)" value={query} onChange={(e) => setQuery(e.target.value)} />
      {data && q.length >= 2 && (
        <div className="flex flex-col gap-1 mt-1">
          {data.items.slice(0, 5).map((b) => (
            <button key={b._id} type="button" className="text-left text-sm font-bold rounded-xl px-3 py-2 hover:bg-tint-blue cursor-pointer" onClick={() => onChange({ _id: b._id, name: b.name })}>
              {b.name} <span className="text-muted">· {b.town}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatsRow({ label, stats, on }: { label: string; stats: Stats; on: boolean }) {
  if (!on) return null;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-20 font-bold">{label}</span>
      <Tag tone="good">{stats.sent} sent</Tag>
      {stats.failed > 0 && <Tag tone="bad">{stats.failed} failed</Tag>}
      {stats.skipped > 0 && <Tag>{stats.skipped} skipped</Tag>}
    </div>
  );
}

function Editor({ campaign, onClose, onChanged }: { campaign: Campaign | null; onClose: () => void; onChanged: (c?: Campaign) => void }) {
  const [form, setForm] = useState<Form>(toForm(campaign));
  const [saved, setSaved] = useState<Campaign | null>(campaign);
  const [when, setWhen] = useState('');
  const action = useAction();
  const editable = !saved || ['draft', 'scheduled'].includes(saved.status);
  const debounced = useDebounced(JSON.stringify(toBody(form)), 400);
  const [preview, setPreview] = useState<Preview | null>(null);
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const business = form.roles.some((r) => r === 'business_owner' || r === 'business_staff');
  const smsLength = form.smsBody.length + (form.kind === 'marketing' ? STOP_SUFFIX.length : 0);

  useEffect(() => {
    if (!editable) return;
    let live = true;
    void api<Preview>('/admin/campaigns/preview', { method: 'POST', body: debounced })
      .then((p) => live && setPreview(p))
      .catch(() => live && setPreview(null));
    return () => {
      live = false;
    };
  }, [debounced, editable]);

  // Follow a campaign while it goes out, so the drawer switches to its results by itself
  const [sentNow, setSentNow] = useState(false);
  const inFlight = !!saved && (saved.status === 'sending' || (saved.status === 'scheduled' && sentNow));
  useEffect(() => {
    if (!inFlight || !saved) return;
    const timer = setInterval(() => {
      void api<Campaign>(`/admin/campaigns/${saved._id}`)
        .then((fresh) => {
          setSaved(fresh);
          if (!['scheduled', 'sending'].includes(fresh.status)) onChanged(fresh);
        })
        .catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [inFlight, saved, onChanged]);

  const persist = async () => {
    const body = JSON.stringify(toBody(form));
    const r = await action.run('save', () => (saved ? api<Campaign>(`/admin/campaigns/${saved._id}`, { method: 'PATCH', body }) : api<Campaign>('/admin/campaigns', { method: 'POST', body })));
    if (r) {
      setSaved(r);
      onChanged();
    }
    return r;
  };

  const test = async () => {
    const c = await persist();
    if (!c) return;
    await action.run('test', () => api(`/admin/campaigns/${c._id}/test`, { method: 'POST' }), 'A test copy was sent to you on each chosen channel');
  };

  const schedule = async (now: boolean) => {
    if (now && !window.confirm(`Send “${form.name}” now to about ${preview?.total ?? 0} people?`)) return;
    const c = await persist();
    if (!c) return;
    const r = await action.run('schedule', () => api<Campaign>(`/admin/campaigns/${c._id}/schedule`, { method: 'POST', body: JSON.stringify(now ? {} : { at: new Date(when).toISOString() }) }), now ? 'Sending now' : 'Scheduled');
    if (r) {
      setSaved(r);
      setSentNow(now);
      onChanged(r);
    }
  };

  const cancel = async () => {
    if (!saved) return;
    const r = await action.run('cancel', () => api<Campaign>(`/admin/campaigns/${saved._id}/cancel`, { method: 'POST' }), saved.status === 'scheduled' ? 'Back to draft' : 'Stopped');
    if (r) {
      setSaved(r);
      onChanged(r);
    }
  };

  const remove = async () => {
    if (!saved || !window.confirm('Delete this draft?')) return;
    const r = await action.run('delete', () => api(`/admin/campaigns/${saved._id}`, { method: 'DELETE' }));
    if (r !== undefined) {
      onChanged();
      onClose();
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={saved ? saved.name : 'New campaign'}
      subtitle={saved && <StatusPill status={STATUS_PILL[saved.status]} label={humanise(saved.status)} />}
      footer={
        editable ? (
          <>
            <button className={btn.secondary} disabled={!form.name || !!action.busy} onClick={persist}>
              Save draft
            </button>
            <button className={btn.secondary} disabled={!form.name || !!action.busy} onClick={test}>
              Send me a test
            </button>
            {saved?.status === 'scheduled' && (
              <button className={btn.secondary} disabled={!!action.busy} onClick={cancel}>
                Unschedule
              </button>
            )}
            {saved?.status === 'draft' && (
              <button className={btn.danger} disabled={!!action.busy} onClick={remove}>
                Delete
              </button>
            )}
          </>
        ) : saved?.status === 'sending' ? (
          <button className={btn.danger} disabled={!!action.busy} onClick={cancel}>
            Stop sending
          </button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-6">
        <Feedback error={action.error} notice={action.notice} />

        {saved && !editable && (
          <Card>
            <SectionTitle>Results</SectionTitle>
            <div className="flex flex-col gap-2">
              <div className="text-sm text-muted">
                {saved.recipients} people in the audience · started {dateTime(saved.startedAt)}
                {saved.finishedAt ? ` · finished ${dateTime(saved.finishedAt)}` : ''}
              </div>
              <StatsRow label="Email" stats={saved.email} on={saved.channels.email} />
              <StatsRow label="Text" stats={saved.sms} on={saved.channels.sms} />
              <StatsRow label="In-app" stats={saved.inApp} on={saved.channels.inApp} />
              <p className="text-[12.5px] text-muted">Skipped: no consent for a marketing campaign, or no valid mobile number.</p>
            </div>
          </Card>
        )}

        <fieldset disabled={!editable} className="flex flex-col gap-6">
          <Field label="Name (internal)" required>
            <input className={inputClass} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Curry week, October" />
          </Field>

          <div className="grid sm:grid-cols-2 gap-3">
            {(
              [
                ['marketing', 'Marketing', 'Offers and news. Only people who opted in, with an unsubscribe link.'],
                ['service', 'Service', 'Essential account news (e.g. new terms). Everyone in the audience.'],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className={`rounded-2xl px-4 py-3 cursor-pointer border ${form.kind === value ? 'border-primary bg-tint-blue' : 'border-line'}`}>
                <input type="radio" name="kind" className="sr-only" checked={form.kind === value} onChange={() => set({ kind: value })} />
                <div className="font-extrabold text-sm">{label}</div>
                <div className="text-[12.5px] text-muted">{hint}</div>
              </label>
            ))}
          </div>

          <div className="bg-surface rounded-3xl p-5 flex flex-col gap-4">
            <div className="font-extrabold">Who gets it</div>
            <div className="flex gap-2 flex-wrap">
              {ROLES.map((r) => (
                <button type="button" key={r.value} className={form.roles.includes(r.value) ? btn.smallPrimary : btn.small} onClick={() => set({ roles: toggle(form.roles, r.value) })}>
                  {r.label}
                </button>
              ))}
            </div>
            {form.roles.includes('customer') && (
              <Field label="Customers in these postcode areas" hint="Comma separated, e.g. M14, LS6. Empty = everywhere.">
                <input className={inputClass} value={form.postcodeAreas} onChange={(e) => set({ postcodeAreas: e.target.value })} />
              </Field>
            )}
            {business && (
              <>
                <div>
                  <div className="text-sm font-extrabold mb-2">Businesses at these levels (empty = any)</div>
                  <div className="flex gap-2 flex-wrap">
                    {LEVELS.map((l) => (
                      <button type="button" key={l.value} className={form.verificationLevels.includes(l.value) ? btn.smallPrimary : btn.small} onClick={() => set({ verificationLevels: toggle(form.verificationLevels, l.value) })}>
                        {l.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-extrabold mb-2">On these plans (empty = any)</div>
                  <div className="flex gap-2 flex-wrap">
                    {PLANS.map((p) => (
                      <button type="button" key={p} className={form.plans.includes(p) ? btn.smallPrimary : btn.small} onClick={() => set({ plans: toggle(form.plans, p) })}>
                        {humanise(p)}
                      </button>
                    ))}
                  </div>
                </div>
                <Field label="In these towns" hint="Comma separated. Empty = everywhere.">
                  <input className={inputClass} value={form.towns} onChange={(e) => set({ towns: e.target.value })} />
                </Field>
              </>
            )}
            <FollowersPicker value={form.followersOf} onChange={(v) => set({ followersOf: v })} />
            {preview && (
              <div className="bg-card rounded-2xl px-4 py-3 text-sm">
                <span className="font-extrabold">{preview.total.toLocaleString('en-GB')} people</span>
                <span className="text-muted">
                  {' '}
                  · {preview.email.toLocaleString('en-GB')} by email · {preview.sms.toLocaleString('en-GB')} by text · {preview.inApp.toLocaleString('en-GB')} in the app
                  {form.kind === 'marketing' ? ' (opted in only)' : ''}
                </span>
              </div>
            )}
          </div>

          <div className="bg-surface rounded-3xl p-5 flex flex-col gap-4">
            <div className="font-extrabold">Channels</div>
            <Toggle checked={form.channels.email} onChange={(v) => set({ channels: { ...form.channels, email: v } })} label="Email" />
            <Toggle
              checked={form.channels.sms}
              onChange={(v) => set({ channels: { ...form.channels, sms: v } })}
              label="Text message"
              hint={preview && !preview.smsConfigured ? 'Texts are only logged until a Twilio Messaging Service is added in Settings.' : 'To UK mobile numbers.'}
            />
            <Toggle checked={form.channels.inApp} onChange={(v) => set({ channels: { ...form.channels, inApp: v } })} label="In-app notification" hint="Shows under the bell for signed-in people." />
          </div>

          {(form.channels.email || form.channels.inApp) && (
            <>
              <Field label="Subject" hint="Also the title of the in-app notification. {{name}} is the person’s first name.">
                <input className={inputClass} value={form.subject} onChange={(e) => set({ subject: e.target.value })} />
              </Field>
              <Field label="Message" hint="Plain text. A blank line starts a new paragraph. {{name}} and {{siteName}} are filled in.">
                <textarea className={inputClass} rows={8} value={form.body} onChange={(e) => set({ body: e.target.value })} />
              </Field>
              <Field label="Link" hint="Optional, e.g. /offers or a full https address. Becomes a button.">
                <input className={inputClass} value={form.link} onChange={(e) => set({ link: e.target.value })} />
              </Field>
            </>
          )}
          {form.channels.sms && (
            <Field label="Text message" hint={`${smsLength} characters · ${smsLength <= 160 ? 1 : Math.ceil(smsLength / 153)} part(s)${form.kind === 'marketing' ? ' (includes “Reply STOP to opt out.”)' : ''}`}>
              <textarea className={inputClass} rows={3} maxLength={459} value={form.smsBody} onChange={(e) => set({ smsBody: e.target.value })} />
            </Field>
          )}
        </fieldset>

        {editable && (
          <Card>
            <SectionTitle>Send</SectionTitle>
            {form.kind === 'marketing' && preview && preview.email === 0 && form.channels.email && (
              <Alert tone="warning" className="mb-4">
                Nobody in this audience has opted in to marketing emails.
              </Alert>
            )}
            <div className="flex gap-3 flex-wrap items-end">
              <button className={btn.good} disabled={!form.name || !!action.busy} onClick={() => schedule(true)}>
                Send now
              </button>
              <span className="text-sm text-muted font-bold">or</span>
              <Field label="Schedule for" className="min-w-[220px]">
                <input type="datetime-local" className={inputClass} value={when} onChange={(e) => setWhen(e.target.value)} />
              </Field>
              <button className={btn.secondary} disabled={!form.name || !when || !!action.busy} onClick={() => schedule(false)}>
                Schedule
              </button>
            </div>
            {saved?.status === 'scheduled' && <p className="text-sm text-muted mt-3">{inFlight ? 'Sending now…' : `Scheduled for ${dateTime(saved.scheduledAt)}.`}</p>}
          </Card>
        )}
      </div>
    </Drawer>
  );
}

function Campaigns() {
  const [status, setStatus] = useState<(typeof TABS)[number]['value']>('');
  const { data, error, reload } = useApi<Campaign[]>(`/admin/campaigns${qs({ status })}`);
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null);

  // Refresh while something is sending
  const sending = data?.some((c) => c.status === 'sending');
  useEffect(() => {
    if (!sending) return;
    const timer = setInterval(() => void reload(), 3000);
    return () => clearInterval(timer);
  }, [sending, reload]);

  return (
    <AdminPage
      title="Campaigns"
      subtitle="Email, text and in-app messages to customers and businesses."
      actions={
        <button className={btn.primary} onClick={() => setEditing('new')}>
          <PlusIcon className="w-4 h-4" /> New campaign
        </button>
      }
    >
      <div className="mb-5">
        <Tabs tabs={TABS} active={status} onChange={setStatus} />
      </div>
      <Feedback error={error} className="mb-4" />
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <EmptyState title="No campaigns yet">Marketing messages only reach people who opted in, and each one carries an unsubscribe link.</EmptyState>
      ) : (
        <Table minWidth={860}>
          <thead className="bg-surface">
            <tr>
              <Th>Campaign</Th>
              <Th>Channels</Th>
              <Th>Audience</Th>
              <Th>When</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c._id} className="border-t border-line hover:bg-surface/60 cursor-pointer" onClick={() => setEditing(c)}>
                <Td>
                  <div className="font-extrabold">{c.name}</div>
                  <div className="text-[12.5px] text-muted">
                    {c.kind === 'marketing' ? 'Marketing' : 'Service'} · {c.subject || c.smsBody}
                  </div>
                </Td>
                <Td>
                  <div className="flex gap-1 flex-wrap">
                    {c.channels.email && <Tag>Email</Tag>}
                    {c.channels.sms && <Tag>Text</Tag>}
                    {c.channels.inApp && <Tag>In-app</Tag>}
                  </div>
                </Td>
                <Td className="text-[13px]">
                  {(c.audience.roles.length ? c.audience.roles : ROLES.map((r) => r.value)).map((r) => ROLES.find((x) => x.value === r)?.label).join(', ')}
                  {c.recipients ? <div className="text-muted">{c.recipients} people</div> : null}
                </Td>
                <Td className="text-[13px] whitespace-nowrap">{c.finishedAt ? dateTime(c.finishedAt) : c.scheduledAt ? dateTime(c.scheduledAt) : '—'}</Td>
                <Td>
                  <StatusPill status={STATUS_PILL[c.status]} label={humanise(c.status)} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && (
        <Editor
          key={editing === 'new' ? 'new' : editing._id}
          campaign={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onChanged={() => void reload()}
        />
      )}
    </AdminPage>
  );
}

export default function AdminCampaignsPage() {
  return (
    <RequireCapability capability="campaigns.manage">
      <Campaigns />
    </RequireCapability>
  );
}
