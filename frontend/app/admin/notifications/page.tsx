'use client';

import { useState } from 'react';
import { Alert, btn, Drawer, EmptyState, Feedback, Field, inputClass, Spinner, StatusPill, Tabs, Tag, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAction, useApi, useDebounced } from '@/lib/hooks';
import { dateTime, humanise } from '@/lib/format';
import { AdminPage, ListToolbar, qs, RequireCapability, Table, Td, Th } from '../_components/admin-ui';

interface Template {
  key: string;
  name: string;
  audience: 'customer' | 'business' | 'staff' | 'reporter';
  variables: string[];
  subject: string;
  body: string;
  defaultSubject: string;
  defaultBody: string;
  enabled: boolean;
  customised: boolean;
  updatedAt?: string;
}

interface LogEntry {
  _id: string;
  to: string;
  template: string;
  subject: string;
  body: string;
  status: string;
  provider?: string;
  error?: string;
  createdAt: string;
}

const TABS = [
  { value: 'templates', label: 'Templates' },
  { value: 'log', label: 'Sent emails' },
] as const;
type Tab = (typeof TABS)[number]['value'];

const LOG_TONE: Record<string, 'good' | 'bad' | 'neutral' | 'warn'> = { sent: 'good', failed: 'bad', disabled: 'neutral', logged: 'warn' };

