import Link from 'next/link';
import { serverApi } from '@/lib/server-api';
import type { Plan } from '@/lib/types';

export const metadata = {
  title: 'Pricing — TruOffers for businesses & suppliers',
  description:
    'Free listings for every takeaway. Paid plans add unlimited offers, verified badges, featured placement and analytics.',
};

const price = (n: number) => `£${Number.isInteger(n) ? n : n.toFixed(2)}`;

// The plans, badges and prices all come from Plans & pricing in the admin panel.
function PlanGrid({ plans, note }: { plans: Plan[]; note?: string }) {
  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
      {plans.map((plan) => (
        <div key={plan._id} className={`bg-card border border-line rounded-3xl p-7 flex flex-col ${plan.badgeText ? 'ring-2 ring-primary' : ''}`}>
          {plan.badgeText && (
            <span className="self-start text-[11px] font-extrabold uppercase bg-primary text-cream px-3 py-1 rounded-full mb-3">{plan.badgeText}</span>
          )}
          <h3 className="font-display text-xl font-extrabold">{plan.name}</h3>
          <div className="font-display text-4xl font-extrabold mt-2">
            {price(plan.monthlyPrice)}
            <span className="text-sm font-sans text-muted font-bold">/mo</span>
          </div>
          {plan.annualPrice > 0 && <div className="text-[13px] font-bold text-muted">or {price(plan.annualPrice)}/year</div>}
          {plan.monthlyPrice > 0 && (
            <div className="text-[12px] font-bold text-muted">{plan.pricesIncludeVat ? 'Including VAT' : `Plus VAT (${plan.vatRatePercent ?? 20}%)`}</div>
          )}
          {plan.trialDays ? <div className="text-[12.5px] font-extrabold text-verified mt-1">{plan.trialDays}-day free trial</div> : null}
          <div className="text-sm font-bold text-ink-soft mt-1 mb-5">{plan.bestFor}</div>
          <ul className="text-sm font-semibold text-ink-soft space-y-2 mb-7">
            {plan.features.map((f) => (
              <li key={f} className="flex gap-2">
                <span className="text-verified">✓</span> {f}
              </li>
            ))}
          </ul>
          <Link
            href={
              plan.audience === 'supplier'
                ? '/register?role=supplier'
                : plan.monthlyPrice === 0
                  ? '/claim-your-business'
                  : '/claim-your-business?plan=' + plan.key
            }
            className="mt-auto text-center btn-soft font-bold py-3.5 rounded-2xl"
          >
            {plan.monthlyPrice === 0 ? 'Start free' : 'Get started'}
          </Link>
        </div>
      ))}
      {note && <p className="text-sm text-muted font-semibold md:col-span-2 lg:col-span-3">{note}</p>}
    </div>
  );
}

export default async function PricingPage() {
  const plans = (await serverApi<Plan[]>('/billing/plans')) || [];
  const takeaway = plans.filter((p) => p.audience === 'takeaway');
  const supplier = plans.filter((p) => p.audience === 'supplier');

  return (
    <div className="mx-auto max-w-7xl px-5 md:px-10 py-10">
      <div className="text-center max-w-2xl mx-auto mb-12">
        <h1 className="font-display text-4xl md:text-5xl font-extrabold tracking-tight mb-4">
          Free for customers.
          <br />
          Fair for businesses.
        </h1>
        <p className="text-muted font-semibold text-lg">
          No commission on orders, ever. Listing is free; paid plans add more live offers, scheduling, coupon codes and
          insights. Claim and verify your takeaway first, then upgrade from your dashboard.
        </p>
      </div>

      <h2 className="font-display text-2xl font-extrabold tracking-tight mb-5">For takeaways</h2>
      <PlanGrid plans={takeaway} />

      <h2 className="font-display text-2xl font-extrabold tracking-tight mt-14 mb-5">For suppliers</h2>
      <PlanGrid
        plans={supplier}
        note="Enterprise & National Sponsor packages available — contact sales for franchises and category sponsorship."
      />
    </div>
  );
}
