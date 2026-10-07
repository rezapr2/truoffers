'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { track } from '@/lib/analytics';
import { useBusiness } from '@/lib/business-context';
import { useApi } from '@/lib/hooks';
import { date, money } from '@/lib/format';
import type { Payment, Plan, Subscription } from '@/lib/types';
import { Alert, btn, Card, Field, inputClass, SectionTitle, Spinner, StatusPill } from '@/components/ui';
import { CheckIcon } from '@/components/icons';
import { DashboardPage, OwnerOnly } from '../_components/shared';

interface Overview {
  canBuy: boolean;
  plan: { key: string; name: string };
  subscription: Subscription | null;
  plans: Plan[];
  payments: Payment[];
  stripeEnabled: boolean;
  business: { hasStripeCustomer: boolean };
}

interface CouponPreview {
  code: string;
  description?: string;
  percentOff?: number;
  amountOff?: number;
  duration: string;
  durationInMonths?: number;
  firstPayment: { amount: number; vat: number; total: number };
}

function BillingInner() {
  const { business, reload: reloadBusiness } = useBusiness();
  const params = useSearchParams();
  const { data, reload } = useApi<Overview>(business ? `/businesses/${business._id}/billing` : null);
  const [interval, setInterval_] = useState<'monthly' | 'annual'>('monthly');
  const [coupon, setCoupon] = useState('');
  const [preview, setPreview] = useState<CouponPreview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(params.get('checkout') === 'success' ? 'Payment received. Your plan switches on as soon as Stripe confirms it, usually within a minute.' : null);

  if (!business || !data) return <Spinner />;
  const sub = data.subscription;
  const currentKey = data.plan.key;
  const vatNote = data.plans[0]?.pricesIncludeVat ? 'inc. VAT' : `+ VAT (${data.plans[0]?.vatRatePercent ?? 20}%)`;

  async function act(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = (await fn()) as { mode?: string; url?: string; effective?: string } | undefined;
      if (res?.url) {
        window.location.assign(res.url);
        return;
      }
      if (done) setNotice(done);
      await reload();
      await reloadBusiness();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function choose(plan: Plan) {
    track('upgrade_click', { businessId: business!._id, metadata: { from: currentKey, to: plan.key, interval } });
    const paid = !!sub && sub.price > 0 && !sub.comp;
    if (plan.monthlyPrice === 0) {
      if (!sub) return;
      if (!confirm('Move to the Free plan at the end of this billing period?')) return;
      return act('free', () => api(`/businesses/${business!._id}/billing/cancel`, { method: 'POST' }), `You’ll move to Free on ${date(sub.currentPeriodEnd)}.`);
    }
    if (paid) {
      return act(plan.key, () => api(`/businesses/${business!._id}/billing/change`, { method: 'POST', body: JSON.stringify({ planKey: plan.key, interval }) }), `Your plan change to ${plan.name} is saved.`);
    }
    return act(plan.key, () =>
      api(`/businesses/${business!._id}/billing/checkout`, { method: 'POST', body: JSON.stringify({ planKey: plan.key, interval, couponCode: preview?.code }) }).then((res) => {
        track('subscription_start', { businessId: business!._id, metadata: { plan: plan.key, interval } });
        return res;
      }),
      `You’re on ${plan.name}. (Demo checkout: card payments switch on when Stripe is configured.)`,
    );
  }

  return (
    <DashboardPage title="Plan and billing" subtitle="Plans and promotions switch on as soon as payment is confirmed.">
        <div className="flex flex-col gap-6">
          {error && <Alert tone="danger">{error}</Alert>}
          {notice && <Alert tone="success">{notice}</Alert>}
          {!data.canBuy && <Alert tone="warning" title="Verify your business to choose a plan" action={<Link className={btn.small} href="/dashboard/verification">Verification</Link>}>Plans and promotions are for verified takeaways.</Alert>}

          <Card className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <div className="text-[12px] font-extrabold uppercase tracking-wide text-muted">Current plan</div>
              <div className="font-display text-2xl font-extrabold">{data.plan.name}</div>
              {sub ? (
                <div className="text-sm text-muted mt-1 flex flex-wrap gap-2 items-center">
                  <StatusPill status={sub.status} />
                  {sub.comp ? <span>Complimentary{sub.compNote ? ` — ${sub.compNote}` : ''}</span> : <span>{money(sub.price)} {sub.interval === 'annual' ? 'a year' : 'a month'} {vatNote}</span>}
                  {sub.currentPeriodEnd && <span>· {sub.cancelAtPeriodEnd ? 'ends' : 'renews'} {date(sub.currentPeriodEnd)}</span>}
                </div>
              ) : (
                <div className="text-sm text-muted mt-1">Free forever. Upgrade for unlimited offers and instant publishing.</div>
              )}
              {sub?.pendingPlanKey && <div className="text-sm font-bold text-[#7a5408] mt-2">Moving to {data.plans.find((p) => p.key === sub.pendingPlanKey)?.name ?? sub.pendingPlanKey} on {date(sub.currentPeriodEnd)}.</div>}
              {sub?.status === 'past_due' && <div className="text-sm font-bold text-danger mt-2">Your last payment failed. Update your card to keep your plan.</div>}
            </div>
            <div className="flex gap-2 flex-wrap">
              {(sub?.cancelAtPeriodEnd || sub?.pendingPlanKey) && (
                <button className={btn.secondary} disabled={!!busy} onClick={() => act('resume', () => api(`/businesses/${business._id}/billing/resume`, { method: 'POST' }), 'Your current plan will carry on.')}>
                  Keep my plan
                </button>
              )}
              {data.stripeEnabled && data.business.hasStripeCustomer && (
                <button className={btn.secondary} disabled={!!busy} onClick={() => act('portal', () => api(`/businesses/${business._id}/billing/portal`, { method: 'POST' }))}>
                  Update card
                </button>
              )}
              {sub && !sub.cancelAtPeriodEnd && !sub.comp && sub.price > 0 && (
                <button className={btn.danger} disabled={!!busy} onClick={() => confirm('Cancel your plan at the end of this billing period?') && act('cancel', () => api(`/businesses/${business._id}/billing/cancel`, { method: 'POST' }), 'Your plan ends at the end of this billing period.')}>
                  Cancel plan
                </button>
              )}
            </div>
          </Card>

          <div className="flex items-center gap-3 flex-wrap">
            <SectionTitle className="flex-1 mb-0">Plans</SectionTitle>
            <div className="flex bg-card border border-line rounded-full p-1">
              {(['monthly', 'annual'] as const).map((i) => (
                <button key={i} onClick={() => setInterval_(i)} className={`text-[13px] font-bold px-4 py-2 rounded-full cursor-pointer transition-colors ${interval === i ? 'bg-tint-blue text-primary' : 'text-muted'}`}>
                  {i === 'monthly' ? 'Monthly' : 'Yearly (2 months free)'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {data.plans.map((plan) => {
              const isCurrent = plan.key === currentKey && (!sub || sub.interval === interval || plan.monthlyPrice === 0);
              const price = interval === 'annual' ? plan.annualPrice : plan.monthlyPrice;
              return (
                <div key={plan._id} className={`bg-card border rounded-3xl p-6 flex flex-col ${isCurrent ? 'border-primary ring-2 ring-primary/30' : 'border-line'}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-display text-lg font-extrabold">{plan.name}</h3>
                    {plan.badgeText && <span className="text-[11px] font-extrabold uppercase bg-sun text-[#43310A] px-2.5 py-1 rounded-full">{plan.badgeText}</span>}
                  </div>
                  <div className="font-display text-3xl font-extrabold mt-2">
                    {money(price, { pence: false })}
                    <span className="text-sm font-sans text-muted font-bold">/{interval === 'annual' ? 'yr' : 'mo'}</span>
                  </div>
                  {price > 0 && <div className="text-[12px] text-muted">{vatNote}</div>}
                  <div className="text-[13px] font-bold text-muted mb-4 mt-1">{plan.bestFor}</div>
                  <ul className="text-[13px] text-ink-soft space-y-1.5 mb-6">
                    {plan.features.map((f) => (
                      <li key={f} className="flex gap-2">
                        <CheckIcon className="w-4 h-4 text-verified flex-none mt-0.5" /> {f}
                      </li>
                    ))}
                  </ul>
                  <button onClick={() => choose(plan)} disabled={isCurrent || !!busy || (!data.canBuy && plan.monthlyPrice > 0)} className={`mt-auto ${isCurrent ? 'bg-page text-muted font-bold py-3 rounded-2xl' : btn.primary}`}>
                    {busy === plan.key ? 'Working…' : isCurrent ? 'Your plan' : plan.monthlyPrice === 0 ? 'Move to Free' : currentKey !== 'free' ? `Switch to ${plan.name}` : `Choose ${plan.name}`}
                  </button>
                </div>
              );
            })}
          </div>

          {(!sub || sub.price === 0 || sub.comp) && data.canBuy && (
            <Card className="flex flex-col sm:flex-row sm:items-end gap-3">
              <Field label="Discount code" className="flex-1 max-w-xs">
                <input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} className={inputClass} />
              </Field>
              <button
                className={btn.secondary}
                disabled={!coupon || !!busy}
                onClick={async () => {
                  setError(null);
                  try {
                    setPreview(await api<CouponPreview>('/billing/coupons/preview', { method: 'POST', body: JSON.stringify({ code: coupon, planKey: 'standard', interval }) }));
                  } catch (err) {
                    setPreview(null);
                    setError(errorMessage(err));
                  }
                }}
              >
                Apply
              </button>
              {preview && (
                <p className="text-sm font-bold text-verified">
                  {preview.code}: {preview.percentOff ? `${preview.percentOff}% off` : `£${preview.amountOff} off`}
                  {preview.duration === 'repeating' ? ` for ${preview.durationInMonths} months` : preview.duration === 'forever' ? ' every payment' : ' your first payment'}. It applies when you choose a plan.
                </p>
              )}
            </Card>
          )}

          <section>
            <SectionTitle>Invoices</SectionTitle>
            {data.payments.length === 0 ? (
              <p className="text-sm text-muted">No invoices yet.</p>
            ) : (
              <div className="border border-line rounded-3xl overflow-hidden">
                {data.payments.map((p) => (
                  <div key={p._id} className="flex items-center gap-4 px-5 py-3 border-t border-line first:border-t-0 text-sm flex-wrap">
                    <span className="w-28 text-muted">{date(p.paidAt ?? p.createdAt)}</span>
                    <span className="flex-1 min-w-0 font-bold truncate">{p.description}</span>
                    <span className="font-bold">{money(p.total)}</span>
                    <StatusPill status={p.status} />
                    {p.pdfUrl ? (
                      <a className={btn.link} href={p.pdfUrl} target="_blank" rel="noopener noreferrer">
                        PDF
                      </a>
                    ) : (
                      <Link className={btn.link} href={`/dashboard/billing/invoices/${p._id}`}>
                        View
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
    </DashboardPage>
  );
}

export default function BillingPage() {
  // Staff never load the owner-only billing data; they see why instead.
  return (
    <OwnerOnly pageTitle="Plan and billing">
      <Suspense fallback={<Spinner />}>
        <BillingInner />
      </Suspense>
    </OwnerOnly>
  );
}