function TemplateEditor({ template, onClose, onSaved }: { template: Template; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const [form, setForm] = useState({ subject: template.subject, body: template.body, enabled: template.enabled });
  const [testTo, setTestTo] = useState(user?.email ?? '');
  const action = useAction();
  const preview = useApi<{ subject: string; body: string; html: string }>(`/admin/email-templates/${template.key}/preview`);
  const dirty = form.subject !== template.subject || form.body !== template.body || form.enabled !== template.enabled;

  const save = async () => {
    const r = await action.run('save', () => api(`/admin/email-templates/${template.key}`, { method: 'PUT', body: JSON.stringify(form) }), 'Saved');
    if (r !== undefined) {
      await preview.reload();
      onSaved();
    }
  };
  const reset = async () => {
    if (!window.confirm('Go back to the built-in wording?')) return;
    const r = await action.run('reset', () => api(`/admin/email-templates/${template.key}`, { method: 'DELETE' }), 'Back to the default');
    if (r !== undefined) {
      setForm({ subject: template.defaultSubject, body: template.defaultBody, enabled: true });
      await preview.reload();
      onSaved();
    }
  };
  const test = () =>
    action.run('test', () => api<{ status: string }>(`/admin/email-templates/${template.key}/test`, { method: 'POST', body: JSON.stringify({ to: testTo }) }), (r) => (r.status === 'sent' ? `Test sent to ${testTo}` : `Not sent (${r.status}). Check the email key in Settings.`));

  return (
    <Drawer
      open
      onClose={onClose}
      title={template.name}
      subtitle={`To: ${humanise(template.audience)} · ${template.key}`}
      footer={
        <>
          <button className={btn.primary} disabled={!dirty || !!action.busy} onClick={save}>
            Save
          </button>
          {template.customised && (
            <button className={btn.secondary} disabled={!!action.busy} onClick={reset}>
              Reset to default
            </button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Feedback error={action.error} notice={action.notice} />
        <Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="Send this email" hint="Off: nothing is sent; the in-app notification still appears." />
        <Field label="Subject">
          <input className={inputClass} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        </Field>
        <Field label="Body" hint="Plain text. A link on its own line becomes a button.">
          <textarea rows={12} className={`${inputClass} font-mono text-sm`} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </Field>
        <div className="text-sm">
          <span className="font-extrabold">Placeholders: </span>
          {['siteName', ...template.variables].map((v) => (
            <button key={v} type="button" className="font-mono text-[12.5px] bg-surface rounded-lg px-2 py-0.5 mr-1.5 mb-1.5 cursor-pointer hover:bg-tint-blue" onClick={() => setForm({ ...form, body: `${form.body}{{${v}}}` })}>
              {`{{${v}}}`}
            </button>
          ))}
        </div>
        <div>
          <div className="font-extrabold text-sm mb-2">Preview {dirty && <span className="text-muted font-semibold">(of the saved version)</span>}</div>
          {preview.data ? (
            <div className="border border-line rounded-2xl overflow-hidden">
              <div className="bg-surface px-4 py-2 text-sm font-bold">{preview.data.subject}</div>
              <iframe title="Email preview" srcDoc={preview.data.html} sandbox="" className="w-full h-[420px] bg-white" />
            </div>
          ) : (
            <Spinner />
          )}
        </div>
        <div className="bg-surface rounded-3xl p-5 flex gap-3 items-end flex-wrap">
          <Field label="Send a test to" className="flex-1 min-w-[200px]">
            <input type="email" className={inputClass} value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          </Field>
          <button className={btn.secondary} disabled={!testTo.includes('@') || !!action.busy} onClick={test}>
            Send test
          </button>
        </div>
      </div>
    </Drawer>
  );
}

function Templates() {
  const { data, error, reload } = useApi<Template[]>('/admin/email-templates');
  const [open, setOpen] = useState<string | null>(null);
  const [audience, setAudience] = useState('');
  if (!data) return error ? <Feedback error={error} /> : <Spinner />;
  const rows = data.filter((t) => !audience || t.audience === audience);
  const current = data.find((t) => t.key === open);
  return (
    <>
      <ListToolbar
        filters={[{ key: 'audience', label: 'Sent to', options: ['customer', 'business', 'staff', 'reporter'].map((a) => ({ value: a, label: humanise(a) })) }]}
        values={{ audience }}
        onFilter={(_, v) => setAudience(v)}
      />
      <Table minWidth={760}>
        <thead className="bg-surface">
          <tr>
            <Th>Email</Th>
            <Th>Sent to</Th>
            <Th>Subject</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.key} className="border-t border-line hover:bg-surface/60 cursor-pointer" onClick={() => setOpen(t.key)}>
              <Td className="font-extrabold">{t.name}</Td>
              <Td>{humanise(t.audience)}</Td>
              <Td className="text-[13px] max-w-[360px] truncate">{t.subject}</Td>
              <Td>
                <div className="flex gap-1">
                  {!t.enabled && <Tag tone="bad">Off</Tag>}
                  {t.customised ? <Tag tone="info">Edited</Tag> : <Tag>Default</Tag>}
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {current && <TemplateEditor key={current.key + (current.updatedAt ?? '')} template={current} onClose={() => setOpen(null)} onSaved={() => void reload()} />}
    </>
  );
}

function Log() {
  const [to, setTo] = useState('');
  const [template, setTemplate] = useState('');
  const toQ = useDebounced(to.trim());
  const { data, error } = useApi<LogEntry[]>(`/admin/email-templates/log${qs({ to: toQ, template })}`);
  const templates = useApi<Template[]>('/admin/email-templates');
  const [open, setOpen] = useState<LogEntry | null>(null);
  return (
    <>
      <ListToolbar
        search={to}
        onSearch={setTo}
        placeholder="Recipient email (exact)"
        filters={[{ key: 'template', label: 'Email', options: (templates.data ?? []).map((t) => ({ value: t.key, label: t.name })) }]}
        values={{ template }}
        onFilter={(_, v) => setTemplate(v)}
      />
      <Feedback error={error} className="mb-4" />
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <EmptyState title="No emails">Nothing sent yet, or nothing matches.</EmptyState>
      ) : (
        <Table minWidth={760}>
          <thead className="bg-surface">
            <tr>
              <Th>When</Th>
              <Th>To</Th>
              <Th>Subject</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((e) => (
              <tr key={e._id} className="border-t border-line hover:bg-surface/60 cursor-pointer" onClick={() => setOpen(e)}>
                <Td className="text-[13px] whitespace-nowrap">{dateTime(e.createdAt)}</Td>
                <Td className="text-[13px]">{e.to}</Td>
                <Td className="text-[13px] max-w-[360px] truncate">{e.subject}</Td>
                <Td>
                  <Tag tone={LOG_TONE[e.status] ?? 'neutral'}>{humanise(e.status)}</Tag>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {open && (
        <Drawer open onClose={() => setOpen(null)} title={open.subject} subtitle={`${open.to} · ${dateTime(open.createdAt)}`}>
          <div className="flex flex-col gap-4">
            <div className="flex gap-2 items-center">
              <StatusPill status={open.status} label={humanise(open.status)} />
              <span className="text-sm text-muted">{open.provider ?? 'no provider'}</span>
            </div>
            {open.error && <Alert tone="danger">{open.error}</Alert>}
            <pre className="whitespace-pre-wrap text-sm bg-surface rounded-2xl p-4 font-sans">{open.body}</pre>
          </div>
        </Drawer>
      )}
    </>
  );
}

export default function AdminNotificationsPage() {
  const [tab, setTab] = useState<Tab>('templates');
  return (
    <RequireCapability capability="templates.manage">
      <AdminPage title="Emails & notifications" subtitle="The wording of every automatic email, and a log of what was sent.">
        <div className="mb-5">
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
        </div>
        {tab === 'templates' ? <Templates /> : <Log />}
      </AdminPage>
    </RequireCapability>
  );
}
