'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import BusinessCard from '@/components/BusinessCard';
import OfferCard from '@/components/OfferCard';
import PageHero from '@/components/PageHero';
import { Alert, btn, Card, EmptyState, Feedback, Field, inputClass, Modal, SectionTitle, Spinner, StatusPill, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { accountHref, useAuth } from '@/lib/auth-context';
import { date } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import type { Business, Offer } from '@/lib/types';

interface Ticket {
  _id: string;
  number: string;
  subject: string;
  status: string;
  updatedAt: string;
  businessId?: { name: string };
}

const TICKET_STATUS: Record<string, string> = { open: 'With our team', pending: 'Waiting for you', closed: 'Closed' };

function ProfileCard() {
  const { user, refresh } = useAuth();
  const action = useAction();
  const [form, setForm] = useState({ name: user?.name ?? '', phone: user?.phone ?? '', postcode: user?.postcode ?? '' });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await action.run('profile', () => api('/users/me', { method: 'PATCH', body: JSON.stringify(form) }), 'Saved');
    if (r) await refresh();
  };

  return (
    <Card>
      <SectionTitle>Your details</SectionTitle>
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Name">
          <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
        </Field>
        <Field label="Email" hint="To change your email, contact us.">
          <input className={inputClass} value={user?.email ?? ''} disabled />
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Mobile number" hint="Only used for texts you agree to below.">
            <input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="07700 900123" />
          </Field>
          <Field label="Postcode" hint="Shows offers near you first.">
            <input className={inputClass} value={form.postcode} onChange={(e) => setForm({ ...form, postcode: e.target.value })} placeholder="M14 5TQ" />
          </Field>
        </div>
        <Feedback error={action.error} notice={action.notice} />
        <div className="flex gap-3 flex-wrap items-center">
          <button className={btn.primary} disabled={!!action.busy}>
            Save details
          </button>
          <Link href="/forgot-password" className={`${btn.link} text-sm`}>
            Change password
          </Link>
        </div>
      </form>
    </Card>
  );
}

function PreferencesCard() {
  const { user, refresh } = useAuth();
  const action = useAction();
  const set = async (patch: Record<string, boolean>, notice: string) => {
    const r = await action.run('prefs', () => api('/users/me', { method: 'PATCH', body: JSON.stringify(patch) }), notice);
    if (r) await refresh();
  };
  return (
    <Card>
      <SectionTitle>What we send you</SectionTitle>
      <div className="flex flex-col gap-5">
        <Toggle
          checked={user?.offerAlerts !== false}
          onChange={(v) => set({ offerAlerts: v }, v ? 'Offer alerts on' : 'Offer alerts off')}
          label="New offers from takeaways I follow"
          hint="An email when a takeaway you follow posts an offer."
          disabled={!!action.busy}
        />
        <Toggle
          checked={!!user?.marketingEmails}
          onChange={(v) => set({ marketingEmails: v }, v ? 'You will get our offers and news by email' : 'Unsubscribed from marketing emails')}
          label="Offers and news by email"
          hint="Occasional emails from TruOffers about deals and new features."
          disabled={!!action.busy}
        />
        <Toggle
          checked={!!user?.marketingSms}
          onChange={(v) => set({ marketingSms: v }, v ? 'You will get offers by text' : 'Unsubscribed from texts')}
          label="Offers by text message"
          hint={user?.phone ? 'Sent to your mobile number. Reply STOP to any text to opt out.' : 'Add your mobile number above first.'}
          disabled={!!action.busy || (!user?.phone && !user?.marketingSms)}
        />
        <p className="text-[12.5px] text-muted">Account emails, such as password resets and replies to your support requests, are always sent.</p>
        <Feedback error={action.error} notice={action.notice} />
      </div>
    </Card>
  );
}

