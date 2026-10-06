'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, errorMessage } from '@/lib/api';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth-context';
import type { Business, Category } from '@/lib/types';
import ClaimWorkspace, { type ClaimView } from '@/components/ClaimWorkspace';
import VerifiedBadge from '@/components/VerifiedBadge';
import { Alert, btn, Card, Field, inputClass, Spinner, Toggle } from '@/components/ui';

type Step = 'search' | 'add' | 'claim';

interface Duplicate {
  _id: string;
  name: string;
  slug: string;
  town?: string;
  postcode: string;
  address?: string;
  verificationLevel: number;
  status: string;
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function EmailGate() {
  const [sent, setSent] = useState<{ devVerifyUrl?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-display text-xl font-extrabold">First, confirm your email</h2>
      <p className="text-sm text-ink-soft">We sent you a link when you signed up. Claims can only be made from a confirmed account.</p>
      {error && <Alert tone="danger">{error}</Alert>}
      {sent ? (
        <Alert tone="success">
          Sent — check your inbox.{' '}
          {sent.devVerifyUrl && (
            <a className="underline font-bold" href={sent.devVerifyUrl}>
              Development: open the link
            </a>
          )}
        </Alert>
      ) : (
        <button
          className={btn.primary}
          onClick={() =>
            api<{ devVerifyUrl?: string }>('/auth/email/resend', { method: 'POST' })
              .then(setSent)
              .catch((err) => setError(errorMessage(err)))
          }
        >
          Send the link again
        </button>
      )}
    </Card>
  );
}

function AddBusiness({ categories, onClaim, onBack }: { categories: Category[]; onClaim: (claim: ClaimView) => void; onBack: () => void }) {
  const [form, setForm] = useState({ name: '', postcode: '', town: '', address: '', phone: '', website: '', orderUrl: '', description: '', categories: [] as string[], delivery: true, collection: true });
  const [hours, setHours] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<Duplicate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const set = (key: keyof typeof form, value: unknown) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(confirmNotDuplicate = false) {
    setBusy(true);
    setError(null);
    try {
      const openingHours = Object.fromEntries(Object.entries(hours).filter(([, v]) => v.trim()));
      const claim = await api<ClaimView>('/claims/new-business', {
        method: 'POST',
        body: JSON.stringify({
          business: {
            ...form,
            town: form.town || undefined,
            address: form.address || undefined,
            website: form.website || undefined,
            orderUrl: form.orderUrl || undefined,
            description: form.description || undefined,
            openingHours: Object.keys(openingHours).length ? openingHours : undefined,
          },
          confirmNotDuplicate,
        }),
      });
      track('claim_start', { businessId: claim.business._id, metadata: { kind: 'new' } });
      onClaim(claim);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'possible_duplicates') setDuplicates(err.data.duplicates as Duplicate[]);
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (duplicates) {
    return (
      <Card className="flex flex-col gap-4">
        <h2 className="font-display text-xl font-extrabold">Is it one of these?</h2>
        <p className="text-sm text-muted">We found takeaways with the same phone number or a similar name at {form.postcode}. Claim yours instead of adding it twice.</p>
        {duplicates.map((d) => (
          <div key={d._id} className="flex items-center gap-4 border border-line rounded-2xl p-4">
            <div className="flex-1 min-w-0">
              <div className="font-extrabold">{d.name}</div>
              <div className="text-[13px] text-muted">{[d.address, d.town, d.postcode].filter(Boolean).join(', ')}</div>
            </div>
            {d.status === 'active' ? (
              <button className={btn.small} onClick={() => router.push(`/claim-your-business?business=${d._id}`)}>
                Claim this one
              </button>
            ) : (
              <span className="text-[12px] text-muted">Being added by someone else</span>
            )}
          </div>
        ))}
        <div className="flex gap-3 flex-wrap">
          <button className={btn.primary} disabled={busy} onClick={() => submit(true)}>
            {busy ? 'Adding…' : 'None of these — add mine'}
          </button>
          <button className={btn.secondary} onClick={() => setDuplicates(null)}>
            Back to the form
          </button>
        </div>
      </Card>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="bg-card border border-line rounded-3xl p-7 flex flex-col gap-4"
    >
      <h2 className="font-display text-xl font-extrabold">Add your business</h2>
      <p className="text-sm text-muted -mt-2">It stays hidden until we’ve verified it. We’ll text or call the shop number to check it’s yours.</p>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Business name" required>
        <input required minLength={2} value={form.name} onChange={(e) => set('name', e.target.value)} className={inputClass} />
      </Field>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Postcode" required>
          <input required value={form.postcode} onChange={(e) => set('postcode', e.target.value.toUpperCase())} placeholder="M14 5TQ" className={inputClass} />
        </Field>
        <Field label="Town or city">
          <input value={form.town} onChange={(e) => set('town', e.target.value)} className={inputClass} />
        </Field>
      </div>
      <Field label="Address">
        <input value={form.address} onChange={(e) => set('address', e.target.value)} className={inputClass} />
      </Field>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Shop phone number" required hint="We send the verification code to this number.">
          <input required type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="0161 224 0102" className={inputClass} />
        </Field>
        <Field label="Website">
          <input value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" className={inputClass} />
        </Field>
      </div>
      <Field label="Online ordering link" hint="Your own site, Foodbell, or another ordering provider.">
        <input value={form.orderUrl} onChange={(e) => set('orderUrl', e.target.value)} placeholder="https://" className={inputClass} />
      </Field>
      <Field label="Cuisines" hint="Pick up to 3.">
        <div className="flex gap-2 flex-wrap">
          {categories.map((c) => {
            const on = form.categories.includes(c._id);
            return (
              <button
                type="button"
                key={c._id}
                aria-pressed={on}
                onClick={() => set('categories', on ? form.categories.filter((x) => x !== c._id) : form.categories.length < 3 ? [...form.categories, c._id] : form.categories)}
                className={`text-sm font-bold px-3 py-1.5 rounded-full border cursor-pointer ${on ? 'bg-primary text-white border-primary' : 'border-line hover:border-primary'}`}
              >
                {c.emoji} {c.name}
              </button>
            );
          })}
        </div>
      </Field>
      <div className="flex gap-6 flex-wrap">
        <Toggle checked={form.delivery} onChange={(v) => set('delivery', v)} label="Delivery" />
        <Toggle checked={form.collection} onChange={(v) => set('collection', v)} label="Collection" />
      </div>
      <details className="bg-surface rounded-2xl px-4 py-3">
        <summary className="font-bold text-sm cursor-pointer">Opening hours (optional)</summary>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          {DAYS.map((d) => (
            <Field key={d} label={<span className="capitalize">{d}</span>}>
              <input value={hours[d] ?? ''} onChange={(e) => setHours({ ...hours, [d]: e.target.value })} placeholder="17:00–23:00 or Closed" className={inputClass} />
            </Field>
          ))}
        </div>
      </details>
      <Field label="Short description">
        <textarea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} className={`${inputClass} resize-none`} />
      </Field>
      <div className="flex gap-3">
        <button type="button" onClick={onBack} className={btn.secondary}>
          Back
        </button>
        <button type="submit" disabled={busy} className={`${btn.primary} flex-1`}>
          {busy ? 'Adding…' : 'Add and verify'}
        </button>
      </div>
    </form>
  );
}

function ClaimInner() {
  const { user, loading, refresh } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<Step>('search');
  const [query, setQuery] = useState(params.get('name') || '');
  const [results, setResults] = useState<Business[] | null>(null);
  const [claim, setClaim] = useState<ClaimView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [invited, setInvited] = useState<{ business: Business; expiresAt: string } | null>(null);
  const [inviteExpired, setInviteExpired] = useState(false);
  const [confirmDispute, setConfirmDispute] = useState<Business | null>(null);
  const invite = params.get('invite');
  const presetBusiness = params.get('business');
  const resumeClaim = params.get('claim');

  useEffect(() => {
    if (!loading && !user) {
      const here = `/claim-your-business${typeof window !== 'undefined' ? window.location.search : ''}`;
      router.push(`/register?role=business_owner&next=${encodeURIComponent(here)}`);
    }
  }, [loading, user, router]);

  useEffect(() => {
    void api<Category[]>('/categories').then(setCategories).catch(() => {});
  }, []);

  const startClaim = useCallback(async (businessId: string) => {
    setBusy(true);
    setError(null);
    try {
      const created = await api<ClaimView>('/claims', { method: 'POST', body: JSON.stringify({ businessId }) });
      track('claim_start', { businessId });
      await refresh();
      setClaim(created);
      setStep('claim');
    } catch (err) {
      // An open claim on this listing: carry on with it.
      if (err instanceof ApiError && typeof err.data.claimId === 'string') {
        setClaim(await api<ClaimView>(`/claims/${err.data.claimId}`));
        setStep('claim');
      } else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  // Deep links: an invitation from the import robot, a listing's "Claim this business" button, or resuming a claim.
  useEffect(() => {
    if (!user?.emailVerified) return;
    if (resumeClaim) {
      void api<ClaimView>(`/claims/${resumeClaim}`).then((c) => {
        setClaim(c);
        setStep('claim');
      }).catch((err) => setError(errorMessage(err)));
    } else if (invite) {
      void api<{ business: Business; expiresAt: string }>(`/claim-invitations/${encodeURIComponent(invite)}`)
        .then((result) => setInvited(result))
        .catch(() => setInviteExpired(true));
    } else if (presetBusiness) {
      void api<{ items: Business[] }>(`/businesses?q=${encodeURIComponent(params.get('name') ?? '')}`)
        .then((r) => setResults(r.items))
        .catch(() => {});
    }
  }, [user?.emailVerified, resumeClaim, invite, presetBusiness, params]);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ items: Business[] }>(`/businesses?q=${encodeURIComponent(query.trim())}&limit=20`);
      setResults(res.items);
    } catch (err) {
      setError(errorMessage(err, 'Search failed'));
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) return <Spinner />;

  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <h1 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight mb-2">Claim your business</h1>
      <p className="text-muted font-semibold mb-8">Free to claim. Verified takeaways get the ✓ badge, live offers, plans and promotions.</p>

      {error && <Alert tone="danger" className="mb-5">{error}</Alert>}

      {!user.emailVerified ? (
        <EmailGate />
      ) : step === 'claim' && claim ? (
        <>
          <ClaimWorkspace claim={claim} onChange={setClaim} />
          {claim.status === 'pending' && (
            <div className="mt-6 flex justify-center">
              <Link href="/dashboard" className={btn.primary}>
                Go to your dashboard
              </Link>
            </div>
          )}
        </>
      ) : step === 'add' ? (
        <AddBusiness
          categories={categories}
          onBack={() => setStep('search')}
          onClaim={async (c) => {
            await refresh();
            setClaim(c);
            setStep('claim');
          }}
        />
      ) : (
        <>
          {invited && (
            <Card className="mb-5 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1">
                <p className="font-bold">We listed offers we found on {invited.business.name}’s website.</p>
                <p className="text-[13px] text-muted mt-1">Claim the page to verify them, correct the details and see your clicks. This link works until {new Date(invited.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.</p>
              </div>
              <button className={btn.primary} disabled={busy} onClick={() => startClaim(invited.business._id)}>
                Claim {invited.business.name}
              </button>
            </Card>
          )}
          {inviteExpired && <Alert tone="warning" className="mb-5">That invitation link has expired or was already used. Search for your business below.</Alert>}

          <form onSubmit={search} className="flex gap-2 bg-card border border-line rounded-full p-1.5 pl-5 items-center mb-5 field-shell">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Business name or postcode…" className="flex-1 min-w-0 border-none outline-none font-bold bg-transparent field-bare" />
            <button type="submit" disabled={busy} className="btn-soft text-sm font-bold px-6 py-3 rounded-full cursor-pointer disabled:opacity-60">
              Search
            </button>
          </form>

          {results && (
            <div className="flex flex-col gap-3 mb-8">
              {results.length === 0 && <p className="text-sm text-muted">No listings match. Add yours below.</p>}
              {results.map((b) => {
                const level = b.verificationLevel ?? 0;
                return (
                  <div key={b._id} className={`bg-card border rounded-2xl p-5 flex items-center gap-4 ${b._id === presetBusiness ? 'border-primary' : 'border-line'}`}>
                    <div className="w-12 h-12 flex-none rounded-full bg-sun-soft flex items-center justify-center font-display font-extrabold text-lg text-brand-deep">{b.name.charAt(0)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-extrabold">{b.name}</div>
                      <div className="text-[13px] text-muted">
                        {[b.address, b.town, b.postcode].filter(Boolean).join(', ')}
                      </div>
                      <VerifiedBadge level={level} className="text-[12px]" />
                    </div>
                    {level === 0 ? (
                      <button className={btn.primary} disabled={busy} onClick={() => startClaim(b._id)}>
                        Claim
                      </button>
                    ) : level === 1 ? (
                      <span className="text-[12.5px] font-bold text-[#7a5408] bg-sun-soft/70 px-2.5 py-1 rounded-full whitespace-nowrap">Claim in review</span>
                    ) : (
                      <button className={btn.small} onClick={() => setConfirmDispute(b)}>
                        This is mine
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {confirmDispute && (
            <Alert
              tone="warning"
              className="mb-6"
              title={`${confirmDispute.name} is already verified`}
              action={
                <div className="flex gap-2">
                  <button className={btn.small} disabled={busy} onClick={() => startClaim(confirmDispute._id)}>
                    Claim anyway
                  </button>
                  <button className={btn.small} onClick={() => setConfirmDispute(null)}>
                    Cancel
                  </button>
                </div>
              }
            >
              If you prove access to its phone line, our team reviews who runs it and both owners are told. Changes to the listing pause meanwhile.
            </Alert>
          )}

          <Card className="text-center">
            <div className="font-extrabold mb-1">Can’t find your takeaway?</div>
            <div className="text-sm text-muted mb-4">Add it to TruOffers in two minutes, free.</div>
            <button onClick={() => setStep('add')} className={btn.primary}>
              Add your business
            </button>
          </Card>
        </>
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
