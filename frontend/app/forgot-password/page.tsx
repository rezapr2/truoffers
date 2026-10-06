'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Alert, btn, Field, inputClass } from '@/components/ui';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<{ devResetUrl?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSent(await api<{ devResetUrl?: string }>('/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email }) }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-5 py-16">
      <h1 className="font-display text-3xl font-extrabold tracking-tight mb-2">Reset your password</h1>
      <p className="text-muted font-semibold mb-8">We’ll email you a link to choose a new one.</p>
      {sent ? (
        <div className="bg-card border border-line rounded-3xl p-7 flex flex-col gap-4">
          <Alert tone="success">If an account uses {email}, a reset link is on its way. It works for one hour.</Alert>
          {sent.devResetUrl && (
            <p className="text-[13px] bg-surface rounded-xl px-4 py-3">
              Development: <a className="text-primary font-bold break-all" href={sent.devResetUrl}>open the reset link</a>
            </p>
          )}
          <Link href="/login" className={btn.secondary}>
            Back to log in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="bg-card border border-line rounded-3xl p-7 flex flex-col gap-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Email">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </Field>
          <button type="submit" disabled={busy} className={btn.primary}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
    </div>
  );
}
