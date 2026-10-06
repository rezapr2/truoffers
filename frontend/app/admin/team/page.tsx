'use client';

import { useState } from 'react';
import { btn, EmptyState, Feedback, Field, inputClass, Modal, Spinner, Tag } from '@/components/ui';
import { PlusIcon } from '@/components/icons';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAction, useApi } from '@/lib/hooks';
import { date, dateTime, humanise } from '@/lib/format';
import { AdminPage, RequireCapability, Table, Td, Th } from '../_components/admin-ui';

interface Staff {
  _id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  lastLoginAt?: string;
  createdAt: string;
  twoFactor?: { enabled?: boolean; enrolledAt?: string };
}

const ROLES = [
  { value: 'moderator', label: 'Moderator', hint: 'Claims, offers, reports. Can suggest a suspension.' },
  { value: 'admin', label: 'Admin', hint: 'Moderator rights plus businesses, users, suspensions and view-as.' },
  { value: 'super_admin', label: 'Super admin', hint: 'Everything, including plans, money, settings and this team.' },
];

function Team() {
  const { user } = useAuth();
  const { data, error, reload } = useApi<Staff[]>('/admin/team');
  const action = useAction();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', role: 'moderator' });
  const [devLink, setDevLink] = useState<string | null>(null);

  const add = async () => {
    const result = await action.run('add', () => api<{ devSetPasswordUrl?: string }>('/admin/team', { method: 'POST', body: JSON.stringify(form) }), `${form.email} added as ${humanise(form.role)}`);
    if (result) {
      setDevLink(result.devSetPasswordUrl ?? null);
      setAdding(false);
      setForm({ email: '', name: '', role: 'moderator' });
      await reload();
    }
  };

  const setRole = (id: string, role: string) => action.run(id, () => api(`/admin/team/${id}`, { method: 'PATCH', body: JSON.stringify({ role }) }), 'Role changed').then(() => reload());
  const remove = (s: Staff) => {
    if (!window.confirm(`Remove ${s.name} from the admin team? Their account becomes a normal customer account.`)) return;
    void action.run(s._id, () => api(`/admin/team/${s._id}`, { method: 'DELETE' }), 'Removed from the team').then(() => reload());
  };
  const reset2fa = (s: Staff) => {
    if (!window.confirm(`Reset ${s.name}’s two-factor sign-in? They will set it up again at their next sign-in.`)) return;
    void action.run(s._id, () => api(`/admin/team/${s._id}/reset-2fa`, { method: 'POST' }), 'Two-factor sign-in reset').then(() => reload());
  };

  return (
    <AdminPage
      title="Admin team"
      subtitle="Everyone with access to this panel. Two-factor sign-in is required for every staff account."
      actions={
        <button className={btn.primary} onClick={() => setAdding(true)}>
          <PlusIcon className="w-4 h-4" /> Add staff
        </button>
      }
    >
      <Feedback error={action.error ?? error} notice={action.notice} className="mb-4" />
      {devLink && (
        <Feedback notice={`Development only: set-password link ${devLink}`} className="mb-4" />
      )}
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <EmptyState title="No staff" />
      ) : (
        <Table minWidth={860}>
          <thead className="bg-surface">
            <tr>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Two-factor</Th>
              <Th>Last login</Th>
              <Th>Added</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.map((s) => {
              const self = s._id === user?.id;
              return (
                <tr key={s._id} className="border-t border-line">
                  <Td>
                    <div className="font-extrabold">
                      {s.name} {self && <Tag tone="info">You</Tag>}
                    </div>
                    <div className="text-[12.5px] text-muted">{s.email}</div>
                  </Td>
                  <Td>
                    <select
                      aria-label="Role"
                      disabled={self || !!action.busy}
                      value={['support_admin'].includes(s.role) ? 'moderator' : s.role === 'sales_admin' ? 'admin' : s.role}
                      onChange={(e) => setRole(s._id, e.target.value)}
                      className="bg-surface border border-line rounded-xl px-3 py-2 text-sm font-bold"
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </Td>
                  <Td>{s.twoFactor?.enabled ? <Tag tone="good">On since {date(s.twoFactor.enrolledAt)}</Tag> : <Tag tone="warn">Set up at next sign-in</Tag>}</Td>
                  <Td className="text-[13px] whitespace-nowrap">{s.lastLoginAt ? dateTime(s.lastLoginAt) : 'Never'}</Td>
                  <Td className="text-[13px] whitespace-nowrap">{date(s.createdAt)}</Td>
                  <Td>
                    {!self && (
                      <div className="flex gap-2 justify-end">
                        {s.twoFactor?.enabled && (
                          <button className={btn.small} disabled={!!action.busy} onClick={() => reset2fa(s)}>
                            Reset 2FA
                          </button>
                        )}
                        <button className={btn.smallDanger} disabled={!!action.busy} onClick={() => remove(s)}>
                          Remove
                        </button>
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add staff"
        footer={
          <>
            <button className={btn.secondary} onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className={btn.primary} disabled={!form.email.includes('@') || !!action.busy} onClick={add}>
              Add
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Email" hint="An existing account is promoted. A new person gets an email to set a password." required>
            <input type="email" className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Name">
            <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Role">
            <div className="flex flex-col gap-2">
              {ROLES.map((r) => (
                <label key={r.value} className={`rounded-2xl px-4 py-3 cursor-pointer border ${form.role === r.value ? 'border-primary bg-tint-blue' : 'border-line'}`}>
                  <input type="radio" name="role" className="sr-only" checked={form.role === r.value} onChange={() => setForm({ ...form, role: r.value })} />
                  <div className="font-extrabold text-sm">{r.label}</div>
                  <div className="text-[12.5px] text-muted">{r.hint}</div>
                </label>
              ))}
            </div>
          </Field>
        </div>
      </Modal>
    </AdminPage>
  );
}

export default function AdminTeamPage() {
  return (
    <RequireCapability capability="team.manage">
      <Team />
    </RequireCapability>
  );
}
