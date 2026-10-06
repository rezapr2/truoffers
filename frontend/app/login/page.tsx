'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { homeFor, useAuth, type LoginStep } from '@/lib/auth-context';
import { api, errorMessage } from '@/lib/api';
import SocialLogin from '@/components/SocialLogin';
import { Alert, btn, Field, inputClass } from '@/components/ui';

interface Setup {
  secret: string;
  otpauthUrl: string;
  qrCode: string;
}

/** Staff sign-in, step two: the code from their authenticator app (or enrolling one the first time). */
function TwoFactor({ step, onDone }: { step: Extract<LoginStep, { kind: 'two_factor' | 'two_factor_setup' }>; onDone: (step: LoginStep) => void }) {
  const { acceptSession } = useAuth();
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startSetup() {
    setBusy(true);
    setError(null);
    try {
      setSetup(await api<Setup>('/auth/2fa/setup', { method: 'POST', body: JSON.stringify({ challengeToken: step.challengeToken }) }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const path = step.kind === 'two_factor' ? '/auth/2fa/verify' : '/auth/2fa/enable';
      const res = await api(path, { method: 'POST', body: JSON.stringify({ challengeToken: step.challengeToken, code }) });
      onDone(acceptSession(res));
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={verify} className="bg-card border border-line rounded-3xl p-7 flex flex-col gap-4">
      <h2 className="font-display text-xl font-extrabold">Two-step sign-in</h2>
      {error && <Alert tone="danger">{error}</Alert>}
      {step.kind === 'two_factor_setup' && !setup ? (
        <>
          <p className="text-sm text-ink-soft leading-relaxed">
            Admin accounts need a second step. Install an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) and set it up for TruOffers.
          </p>
          <button type="button" className={btn.primary} onClick={startSetup} disabled={busy}>
            {busy ? 'Preparing…' : 'Set up my authenticator'}
          </button>
        </>
      ) : (
        <>
          {setup && (
            <div className="flex flex-col items-center gap-3 bg-surface rounded-2xl p-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.qrCode} alt="QR code for your authenticator app" className="w-48 h-48 rounded-xl bg-white p-2" />
              <p className="text-[13px] text-muted text-center">
                Scan it, or enter this key: <code className="font-bold text-ink break-all">{setup.secret}</code>
              </p>
            </div>
          )}
          <Field label="6-digit code from your app">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="000000"
              className={`${inputClass} font-display text-2xl tracking-[0.4em] text-center`}
            />
          </Field>
          <button type="submit" disabled={busy || code.length !== 6} className={btn.primary}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
        </>
      )}
    </form>
  );
}

function LoginInner() {
  const { login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<LoginStep | null>(null);

  function next(result: LoginStep) {
    if (result.kind !== 'session') {
      setStep(result);
      return;
    }
    const target = params.get('next');
    router.push(target && target.startsWith('/') && !target.startsWith('//') ? target : homeFor(result.user));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      next(await login(email, password));
    } catch (err) {
      setError(errorMessage(err, 'Login failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-5 py-16">
      <h1 className="font-display text-3xl font-extrabold tracking-tight mb-2">Welcome back</h1>
      <p className="text-muted font-semibold mb-8">Log in to manage your offers and favourites.</p>
      {step && step.kind !== 'session' ? (
        <TwoFactor step={step} onDone={next} />
      ) : (
        <form onSubmit={submit} className="bg-card border border-line rounded-3xl p-7 flex flex-col gap-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Email">
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Password">
            <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
          </Field>
          <Link href="/forgot-password" className="text-sm font-bold text-primary self-end -mt-2">
            Forgot your password?
          </Link>
          <button type="submit" disabled={busy} className={`${btn.primary} py-3.5`}>
            {busy ? 'Logging in…' : 'Log in'}
          </button>
          <SocialLogin onSuccess={next} />
        </form>
      )}
      <p className="text-sm font-semibold text-muted mt-5 text-center">
        New here?{' '}
        <Link href="/register" className="text-primary font-bold">
          Create an account
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
