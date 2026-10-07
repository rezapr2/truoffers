'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth, type LoginStep } from '@/lib/auth-context';
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
    marketingEmails: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [verifyUrl, setVerifyUrl] = useState<string | null | undefined>(undefined);

  function redirectFor(user: User) {
    const next = params.get('next');
    if (next && next.startsWith('/') && !next.startsWith('//')) router.push(next);
    else if (user.role === 'business_owner') router.push('/claim-your-business');
    else if (user.role === 'supplier') router.push('/dashboard');
    else router.push('/');
  }

  function afterSocial(step: LoginStep) {
    if (step.kind === 'session') redirectFor(step.user);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { devVerifyUrl } = await register(form);
      // Email-verified accounts can claim a business; show the next step before moving on.
      setVerifyUrl(devVerifyUrl ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  }

  if (verifyUrl !== undefined) {
    return (
      <div className="mx-auto max-w-md px-5 py-16">
        <div className="bg-card border border-line rounded-3xl p-8 text-center">
          <div className="text-5xl mb-4">📬</div>
          <h1 className="font-display text-2xl font-extrabold mb-2">Check your email</h1>
          <p className="text-muted mb-6">
            We sent a link to <strong className="text-ink">{form.email}</strong>. Confirm your address to claim a business and get offer alerts.
          </p>
          {verifyUrl && (
            <p className="text-[13px] bg-surface rounded-xl px-4 py-3 mb-6">
              Development: <a className="text-primary font-bold break-all" href={verifyUrl}>open the verification link</a>
            </p>
          )}
          <button
            className="btn-soft font-bold px-7 py-3 rounded-2xl cursor-pointer"
            onClick={() => redirectFor({ role: form.role } as User)}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-5 py-16">
      <h1 className="font-display text-3xl font-extrabold tracking-tight mb-2">Create your account</h1>
      <p className="text-muted font-semibold mb-8">Free for customers, free listings for businesses.</p>
      <form onSubmit={submit} className="bg-card border border-line rounded-3xl p-7 flex flex-col gap-4">
        {error && (
          <div className="bg-danger/10 border border-danger/25 text-danger-dark text-sm font-bold rounded-xl px-4 py-3">
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
        <label className="flex items-start gap-3 text-sm font-semibold text-ink-soft cursor-pointer">
          <input
            type="checkbox"
            checked={form.marketingEmails}
            onChange={(e) => setForm({ ...form, marketingEmails: e.target.checked })}
            className="mt-1 w-4 h-4 accent-primary"
          />
          <span>Email me offers and news from TruOffers. You can unsubscribe at any time.</span>
        </label>
        <button
          type="submit"
          disabled={busy}
          className="btn-soft font-bold py-3.5 rounded-2xl cursor-pointer disabled:opacity-60 mt-2"
        >
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <SocialLogin role={form.role} onSuccess={afterSocial} />
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
