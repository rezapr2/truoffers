import Link from 'next/link';
import { serverApi } from '@/lib/server-api';
import type { Plan } from '@/lib/types';

export const metadata = {
  title: 'Pricing — TruOffers for businesses & suppliers',
  description:
    'Free listings for every takeaway. Paid plans add unlimited offers, verified badges, featured placement and analytics.',
};

function PlanGrid({ plans, note }: { plans: Plan[]; note?: string }) {
  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
      {plans.map((plan) => (
        <div
          key={plan._id}
          className={`bg-card rounded-3xl p-7 flex flex-col ${
            plan.key === 'standard' || plan.key === 'supplier_pro' ? 'ring-2 ring-primary' : ''
          }`}
        >
          {(plan.key === 'standard' || plan.key === 'supplier_pro') && (
            <span className="self-start text-[11px] font-extrabold uppercase bg-primary text-cream px-3 py-1 rounded-full mb-3">
              Most popular
            </span>
          )}
          <h3 className="font-display text-xl font-extrabold">{plan.name}</h3>
          <div className="font-display text-4xl font-extrabold mt-2">
            £{plan.monthlyPrice}
            <span className="text-sm font-sans text-muted font-bold">/mo</span>
          </div>
          {plan.annualPrice > 0 && (
            <div className="text-[13px] font-bold text-muted">or £{plan.annualPrice}/year</div>
          )}
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
                  : '/register?role=business_owner'
            }
            className="mt-auto text-center bg-ink text-surface font-bold py-3.5 rounded-full hover:bg-primary transition-colors"
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
          No commission on orders — ever. Pay a predictable monthly fee for visibility, offers and
          analytics instead of giving away 14–30% of every order.
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
