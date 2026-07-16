'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import SocialLogin from '@/components/SocialLogin';
import type { User } from '@/lib/types';

const ROLES = [
  { value: 'customer', label: 'Customer', hint: 'Find offers and follow takeaways' },
  { value: 'business_owner', label: 'Takeaway owner', hint: 'Claim your listing and post offers' },
  { value: 'supplier', label: 'Supplier', hint: 'Reach thousands of takeaways' },
];

function RegisterInner() {
  const { register } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    postcode: '',
    role: params.get('role') || 'customer',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function redirectFor(user: User) {
    const next = params.get('next');
    if (next) router.push(next);
    else if (user.role === 'business_owner') router.push('/claim-your-business');
    else if (user.role === 'supplier') router.push('/dashboard');
    else router.push('/');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      redirectFor(await register(form));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-5 py-16">
      <h1 className="font-display text-3xl font-extrabold tracking-tight mb-2">Create your account</h1>
      <p className="text-muted font-semibold mb-8">Free for customers, free listings for businesses.</p>
      <form onSubmit={submit} className="bg-card rounded-3xl p-7 flex flex-col gap-4">
        {error && (
          <div className="bg-peach-2/40 border border-primary/30 text-primary-dark text-sm font-bold rounded-xl px-4 py-3">
            {error}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-extrabold">I am a…</span>
          {ROLES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setForm({ ...form, role: r.value })}
              className={`text-left border rounded-xl px-4 py-3 transition-colors cursor-pointer ${
                form.role === r.value ? 'border-primary bg-peach-2/30' : 'border-line bg-surface'
              }`}
            >
              <div className="font-extrabold text-[15px]">{r.label}</div>
              <div className="text-[13px] font-semibold text-muted">{r.hint}</div>
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-extrabold">Full name</span>
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="border border-line rounded-xl px-4 py-3 font-semibold outline-none focus:border-primary bg-surface"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-extrabold">Email</span>
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="border border-line rounded-xl px-4 py-3 font-semibold outline-none focus:border-primary bg-surface"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-extrabold">Password (8+ characters)</span>
          <input
            type="password"
            required
            minLength={8}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="border border-line rounded-xl px-4 py-3 font-semibold outline-none focus:border-primary bg-surface"
          />
        </label>
        {form.role === 'customer' && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-extrabold">Postcode (optional)</span>
            <input
              value={form.postcode}
              onChange={(e) => setForm({ ...form, postcode: e.target.value })}
              placeholder="M14 5TQ"
              className="border border-line rounded-xl px-4 py-3 font-semibold outline-none focus:border-primary bg-surface"
            />
          </label>
        )}
        <button
          type="submit"
          disabled={busy}
          className="bg-ink text-surface font-bold py-3.5 rounded-full hover:bg-primary transition-colors cursor-pointer disabled:opacity-60 mt-2"
        >
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <SocialLogin role={form.role} onSuccess={redirectFor} />
      </form>
      <p className="text-sm font-semibold text-muted mt-5 text-center">
        Already have an account?{' '}
        <Link href="/login" className="text-primary font-bold">
          Log in
        </Link>
      </p>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterInner />
    </Suspense>
  );
}