function SupportCard() {
  const { data } = useApi<Ticket[]>('/support/tickets/mine');
  return (
    <Card>
      <SectionTitle aside={<Link href="/contact" className={`${btn.link} text-sm`}>New request</Link>}>Support requests</SectionTitle>
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <p className="text-sm text-muted">No requests yet. If something isn’t right, <Link href="/contact" className="text-primary font-bold">contact us</Link>.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.map((t) => (
            <li key={t._id}>
              <Link href={`/support/${t._id}`} className="flex items-center gap-3 bg-surface hover:bg-tint-blue/60 rounded-2xl px-4 py-3 text-sm">
                <span className="flex-1 min-w-0">
                  <span className="font-extrabold block truncate">{t.subject}</span>
                  <span className="text-[12px] text-muted">
                    {t.number} · updated {date(t.updatedAt)}
                    {t.businessId ? ` · ${t.businessId.name}` : ''}
                  </span>
                </span>
                <StatusPill status={t.status === 'pending' ? 'info_requested' : t.status === 'open' ? 'open' : 'ended'} label={TICKET_STATUS[t.status]} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SavedSection() {
  const { data, error } = useApi<{ offers: Offer[]; businesses: Business[] }>('/users/me/saved');
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data) return <Spinner />;
  return (
    <div className="flex flex-col gap-10">
      <section>
        <SectionTitle aside={<Link href="/takeaways" className={`${btn.link} text-sm`}>Find takeaways</Link>}>Takeaways you follow</SectionTitle>
        {data.businesses.length === 0 ? (
          <EmptyState>Follow a takeaway to hear about its new offers.</EmptyState>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.businesses.map((b) => (
              <BusinessCard key={b._id} business={b} />
            ))}
          </div>
        )}
      </section>
      <section>
        <SectionTitle aside={<Link href="/offers" className={`${btn.link} text-sm`}>Browse offers</Link>}>Saved offers</SectionTitle>
        {data.offers.length === 0 ? (
          <EmptyState>Offers you save appear here while they are live.</EmptyState>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {data.offers.map((o, i) => (
              <OfferCard key={o._id} offer={o} index={i} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DeleteAccount() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const action = useAction();
  // Accounts created with Google or Apple have no password; they confirm by typing DELETE.
  const [social, setSocial] = useState(false);

  const remove = async () => {
    const r = await action.run('delete', () => api('/users/me', { method: 'DELETE', body: JSON.stringify(social ? { confirm } : { password }) }));
    if (r !== undefined) {
      logout();
      router.replace('/?deleted=1');
    }
  };

  if (user && accountHref(user) === '/admin') return null;
  return (
    <Card className="border-danger/30">
      <SectionTitle>Delete your account</SectionTitle>
      <p className="text-sm text-muted mb-4">
        This removes your name, email, phone number, saved offers and follows, and takes you off any business team. It can’t be undone.
      </p>
      <button className={btn.danger} onClick={() => setOpen(true)}>
        Delete my account
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete your account?"
        footer={
          <>
            <button className={btn.secondary} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className={btn.danger} disabled={!!action.busy || (social ? confirm !== 'DELETE' : !password)} onClick={remove}>
              Delete permanently
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {social ? (
            <Field label="Type DELETE to confirm">
              <input className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
          ) : (
            <Field label="Your password" hint={<button type="button" className={btn.link} onClick={() => setSocial(true)}>I sign in with Google or Apple</button>}>
              <input type="password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
          )}
          <Feedback error={action.error} />
        </div>
      </Modal>
    </Card>
  );
}

export default function AccountPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/login?next=/account');
  }, [loading, user, router]);

  if (loading || !user) return <Spinner />;
  const workspace = accountHref(user);

  return (
    <div>
      <PageHero title={`Hi ${user.name.split(' ')[0]}`} subtitle="Your details, what we send you, and the takeaways and offers you saved." />
      <div className="mx-auto max-w-7xl px-5 md:px-10 py-10 flex flex-col gap-10">
        {workspace !== '/account' && (
          <Alert tone="info" action={<Link href={workspace} className={btn.small}>{workspace === '/admin' ? 'Open the admin panel' : 'Open your dashboard'}</Link>}>
            {workspace === '/admin' ? 'You are signed in as staff.' : 'Manage your business from the dashboard.'}
          </Alert>
        )}
        <div className="grid lg:grid-cols-2 gap-6">
          <ProfileCard />
          <div className="flex flex-col gap-6">
            <PreferencesCard />
            <SupportCard />
          </div>
        </div>
        <SavedSection />
        <DeleteAccount />
      </div>
    </div>
  );
}
