'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth-context';
import type { Business, Category } from '@/lib/types';
import VerifiedBadge from '@/components/VerifiedBadge';

type Step = 'search' | 'method' | 'otp' | 'done' | 'add';

function ClaimInner() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();

  const [step, setStep] = useState<Step>('search');
  const [query, setQuery] = useState(params.get('name') || '');
  const [results, setResults] = useState<Business[]>([]);
  const [selected, setSelected] = useState<Business | null>(null);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingReview, setPendingReview] = useState(false);

  // Add-business form
  const [categories, setCategories] = useState<Category[]>([]);
  const [addForm, setAddForm] = useState({
    name: '',
    postcode: '',
    town: '',
    address: '',
    phone: '',
    categoryId: '',
    description: '',
    orderUrl: '',
  });

  useEffect(() => {
    if (!loading && !user) {
      router.push(`/login?next=${encodeURIComponent('/claim-your-business')}`);
    }
  }, [loading, user, router]);

  useEffect(() => {
    void api<Category[]>('/categories').then(setCategories).catch(() => {});
  }, []);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ items: Business[] }>(`/businesses?q=${encodeURIComponent(query.trim())}`);
      setResults(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setBusy(false);
    }
  }

  async function startClaim(method: string) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      track('claim_start', { businessId: selected._id, metadata: { method } });
      const res = await api<{ claimId: string; devOtp?: string }>(
        `/businesses/${selected._id}/claim`,
        { method: 'POST', body: JSON.stringify({ method }) },
      );
      setClaimId(res.claimId);
      if (method === 'phone_otp') {
        setDevOtp(res.devOtp || null);
        setStep('otp');
      } else {
        setPendingReview(true);
        setStep('done');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start claim');
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!claimId) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/businesses/claims/${claimId}/verify-otp`, {
        method: 'POST',
        body: JSON.stringify({ otp }),
      });
      track('claim_complete', { businessId: selected?._id, metadata: { method: 'phone_otp' } });
      setPendingReview(false);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  }

  async function addBusiness(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<Business>('/businesses', {
        method: 'POST',
        body: JSON.stringify({
          name: addForm.name,
          postcode: addForm.postcode,
          town: addForm.town || undefined,
          address: addForm.address || undefined,
          phone: addForm.phone || undefined,
          description: addForm.description || undefined,
          orderUrl: addForm.orderUrl || undefined,
          categories: addForm.categoryId ? [addForm.categoryId] : [],
        }),
      });
      setSelected(created);
      setPendingReview(false);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add business');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) return <div className="py-24 text-center text-muted font-bold">Loading…</div>;

  const canClaim = user.role === 'business_owner' || user.role === 'customer';

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight mb-2">
        Claim your business
      </h1>
      <p className="text-muted font-semibold mb-8">
        Free listing, free claim. Verified businesses rank higher and unlock offer tools.
      </p>

      {error && (
        <div className="bg-peach-2/40 border border-primary/30 text-primary-dark text-sm font-bold rounded-xl px-4 py-3 mb-5">
          {error}
        </div>
      )}

      {step === 'search' && (
        <>
          <form onSubmit={search} className="flex gap-2 bg-card border border-line rounded-full p-1.5 pl-5 items-center mb-5">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your business name…"
              className="flex-1 min-w-0 border-none outline-none font-bold bg-transparent"
            />
            <button
              type="submit"
              disabled={busy}
              className="bg-ink text-cream text-sm font-bold px-6 py-3 rounded-full cursor-pointer hover:bg-primary transition-colors disabled:opacity-60"
            >
              Search
            </button>
          </form>
          <div className="flex flex-col gap-3 mb-8">
            {results.map((b) => (
              <button
                key={b._id}
                onClick={() => {
                  if (b.verificationStatus === 'unclaimed') {
                    setSelected(b);
                    setStep('method');
                  }
                }}
                disabled={b.verificationStatus !== 'unclaimed'}
                className={`bg-card rounded-2xl p-5 text-left flex items-center gap-4 transition-shadow ${
                  b.verificationStatus === 'unclaimed'
                    ? 'hover:shadow-lg cursor-pointer'
                    : 'opacity-60'
                }`}
              >
                <div className="w-12 h-12 flex-none rounded-full bg-page flex items-center justify-center font-display font-extrabold text-lg text-primary">
                  {b.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-extrabold">{b.name}</div>
                  <div className="text-[13px] font-semibold text-muted">
                    {b.town} {b.postcode}
                  </div>
                </div>
                {b.verificationStatus === 'unclaimed' ? (
                  <span className="text-primary text-sm font-bold whitespace-nowrap">Claim →</span>
                ) : (
                  <VerifiedBadge status={b.verificationStatus} className="text-[13px]" />
                )}
              </button>
            ))}
          </div>
          {canClaim && (
            <div className="bg-card rounded-2xl p-6 text-center">
              <div className="font-extrabold mb-1">Can&apos;t find your takeaway?</div>
              <div className="text-sm font-semibold text-muted mb-4">
                Add it to TruOffers in two minutes — free.
              </div>
              <button
                onClick={() => setStep('add')}
                className="bg-primary text-cream font-bold px-7 py-3 rounded-full hover:bg-primary-dark transition-colors cursor-pointer"
              >
                Add your business
              </button>
            </div>
          )}
        </>
      )}

      {step === 'method' && selected && (
        <div className="bg-card rounded-3xl p-7">
          <h2 className="font-display text-xl font-extrabold mb-1">Verify you own {selected.name}</h2>
          <p className="text-sm font-semibold text-muted mb-6">
            Choose a verification method (blueprint-approved options).
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => startClaim('phone_otp')}
              disabled={busy}
              className="border border-line rounded-2xl p-5 text-left hover:border-primary transition-colors cursor-pointer"
            >
              <div className="font-extrabold">📱 Phone verification (instant)</div>
              <div className="text-sm font-semibold text-muted">
                We send a one-time code to the business phone number on file.
              </div>
            </button>
            <button
              onClick={() => startClaim('document_upload')}
              disabled={busy}
              className="border border-line rounded-2xl p-5 text-left hover:border-primary transition-colors cursor-pointer"
            >
              <div className="font-extrabold">📄 Document review (1–2 days)</div>
              <div className="text-sm font-semibold text-muted">
                Our team reviews your proof of ownership manually.
              </div>
            </button>
            <button
              onClick={() => startClaim('foodbell_auto')}
              disabled={busy}
              className="border border-line rounded-2xl p-5 text-left hover:border-primary transition-colors cursor-pointer"
            >
              <div className="font-extrabold">🔔 I&apos;m a Foodbell client (instant)</div>
              <div className="text-sm font-semibold text-muted">
                Foodbell clients are verified automatically.
              </div>
            </button>
          </div>
        </div>
      )}

      {step === 'otp' && (
        <form onSubmit={verifyOtp} className="bg-card rounded-3xl p-7">
          <h2 className="font-display text-xl font-extrabold mb-1">Enter the 6-digit code</h2>
          <p className="text-sm font-semibold text-muted mb-5">
            We called/texted the business number ending in{' '}
            {selected?.phone ? `…${selected.phone.slice(-3)}` : '…'}
          </p>
          {devOtp && (
            <div className="bg-surface border border-line rounded-xl px-4 py-3 text-sm font-bold mb-5">
              Dev mode — your code is: <span className="text-primary font-display text-lg">{devOtp}</span>
            </div>
          )}
          <input
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            maxLength={6}
            inputMode="numeric"
            placeholder="000000"
            className="border border-line rounded-xl px-4 py-3 font-display font-extrabold text-2xl tracking-[0.4em] w-full text-center outline-none focus:border-primary bg-surface mb-5"
          />
          <button
            type="submit"
            disabled={busy || otp.length !== 6}
            className="w-full bg-ink text-surface font-bold py-3.5 rounded-full hover:bg-primary transition-colors cursor-pointer disabled:opacity-60"
          >
            Verify
          </button>
        </form>
      )}

      {step === 'done' && (
        <div className="bg-card rounded-3xl p-10 text-center">
          <div className="text-5xl mb-4">{pendingReview ? '🕓' : '🎉'}</div>
          <h2 className="font-display text-2xl font-extrabold mb-2">
            {pendingReview ? 'Claim submitted' : 'You’re verified!'}
          </h2>
          <p className="text-muted font-semibold mb-7">
            {pendingReview
              ? 'Our team will review your claim within 1–2 working days. You’ll get dashboard access once approved.'
              : `${selected?.name ?? 'Your business'} is now yours to manage — post offers, update your menu and watch your analytics.`}
          </p>
          <Link
            href="/dashboard"
            className="bg-primary text-cream font-bold px-8 py-3.5 rounded-full hover:bg-primary-dark transition-colors"
          >
            Go to dashboard
          </Link>
        </div>
      )}

      {step === 'add' && (
        <form onSubmit={addBusiness} className="bg-card rounded-3xl p-7 flex flex-col gap-4">
          <h2 className="font-display text-xl font-extrabold">Add your business</h2>
          {user.role !== 'business_owner' && (
            <div className="bg-surface border border-line rounded-xl px-4 py-3 text-sm font-bold">
              Note: your account is a customer account. Adding a business is available for takeaway
              owner accounts —{' '}
              <Link href="/register?role=business_owner" className="text-primary">
                create one here
              </Link>
              .
            </div>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-extrabold">Business name *</span>
            <input
              required
              value={addForm.name}
              onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
              className="border border-line rounded-xl px-4 py-3 font-semibold outline-none focus:border-primary bg-surface"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-extrabold">Postcode *</span>
              <input
                required
                value={addForm.postcode}
                onChange={(e) => setAddForm({ ...addForm, postcode: e.target.value })}
                placeholder="M14 5TQ"
                className="border border-line rounded-xl px-4 py-3 font-semibold outline-none focus:border-primary bg-surface"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-extrabold">Town</span>
              <input
                value={addForm.town}
                onChange={(e) => setAddForm({ ...addForm, town: e.target.value })}
                className="border border-line rounded-xl px-4 py-3 font-semibold outline-none focus:border-primary bg-surface"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-extrabold">Address</span>
            <input
              value={addForm.address}
              onChange={(e) => setAddForm({ ...addForm, address: e.target.value })}
              className="border border-line rounded-xl px-4 py-3 font-semibold outline-none focus:border-primary bg-surface"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-extrabold">Phone</span>
              <input
                value={addForm.phone}
                onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })}
                className="border border-line rounded-xl px-4 py-3 font-semibold outline-none focus:border-primary bg-surface"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-extrabold">Cuisine</span>
              <select
                value={addForm.categoryId}
                onChange={(e) => setAddForm({ ...addForm, categoryId: e.target.value })}
                className="border border-line rounded-xl px-4 py-3 font-semibold outline-none focus:border-primary bg-surface"
              >
                <option value="">Select…</option>
                {categories.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-extrabold">Online ordering link (Foodbell or your site)</span>
            <input
              value={addForm.orderUrl}
              onChange={(e) => setAddForm({ ...addForm, orderUrl: e.target.value })}
              placeholder="https://…"
              className="border border-line rounded-xl px-4 py-3 font-semibold outline-none focus:border-primary bg-surface"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-extrabold">Short description</span>
            <textarea
              rows={3}
              value={addForm.description}
              onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
              className="border border-line rounded-xl px-4 py-3 font-semibold outline-none focus:border-primary bg-surface resize-none"
            />
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep('search')}
              className="border-[1.5px] border-ink font-bold px-6 py-3 rounded-full cursor-pointer"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={busy || user.role !== 'business_owner'}
              className="flex-1 bg-ink text-surface font-bold py-3 rounded-full hover:bg-primary transition-colors cursor-pointer disabled:opacity-60"
            >
              {busy ? 'Adding…' : 'Add business'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function ClaimPage() {
  return (
    <Suspense>
      <ClaimInner />
    </Suspense>
  );
}
