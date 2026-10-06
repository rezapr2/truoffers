'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Alert, btn, Card, SectionTitle, Spinner, StatStrip, type Stat } from '@/components/ui';
import { BellIcon, ClickIcon, EyeIcon, FlipIcon, PhoneIcon, PlusIcon } from '@/components/icons';
import { useAuth } from '@/lib/auth-context';
import { useBusiness } from '@/lib/business-context';
import { useApi } from '@/lib/hooks';
import { timeAgo } from '@/lib/format';
import type { Notification, Offer } from '@/lib/types';
import { DashboardPage, PlanUsage, VerificationBanner } from './_components/shared';

interface Week {
  views: { value: number; previous: number };
  redeemTaps: { value: number; previous: number };
  orderClicks: { value: number; previous: number };
  calls: { value: number; previous: number };
}

function trend(f: { value: number; previous: number }): Stat['note'] {
  if (!f.previous && !f.value) return undefined;
  const diff = f.value - f.previous;
  if (diff === 0) return { text: 'same as last week', tone: 'neutral' };
  return { text: `${diff > 0 ? '+' : ''}${diff} vs last week`, tone: diff > 0 ? 'good' : 'bad' };
}

function Home() {
  const { user } = useAuth();
  const { business, manage } = useBusiness();
  const params = useSearchParams();
  const { data: week } = useApi<Week>(business ? `/businesses/${business._id}/insights/week` : null);
  const { data: offers } = useApi<{ offers: Offer[]; counts: Record<string, number> }>(business ? `/businesses/${business._id}/offers/manage` : null);
  const { data: notes } = useApi<Notification[]>(business ? `/notifications?businessId=${business._id}` : null);
  if (!business || !manage) return <Spinner />;

  const stats: Stat[] = week
    ? [
        { icon: EyeIcon, tint: 'blue', label: 'Views this week', value: week.views.value, note: trend(week.views), href: '/dashboard/insights' },
        { icon: FlipIcon, tint: 'mint', label: 'Redeem taps', value: week.redeemTaps.value, note: trend(week.redeemTaps), href: '/dashboard/insights' },
        { icon: ClickIcon, tint: 'peach', label: 'Order clicks', value: week.orderClicks.value, note: trend(week.orderClicks), href: '/dashboard/insights' },
        { icon: PhoneIcon, tint: 'lilac', label: 'Calls', value: week.calls.value, note: trend(week.calls), href: '/dashboard/insights' },
      ]
    : [];
  const counts = offers?.counts ?? {};

  return (
    <DashboardPage
      title={`Hello, ${user?.name.split(' ')[0] ?? ''}`}
      subtitle={`Here is how ${business.name} is doing on TruOffers.`}
      actions={
        <Link href="/dashboard/offers/new" className={btn.primary}>
          <PlusIcon className="w-4 h-4" /> Post an offer
        </Link>
      }
    >
      <div className="flex flex-col gap-5 mb-8">
        {params.get('checkout') === 'success' && <Alert tone="success" title="Thank you!">Your payment went through. Your plan switches on as soon as Stripe confirms it, usually within a minute.</Alert>}
        <VerificationBanner manage={manage} />
      </div>

      {stats.length > 0 && <StatStrip stats={stats} />}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-8 mt-8">
        <div className="flex flex-col gap-8 min-w-0">
          <section>
            <SectionTitle aside={<Link href="/dashboard/offers" className="text-sm font-bold text-primary">All offers →</Link>}>Your offers</SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ['Live', counts.live ?? 0, 'live'],
                ['Scheduled', counts.scheduled ?? 0, 'scheduled'],
                ['Pending review', counts.pending ?? 0, 'pending'],
                ['Drafts', counts.draft ?? 0, 'draft'],
              ].map(([label, value, tab]) => (
                <Link key={tab as string} href={`/dashboard/offers?tab=${tab}`} className="bg-surface rounded-2xl p-4 hover:bg-page transition-colors">
                  <div className="font-display text-2xl font-extrabold">{value}</div>
                  <div className="text-[13px] text-muted font-semibold">{label}</div>
                </Link>
              ))}
            </div>
            {(counts.rejected ?? 0) > 0 && (
              <Alert tone="danger" className="mt-4" action={<Link href="/dashboard/offers?tab=rejected" className={btn.small}>See why</Link>}>
                {counts.rejected} offer{counts.rejected === 1 ? ' needs' : 's need'} changes before it can go live.
              </Alert>
            )}
          </section>

          <section>
            <SectionTitle>Plan</SectionTitle>
            <Card>
              <PlanUsage manage={manage} />
              {manage.plan.subscription?.cancelAtPeriodEnd && (
                <p className="text-[13px] text-muted mt-3">Your plan ends at the end of this billing period.</p>
              )}
            </Card>
          </section>
        </div>

        <aside>
          <SectionTitle aside={<Link href="/dashboard/notifications" className="text-sm font-bold text-primary">All →</Link>}>Latest</SectionTitle>
          <ul className="flex flex-col">
            {(notes ?? []).slice(0, 6).map((n) => (
              <li key={n._id} className="flex gap-3 py-3 border-b border-line last:border-0">
                <span className={`w-9 h-9 rounded-full flex items-center justify-center flex-none ${n.readAt ? 'bg-surface text-muted' : 'bg-tint-blue text-primary'}`}>
                  <BellIcon className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  {n.link ? (
                    <Link href={n.link} className="text-sm font-bold hover:text-primary">
                      {n.title}
                    </Link>
                  ) : (
                    <div className="text-sm font-bold">{n.title}</div>
                  )}
                  <div className="text-[12px] text-muted">{timeAgo(n.createdAt)}</div>
                </div>
              </li>
            ))}
            {notes && notes.length === 0 && <li className="text-sm text-muted">Nothing new yet.</li>}
          </ul>
        </aside>
      </div>
    </DashboardPage>
  );
}

export default function DashboardHomePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Home />
    </Suspense>
  );
}
