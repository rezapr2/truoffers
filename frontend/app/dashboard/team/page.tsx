'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useBusiness } from '@/lib/business-context';
import { useApi } from '@/lib/hooks';
import { date, timeAgo } from '@/lib/format';
import type { BusinessMember } from '@/lib/types';
import { Alert, btn, Card, Field, inputClass, SectionTitle, Spinner, Tag } from '@/components/ui';
import { DashboardPage } from '../_components/shared';

interface Team {
  members: BusinessMember[];
  invites: { _id: string; email: string; role: string; expiresAt: string }[];
  myRole: 'owner' | 'staff' | null;
}

export default function TeamPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { business, reloadList } = useBusiness();
  const { data, reload } = useApi<Team>(business ? `/businesses/${business._id}/team` : null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'staff' | 'owner'>('staff');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!business || !data) return <Spinner />;
  const isOwner = data.myRole === 'owner';
  const base = `/businesses/${business._id}/team`;

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DashboardPage title="Team" subtitle="Owners manage the plan, promotions and the team. Staff post and edit offers and the profile.">
      <div className="flex flex-col gap-6">
        {error && <Alert tone="danger">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        <section>
          <SectionTitle>People</SectionTitle>
          <div className="border border-line rounded-3xl overflow-hidden">
            {data.members.map((m) => (
              <div key={m.userId} className="flex items-center gap-4 px-5 py-4 border-t border-line first:border-t-0 flex-wrap">
                <div className="w-10 h-10 rounded-full bg-tint-blue text-primary font-display font-extrabold flex items-center justify-center">{m.name?.charAt(0) ?? '?'}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-extrabold">
                    {m.name} {m.userId === user?.id && <span className="text-muted font-semibold">(you)</span>}
                  </div>
                  <div className="text-[13px] text-muted">
                    {m.email} · joined {date(m.addedAt)}
                    {m.lastLoginAt ? ` · last seen ${timeAgo(m.lastLoginAt)}` : ''}
                  </div>
                </div>
                {m.primary && <Tag tone="info">Primary owner</Tag>}
                {isOwner && m.userId !== user?.id ? (
                  <>
                    <select
                      value={m.role}
                      aria-label={`Role for ${m.name}`}
                      onChange={(e) => act(() => api(`${base}/${m.userId}`, { method: 'PATCH', body: JSON.stringify({ role: e.target.value }) }), 'Role updated.')}
                      className="bg-surface rounded-xl px-3 py-2 text-sm font-bold outline-none cursor-pointer"
                    >
                      <option value="owner">Owner</option>
                      <option value="staff">Staff</option>
                    </select>
                    <button className={btn.smallDanger} disabled={busy} onClick={() => confirm(`Remove ${m.name} from the team?`) && act(() => api(`${base}/${m.userId}`, { method: 'DELETE' }), 'Removed from the team.')}>
                      Remove
                    </button>
                  </>
                ) : (
                  <Tag>{m.role === 'owner' ? 'Owner' : 'Staff'}</Tag>
                )}
                {m.userId === user?.id && (
                  <button
                    className={btn.small}
                    disabled={busy}
                    onClick={async () => {
                      if (!confirm(`Leave ${business.name}?`)) return;
                      try {
                        await api(`${base}/${m.userId}`, { method: 'DELETE' });
                        await reloadList();
                        router.push('/dashboard');
                      } catch (err) {
                        setError(errorMessage(err));
                      }
                    }}
                  >
                    Leave
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        {isOwner && (
          <>
            <Card>
              <SectionTitle>Invite someone</SectionTitle>
              <form
                className="flex gap-3 items-end flex-wrap"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    const res = await api<{ devInviteUrl?: string }>(`${base}/invites`, { method: 'POST', body: JSON.stringify({ email, role }) });
                    setDevLink(res.devInviteUrl ?? null);
                    setEmail('');
                  }, `Invitation sent to ${email}. It works for 7 days.`);
                }}
              >
                <Field label="Email" className="flex-1 min-w-[220px]">
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
                </Field>
                <Field label="Role">
                  <select value={role} onChange={(e) => setRole(e.target.value as 'staff' | 'owner')} className={inputClass}>
                    <option value="staff">Staff</option>
                    <option value="owner">Owner</option>
                  </select>
                </Field>
                <button type="submit" className={btn.primary} disabled={busy}>
                  Send invitation
                </button>
              </form>
              {devLink && (
                <p className="text-[13px] bg-surface rounded-xl px-4 py-2.5 mt-3">
                  Development: <a className="text-primary font-bold break-all" href={devLink}>invitation link</a>
                </p>
              )}
            </Card>
            {data.invites.length > 0 && (
              <section>
                <SectionTitle>Waiting to accept</SectionTitle>
                <div className="flex flex-col gap-2">
                  {data.invites.map((inv) => (
                    <div key={inv._id} className="flex items-center gap-3 bg-surface rounded-2xl px-4 py-3 text-sm flex-wrap">
                      <span className="flex-1 font-bold">{inv.email}</span>
                      <Tag>{inv.role}</Tag>
                      <span className="text-muted">until {date(inv.expiresAt)}</span>
                      <button className={btn.smallDanger} onClick={() => act(() => api(`${base}/invites/${inv._id}`, { method: 'DELETE' }), 'Invitation cancelled.')}>
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </DashboardPage>
  );
}
