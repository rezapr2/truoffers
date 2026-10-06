'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, btn, Detail, Drawer, EmptyState, Feedback, Field, inputClass, Modal, Pager, SectionTitle, Spinner, StatusPill, Tabs, Tag } from '@/components/ui';
import { api } from '@/lib/api';
import { can, useAuth } from '@/lib/auth-context';
import { useAction, useApi, useDebounced } from '@/lib/hooks';
import { date, dateTime, humanise } from '@/lib/format';
import { AdminPage, ListToolbar, qs, RequireCapability, Table, Td, Th } from '../_components/admin-ui';

interface UserRow {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
  status: string;
  emailVerifiedAt?: string;
  lastLoginAt?: string;
  createdAt: string;
  provider?: string;
  businessCount: number;
}

interface UserDetail {
  user: UserRow & { postcode?: string; offerAlerts?: boolean; twoFactorEnabled: boolean; banReason?: string; bannedAt?: string; followedBusinesses: string[] };
  businesses: { _id: string; name: string; slug: string; town?: string; verificationLevel: number; status: string; role?: string }[];
  claims: { _id: string; status: string; kind: string; businessId?: { name: string }; createdAt: string }[];
  logins: { _id: string; success: boolean; method: string; reason?: string; ip?: string; userAgent?: string; createdAt: string }[];
  reportsFiled: number;
}

const ROLE_OPTIONS = [
  { value: 'customer', label: 'Customer' },
  { value: 'business_owner', label: 'Business owner' },
  { value: 'business_staff', label: 'Business staff' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'moderator,admin,super_admin,support_admin,sales_admin', label: 'Staff' },
];

const DRAWER_TABS = [
  { value: 'profile', label: 'Profile' },
  { value: 'businesses', label: 'Businesses & claims' },
  { value: 'logins', label: 'Login history' },
] as const;

function UserDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { user: me } = useAuth();
  const { data, error, reload } = useApi<UserDetail>(`/admin/users/${id}`);
  const action = useAction();
  const [tab, setTab] = useState<(typeof DRAWER_TABS)[number]['value']>('profile');
  const [form, setForm] = useState<{ name: string; email: string; phone: string; role: string } | null>(null);
  const [modal, setModal] = useState<null | 'ban' | 'erase'>(null);
  const [reason, setReason] = useState('');
  const [resetLink, setResetLink] = useState<string | null>(null);
  const manage = can(me, 'users.manage');

  const u = data?.user;
  const staff = u && ['moderator', 'admin', 'super_admin', 'support_admin', 'sales_admin'].includes(u.role);
  const values = form ?? (u ? { name: u.name, email: u.email, phone: u.phone ?? '', role: u.role } : null);

  const done = async (result: unknown) => {
    if (result === undefined) return;
    setModal(null);
    setReason('');
    setForm(null);
    await reload();
    onChanged();
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={u?.name ?? 'User'}
      subtitle={
        u && (
          <span className="flex items-center gap-2 flex-wrap">
            <StatusPill status={u.status} />
            <span>{humanise(u.role)}</span>
            <span>· joined {date(u.createdAt)}</span>
          </span>
        )
      }
      footer={
        u &&
        manage &&
        u.status !== 'deleted' &&
        !staff && (
          <>
            {!u.emailVerifiedAt && (
              <button className={btn.secondary} disabled={!!action.busy} onClick={() => action.run('verify', () => api(`/admin/users/${id}/verify-email`, { method: 'POST' }), 'Email marked as verified').then(done)}>
                Verify email
              </button>
            )}
            <button
              className={btn.secondary}
              disabled={!!action.busy}
              onClick={async () => {
                const r = await action.run('reset', () => api<{ link: string }>(`/admin/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ send: true }) }), 'Password reset link emailed');
                if (r) setResetLink(r.link);
              }}
            >
              Send reset link
            </button>
            {u.status === 'banned' ? (
              <button className={btn.secondary} disabled={!!action.busy} onClick={() => action.run('unban', () => api(`/admin/users/${id}/unban`, { method: 'POST' }), 'Unbanned').then(done)}>
                Unban
              </button>
            ) : (
              <button className={btn.danger} onClick={() => setModal('ban')}>
                Ban
              </button>
            )}
            <button className={btn.danger} onClick={() => setModal('erase')}>
              Delete (GDPR)
            </button>
          </>
        )
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {!data || !u || !values ? (
        !error && <Spinner />
      ) : (
        <div className="flex flex-col gap-5">
          <Tabs tabs={DRAWER_TABS} active={tab} onChange={setTab} />
          <Feedback error={action.error} notice={action.notice} />
          {resetLink && (
            <Alert tone="info" title="Reset link">
              <span className="break-all">{resetLink}</span>
            </Alert>
          )}
          {u.status === 'banned' && (
            <Alert tone="danger" title={`Banned ${date(u.bannedAt)}`}>
              {u.banReason}
            </Alert>
          )}
          {staff && <Alert tone="info">Staff accounts are managed on the Admin team page.</Alert>}

          {tab === 'profile' && (
            <>
              <dl>
                <Detail label="Email">
                  {u.email} {u.emailVerifiedAt ? <Tag tone="good">Verified</Tag> : <Tag tone="warn">Not verified</Tag>}
                </Detail>
                <Detail label="Sign-in">{humanise(u.provider ?? 'local')}{u.twoFactorEnabled ? ' · 2FA on' : ''}</Detail>
                <Detail label="Postcode">{u.postcode ?? '—'}</Detail>
                <Detail label="Last login">{dateTime(u.lastLoginAt)}</Detail>
                <Detail label="Follows">{u.followedBusinesses?.length ?? 0} takeaways</Detail>
                <Detail label="Reports filed">{data.reportsFiled}</Detail>
              </dl>
              {manage && !staff && u.status !== 'deleted' && (
                <form
                  className="flex flex-col gap-4 bg-surface rounded-3xl p-5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action.run('save', () => api(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(values) }), 'Saved').then(done);
                  }}
                >
                  <SectionTitle className="!mb-0">Edit</SectionTitle>
                  <Field label="Name">
                    <input className={inputClass} value={values.name} onChange={(e) => setForm({ ...values, name: e.target.value })} />
                  </Field>
                  <Field label="Email" hint="Changing it asks them to confirm the new address.">
                    <input type="email" className={inputClass} value={values.email} onChange={(e) => setForm({ ...values, email: e.target.value })} />
                  </Field>
                  <Field label="Phone">
                    <input className={inputClass} value={values.phone} onChange={(e) => setForm({ ...values, phone: e.target.value })} />
                  </Field>
                  <Field label="Role">
                    <select className={inputClass} value={values.role} onChange={(e) => setForm({ ...values, role: e.target.value })}>
                      {ROLE_OPTIONS.slice(0, 4).map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div>
                    <button className={btn.primary} disabled={!form || !!action.busy}>
                      Save
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

          {tab === 'businesses' && (
            <>
              <SectionTitle>Businesses</SectionTitle>
              {data.businesses.length === 0 ? (
                <p className="text-sm text-muted">Not on any business team.</p>
              ) : (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {data.businesses.map((b) => (
                    <li key={b._id} className="flex items-center gap-2">
                      <Link href={`/admin/businesses?open=${b._id}`} className="flex-1 font-bold hover:text-primary truncate">
                        {b.name} · {b.town}
                      </Link>
                      <Tag tone="info">{humanise(b.role)}</Tag>
                      <Tag>Level {b.verificationLevel}</Tag>
                    </li>
                  ))}
                </ul>
              )}
              <SectionTitle>Claims</SectionTitle>
              {data.claims.length === 0 ? (
                <p className="text-sm text-muted">No claims.</p>
              ) : (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {data.claims.map((c) => (
                    <li key={c._id} className="flex items-center gap-2">
                      <Link href={`/admin/claims/${c._id}`} className="flex-1 font-bold hover:text-primary truncate">
                        {c.businessId?.name ?? 'Business'} · {date(c.createdAt)}
                      </Link>
                      <StatusPill status={c.status} />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {tab === 'logins' &&
            (data.logins.length === 0 ? (
              <p className="text-sm text-muted">No sign-ins recorded.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {data.logins.map((l) => (
                  <li key={l._id} className="flex items-start gap-3 border-b border-line pb-1.5">
                    <Tag tone={l.success ? 'good' : 'bad'}>{l.success ? 'OK' : 'Failed'}</Tag>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold">
                        {humanise(l.method)}
                        {l.reason ? ` · ${l.reason}` : ''}
                      </div>
                      <div className="text-[12px] text-muted truncate">
                        {dateTime(l.createdAt)} · {l.ip ?? 'unknown IP'} · {l.userAgent ?? ''}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ))}
        </div>
      )}

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal === 'ban' ? `Ban ${u?.name}?` : `Delete ${u?.name}’s data?`}
        footer={
          <>
            <button className={btn.secondary} onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className={btn.danger}
              disabled={!!action.busy || (modal === 'ban' && reason.trim().length < 3) || (modal === 'erase' && reason !== 'DELETE')}
              onClick={() =>
                modal === 'ban'
                  ? action.run('ban', () => api(`/admin/users/${id}/ban`, { method: 'POST', body: JSON.stringify({ reason }) }), 'Banned and signed out').then(done)
                  : action.run('erase', () => api(`/admin/users/${id}`, { method: 'DELETE' }), 'Personal data erased').then(done)
              }
            >
              {modal === 'ban' ? 'Ban' : 'Erase permanently'}
            </button>
          </>
        }
      >
        {modal === 'ban' ? (
          <Field label="Reason (kept in the audit log)" required>
            <textarea rows={3} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            <p>The name, email, phone and password are removed, and they leave every business team. Audit history stays, anonymised. This cannot be undone.</p>
            <Field label="Type DELETE to confirm">
              <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>
    </Drawer>
  );
}

function UsersList() {
  const params = useSearchParams();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ role: '', status: '' });
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(params.get('open'));
  const q = useDebounced(search);
  const query = { ...filters, q, page };
  const { data, error, loading, reload } = useApi<{ items: UserRow[]; total: number; page: number; pages: number }>(`/admin/users${qs(query)}`);

  return (
    <AdminPage title="Users" subtitle={data ? `${data.total.toLocaleString('en-GB')} accounts` : undefined}>
      <ListToolbar
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Name, email or phone"
        filters={[
          { key: 'role', label: 'Role', options: ROLE_OPTIONS },
          { key: 'status', label: 'Status', options: ['active', 'banned', 'deleted'].map((s) => ({ value: s, label: humanise(s) })) },
        ]}
        values={filters}
        onFilter={(k, v) => {
          setFilters({ ...filters, [k]: v });
          setPage(1);
        }}
        csvPath={`/admin/users${qs({ ...query, page: undefined, format: 'csv' })}`}
        csvName="users.csv"
      />
      <Feedback error={error} className="mb-4" />
      {!data && loading ? (
        <Spinner />
      ) : data && data.items.length === 0 ? (
        <EmptyState title="No users">No accounts match.</EmptyState>
      ) : data ? (
        <>
          <Table minWidth={900}>
            <thead className="bg-surface">
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Businesses</Th>
                <Th>Last login</Th>
                <Th>Joined</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((u) => (
                <tr key={u._id} className="border-t border-line hover:bg-surface/60 cursor-pointer" onClick={() => setOpenId(u._id)}>
                  <Td className="font-extrabold">{u.name}</Td>
                  <Td>
                    {u.email} {!u.emailVerifiedAt && <Tag tone="warn">Unverified</Tag>}
                  </Td>
                  <Td>{humanise(u.role)}</Td>
                  <Td>{u.businessCount || '—'}</Td>
                  <Td className="text-[13px] whitespace-nowrap">{u.lastLoginAt ? date(u.lastLoginAt) : 'Never'}</Td>
                  <Td className="text-[13px] whitespace-nowrap">{date(u.createdAt)}</Td>
                  <Td>
                    <StatusPill status={u.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pager page={data.page} pages={data.pages} onChange={setPage} />
        </>
      ) : null}
      {openId && <UserDrawer id={openId} onClose={() => setOpenId(null)} onChanged={() => void reload()} />}
    </AdminPage>
  );
}

export default function AdminUsersPage() {
  return (
    <RequireCapability capability="users.view">
      <Suspense fallback={<Spinner />}>
        <UsersList />
      </Suspense>
    </RequireCapability>
  );
}
