'use client';

import { useState } from 'react';
import { Alert, btn, Card, Feedback, Field, inputClass, SectionTitle, Spinner, Tag, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { AdminPage, RequireCapability } from '../_components/admin-ui';

type SecretName = 'stripeSecretKey' | 'stripeWebhookSecret' | 'twilioAccountSid' | 'twilioAuthToken' | 'twilioVerifyServiceSid' | 'resendApiKey' | 'recaptchaSecretKey';

interface Settings {
  siteName: string;
  contactEmail: string;
  contactPhone?: string;
  contactAddress?: string;
  vatRatePercent: number;
  pricesIncludeVat: boolean;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  reports: { autoHideThreshold: number; windowDays: number; strikeThreshold: number; strikeWindowDays: number };
  moderation: { bannedWords: string[]; maxDiscountPercent: number; checkLinkDomain: boolean };
  knownOrderingDomains: string[];
  emailFrom: string;
  recaptchaSiteKey?: string;
  secrets: Record<SecretName, { configured: boolean; source: 'settings' | 'environment' | null; hint?: string }>;
}

// Spec T1.5: API keys live in admin Settings, never in code.
const SECRET_GROUPS: { title: string; hint: string; secrets: { name: SecretName; label: string }[] }[] = [
  {
    title: 'Stripe',
    hint: 'Subscriptions, promotions and invoices. The webhook secret lets Stripe confirm payments.',
    secrets: [
      { name: 'stripeSecretKey', label: 'Secret key' },
      { name: 'stripeWebhookSecret', label: 'Webhook signing secret' },
    ],
  },
  {
    title: 'Twilio Verify',
    hint: 'Sends the SMS and voice codes for the phone check. Without it, codes are only shown in test mode.',
    secrets: [
      { name: 'twilioAccountSid', label: 'Account SID' },
      { name: 'twilioAuthToken', label: 'Auth token' },
      { name: 'twilioVerifyServiceSid', label: 'Verify service SID' },
    ],
  },
  {
    title: 'Email (Resend)',
    hint: 'Transactional email: verification, password resets, claim and offer decisions.',
    secrets: [{ name: 'resendApiKey', label: 'API key' }],
  },
  {
    title: 'reCAPTCHA',
    hint: 'Checks guest offer reports.',
    secrets: [{ name: 'recaptchaSecretKey', label: 'Secret key' }],
  },
];

type Draft = Partial<Omit<Settings, 'secrets'>>;

function SettingsForm() {
  const { data, error, setData } = useApi<Settings>('/admin/settings');
  const action = useAction();
  const [draft, setDraft] = useState<Draft>({});
  const [secrets, setSecrets] = useState<Partial<Record<SecretName, string>>>({});
  const [domains, setDomains] = useState<string | null>(null);
  // Keys to remove; an empty input otherwise means "keep the current key".
  const [cleared, setCleared] = useState<SecretName[]>([]);

  if (error) {
    return (
      <AdminPage title="Settings">
        <Alert tone="danger">{error}</Alert>
      </AdminPage>
    );
  }
  if (!data) return <Spinner />;
  const s = { ...data, ...draft } as Settings;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value });
  const secretPatch = Object.fromEntries([
    ...Object.entries(secrets).filter(([, v]) => v && v.trim()),
    ...cleared.map((name) => [name, '']),
  ]) as Partial<Record<SecretName, string>>;
  const dirty = Object.keys(draft).length > 0 || Object.keys(secretPatch).length > 0 || domains !== null;

  const save = async () => {
    const body: Record<string, unknown> = { ...draft };
    if (domains !== null) body.knownOrderingDomains = domains.split(/[\n,]/).map((d) => d.trim()).filter(Boolean);
    if (Object.keys(secretPatch).length) body.secrets = secretPatch;
    const result = await action.run('save', () => api<Settings>('/admin/settings', { method: 'PATCH', body: JSON.stringify(body) }), 'Settings saved');
    if (result) {
      setData(result);
      setDraft({});
      setSecrets({});
      setCleared([]);
      setDomains(null);
    }
  };

  const num = (value: string) => (value === '' ? 0 : Number(value));

  return (
    <AdminPage
      title="Settings"
      subtitle="Site details, tax, maintenance, report rules and the keys for payments, SMS and email."
      actions={
        <button className={btn.primary} disabled={!dirty || !!action.busy} onClick={save}>
          Save changes
        </button>
      }
    >
      <Feedback error={action.error} notice={action.notice} className="mb-5" />
      {s.maintenanceMode && (
        <Alert tone="warning" className="mb-5">
          Maintenance mode is on: the public site shows the maintenance message. Staff can still sign in.
        </Alert>
      )}
      <div className="grid xl:grid-cols-2 gap-6">
        <Card>
          <SectionTitle>Site</SectionTitle>
          <div className="flex flex-col gap-4">
            <Field label="Site name">
              <input className={inputClass} value={s.siteName} onChange={(e) => set('siteName', e.target.value)} />
            </Field>
            <Field label="Contact email">
              <input type="email" className={inputClass} value={s.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />
            </Field>
            <Field label="Contact phone">
              <input className={inputClass} value={s.contactPhone ?? ''} onChange={(e) => set('contactPhone', e.target.value)} />
            </Field>
            <Field label="Address (shown on invoices)">
              <textarea rows={2} className={inputClass} value={s.contactAddress ?? ''} onChange={(e) => set('contactAddress', e.target.value)} />
            </Field>
            <Field label="Emails come from" hint='For example "TruOffers <hello@truoffers.co.uk>". The domain must be verified with the email provider.'>
              <input className={inputClass} value={s.emailFrom} onChange={(e) => set('emailFrom', e.target.value)} />
            </Field>
          </div>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <SectionTitle>VAT</SectionTitle>
            <div className="flex flex-col gap-4">
              <Field label="VAT rate (%)">
                <input type="number" min={0} max={50} step={0.5} className={inputClass} value={s.vatRatePercent} onChange={(e) => set('vatRatePercent', num(e.target.value))} />
              </Field>
              <Toggle checked={s.pricesIncludeVat} onChange={(v) => set('pricesIncludeVat', v)} label="Plan prices include VAT" hint="Off: prices are shown and charged plus VAT." />
            </div>
          </Card>
          <Card>
            <SectionTitle>Maintenance</SectionTitle>
            <div className="flex flex-col gap-4">
              <Toggle checked={s.maintenanceMode} onChange={(v) => set('maintenanceMode', v)} label="Maintenance mode" hint="Takes the public site and business dashboard offline." />
              <Field label="Message">
                <textarea rows={2} className={inputClass} value={s.maintenanceMessage} onChange={(e) => set('maintenanceMessage', e.target.value)} />
              </Field>
            </div>
          </Card>
        </div>

        <Card>
          <SectionTitle>Reports</SectionTitle>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Auto-hide after reports" hint="From different people">
              <input type="number" min={1} className={inputClass} value={s.reports.autoHideThreshold} onChange={(e) => set('reports', { ...s.reports, autoHideThreshold: num(e.target.value) })} />
            </Field>
            <Field label="…within (days)">
              <input type="number" min={1} className={inputClass} value={s.reports.windowDays} onChange={(e) => set('reports', { ...s.reports, windowDays: num(e.target.value) })} />
            </Field>
            <Field label="Strikes before a suspension review">
              <input type="number" min={1} className={inputClass} value={s.reports.strikeThreshold} onChange={(e) => set('reports', { ...s.reports, strikeThreshold: num(e.target.value) })} />
            </Field>
            <Field label="…within (days)">
              <input type="number" min={1} className={inputClass} value={s.reports.strikeWindowDays} onChange={(e) => set('reports', { ...s.reports, strikeWindowDays: num(e.target.value) })} />
            </Field>
          </div>
        </Card>

        <Card>
          <SectionTitle>Ordering providers</SectionTitle>
          <Field label="Known ordering domains" hint="One per line. An order link on one of these, or on the business’s own website, passes the link check.">
            <textarea rows={7} className={inputClass} value={domains ?? s.knownOrderingDomains.join('\n')} onChange={(e) => setDomains(e.target.value)} />
          </Field>
        </Card>

        <Card className="xl:col-span-2">
          <SectionTitle>Integrations</SectionTitle>
          <p className="text-sm text-muted mb-5">Keys are stored encrypted and never shown again. Leave a field empty to keep the current key. A key set here replaces the server’s environment variable.</p>
          <div className="grid lg:grid-cols-2 gap-6">
            {SECRET_GROUPS.map((group) => (
              <div key={group.title} className="bg-surface rounded-3xl p-5 flex flex-col gap-4">
                <div>
                  <div className="font-extrabold">{group.title}</div>
                  <div className="text-[12.5px] text-muted">{group.hint}</div>
                </div>
                {group.title === 'reCAPTCHA' && (
                  <Field label="Site key (public)">
                    <input className={inputClass} value={s.recaptchaSiteKey ?? ''} onChange={(e) => set('recaptchaSiteKey', e.target.value)} />
                  </Field>
                )}
                {group.secrets.map(({ name, label }) => {
                  const status = data.secrets[name];
                  return (
                    <Field
                      key={name}
                      label={
                        <span className="flex items-center gap-2">
                          {label}
                          {status?.configured ? (
                            <Tag tone="good">
                              Set {status.hint} {status.source === 'environment' ? '(from server)' : ''}
                            </Tag>
                          ) : (
                            <Tag tone="warn">Not set</Tag>
                          )}
                        </span>
                      }
                    >
                      <div className="flex gap-2">
                        <input
                          type="password"
                          autoComplete="off"
                          className={inputClass}
                          placeholder={status?.configured ? 'Enter a new key to replace it' : 'Paste the key'}
                          value={secrets[name] ?? ''}
                          onChange={(e) => {
                            setSecrets({ ...secrets, [name]: e.target.value });
                            setCleared(cleared.filter((n) => n !== name));
                          }}
                        />
                        {status?.source === 'settings' && (
                          <button
                            type="button"
                            className={cleared.includes(name) ? btn.smallDanger : btn.small}
                            onClick={() => setCleared(cleared.includes(name) ? cleared.filter((n) => n !== name) : [...cleared, name])}
                            title="Remove the key stored here when you save"
                          >
                            {cleared.includes(name) ? 'Will clear' : 'Clear'}
                          </button>
                        )}
                      </div>
                    </Field>
                  );
                })}
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="mt-6">
        <button className={btn.primary} disabled={!dirty || !!action.busy} onClick={save}>
          Save changes
        </button>
      </div>
    </AdminPage>
  );
}

export default function AdminSettingsPage() {
  return (
    <RequireCapability capability="settings.manage">
      <SettingsForm />
    </RequireCapability>
  );
}
