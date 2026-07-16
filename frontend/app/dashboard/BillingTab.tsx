'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { track } from '@/lib/analytics';
import type { Business, Plan } from '@/lib/types';

interface Subscription {
  _id: string;
  planKey: string;
  interval: string;
  price: number;
  status: string;
  currentPeriodEnd?: string;
  businessId?: { _id: string; name: string } | string;
}

export default function BillingTab({ business }: { business: Business }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [interval, setInterval_] = useState<'monthly' | 'annual'>('monthly');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    void api<Plan[]>('/billing/plans').then((all) =>
      setPlans(all.filter((p) => p.audience === 'takeaway')),
    );
    void api<Subscription[]>('/billing/subscriptions/mine').then(setSubs).catch(() => {});
  }, []);

  useEffect(load, [load]);

  const activeSub = subs.find(
    (s) =>
      s.status === 'active' &&
      (typeof s.businessId === 'object' ? s.businessId?._id : s.businessId) === business._id,
  );
  const currentPlanKey = activeSub?.planKey || 'free';

  async function choose(plan: Plan) {
    if (plan.key === currentPlanKey) return;
    setBusy(plan.key);
    setMessage(null);
    track('upgrade_click', { businessId: business._id, metadata: { from: currentPlanKey, to: plan.key } });
    try {
      if (plan.monthlyPrice === 0) {
        if (activeSub) {
          await api('/billing/cancel', {
            method: 'POST',
            body: JSON.stringify({ subscriptionId: activeSub._id }),
          });
        }
        setMessage('Moved to the Free plan.');
      } else {
        const res = await api<{ mode: string; url?: string }>('/billing/checkout', {
          method: 'POST',
          body: JSON.stringify({ planKey: plan.key, interval, businessId: business._id }),
        });
        if (res.mode === 'stripe' && res.url) {
          // Real checkout: pay on Stripe; the webhook activates the plan
          window.location.href = res.url;
          return;
        }
        track('subscription_start', { businessId: business._id, metadata: { plan: plan.key, interval } });
        setMessage(`You're now on ${plan.name}. (Demo checkout — Stripe activates in production.)`);
      }
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {message && (
        <div className="bg-verified/10 border border-verified/30 text-verified font-bold rounded-2xl px-6 py-4">
          {message}
        </div>
      )}

      <div className="flex items-center gap-3">
        <h2 className="font-display text-xl font-extrabold flex-1">Your plan</h2>
        <div className="flex bg-card border border-line rounded-full p-1">
          {(['monthly', 'annual'] as const).map((i) => (
            <button
              key={i}
              onClick={() => setInterval_(i)}
              className={`text-[13px] font-bold px-4 py-2 rounded-full cursor-pointer transition-colors ${
                interval === i ? 'bg-ink text-surface' : 'text-muted'
              }`}
            >
              {i === 'monthly' ? 'Monthly' : 'Annual (2 months free)'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {plans.map((plan) => {
          const isCurrent = plan.key === currentPlanKey;
          const price = interval === 'annual' ? plan.annualPrice : plan.monthlyPrice;
          return (
            <div
              key={plan._id}
              className={`bg-card rounded-3xl p-6 flex flex-col ${
                isCurrent ? 'ring-2 ring-primary' : ''
              }`}
            >
              <div className="flex items-baseline justify-between">
                <h3 className="font-display text-lg font-extrabold">{plan.name}</h3>
                {isCurrent && (
                  <span className="text-[11px] font-extrabold uppercase text-primary">Current</span>
                )}
              </div>
              <div className="font-display text-3xl font-extrabold mt-2">
                £{price}
                <span className="text-sm font-sans text-muted font-bold">
                  /{interval === 'annual' ? 'yr' : 'mo'}
                </span>
              </div>
              <div className="text-[13px] font-bold text-muted mb-4">{plan.bestFor}</div>
              <ul className="text-[13px] font-semibold text-ink-soft space-y-1.5 mb-6">
                {plan.features.map((f) => (
                  <li key={f}>✓ {f}</li>
                ))}
              </ul>
              <button
                onClick={() => choose(plan)}
                disabled={isCurrent || busy !== null}
                className={`mt-auto font-bold py-3 rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                  isCurrent
                    ? 'bg-page text-muted'
                    : 'bg-ink text-surface hover:bg-primary'
                }`}
              >
                {busy === plan.key ? 'Processing…' : isCurrent ? 'Your plan' : plan.monthlyPrice === 0 ? 'Downgrade' : 'Choose plan'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
