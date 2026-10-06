'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth-context';
import { Alert, btn, Field, inputClass } from '@/components/ui';

function ResetInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { acceptSession } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError('The passwords don’t match');
    setBusy(true);
    setError(null);
    try {
      const res = await api('/auth/password/reset', { method: 'POST', body: JSON.stringify({ token: params.get('token'), password }) });
      const step = acceptSession(res);
      // Staff still complete their second step at the normal login.
      router.push(step.kind === 'session' ? homeFor(step.user) : '/login');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-5 py-16">
      <h1 className="font-display text-3xl font-extrabold tracking-tight mb-2">Choose a new password</h1>
      <p className="text-muted font-semibold mb-8">Every other session on your account will be signed out.</p>
      <form onSubmit={submit} className="bg-card border border-line rounded-3xl p-7 flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="New password" hint="8 characters or more.">
          <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Confirm new password">
          <input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
        </Field>
        <button type="submit" disabled={busy || !params.get('token')} className={btn.primary}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetInner />
    </Suspense>
  );
}
