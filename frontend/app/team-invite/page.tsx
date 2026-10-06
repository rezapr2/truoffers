'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useApi } from '@/lib/hooks';
import { Alert, btn, Spinner } from '@/components/ui';

interface Invite {
  business: { name: string; town?: string };
  email: string;
  role: 'owner' | 'staff';
  expiresAt: string;
}

function InviteInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  const { user, refresh, logout } = useAuth();
  const { data: invite, error } = useApi<Invite>(token ? `/team-invites/${encodeURIComponent(token)}` : null);
  const [busy, setBusy] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const next = `/team-invite?token=${encodeURIComponent(token)}`;

  async function accept() {
    setBusy(true);
    setAcceptError(null);
    try {
      await api(`/team-invites/${encodeURIComponent(token)}/accept`, { method: 'POST' });
      await refresh();
      router.push('/dashboard');
    } catch (err) {
      setAcceptError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="mx-auto max-w-md px-5 py-20"><Alert tone="danger" title="This invitation can’t be used">{error}</Alert></div>;
  if (!invite) return <Spinner />;
  return (
    <div className="mx-auto max-w-md px-5 py-16">
      <div className="bg-card border border-line rounded-3xl p-8 text-center">
        <h1 className="font-display text-2xl font-extrabold mb-2">Join {invite.business.name}</h1>
        <p className="text-muted mb-6">
          You’ve been invited to help run {invite.business.name} on TruOffers as {invite.role === 'owner' ? 'an owner' : 'staff'}.
        </p>
        {acceptError && <Alert tone="danger" className="mb-4">{acceptError}</Alert>}
        {!user ? (
          <div className="flex flex-col gap-3">
            <Link href={`/register?next=${encodeURIComponent(next)}`} className={btn.primary}>Create an account with {invite.email}</Link>
            <Link href={`/login?next=${encodeURIComponent(next)}`} className={btn.secondary}>I already have an account</Link>
          </div>
        ) : user.email !== invite.email ? (
          <div className="flex flex-col gap-3">
            <Alert tone="warning">This invitation is for {invite.email}, but you’re signed in as {user.email}.</Alert>
            <button className={btn.secondary} onClick={logout}>Log out</button>
          </div>
        ) : (
          <button className={btn.primary} onClick={accept} disabled={busy}>
            {busy ? 'Joining…' : 'Accept invitation'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function TeamInvitePage() {
  return (
    <Suspense>
      <InviteInner />
    </Suspense>
  );
}
