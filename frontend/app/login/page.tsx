'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import SocialLogin from '@/components/SocialLogin';
import type { User } from '@/lib/types';

function LoginInner() {
  const { login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function redirectFor(user: User) {
    const next = params.get('next');
    if (next) router.push(next);
    else if (['super_admin', 'support_admin', 'sales_admin'].includes(user.role)) router.push('/admin');
    else if (['business_owner', 'supplier'].includes(user.role)) router.push('/dashboard');
    else router.push('/');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      redirectFor(await login(email, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-5 py-16">
      <h1 className="font-display text-3xl font-extrabold tracking-tight mb-2">Welcome back</h1>
      <p className="text-muted font-semibold mb-8">Log in to manage your offers and favourites.</p>
      <form onSubmit={submit} className="bg-card rounded-3xl p-7 flex flex-col gap-4">
        {error && (
          <div className="bg-peach-2/40 border border-primary/30 text-primary-dark text-sm font-bold rounded-xl px-4 py-3">
            {error}
          </div>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-extrabold">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border border-line rounded-xl px-4 py-3 font-semibold outline-none focus:border-primary bg-surface"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-extrabold">Password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border border-line rounded-xl px-4 py-3 font-semibold outline-none focus:border-primary bg-surface"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="bg-ink text-surface font-bold py-3.5 rounded-full hover:bg-primary transition-colors cursor-pointer disabled:opacity-60 mt-2"
        >
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        <SocialLogin onSuccess={redirectFor} />
      </form>
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
