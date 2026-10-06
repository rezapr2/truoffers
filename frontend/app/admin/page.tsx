'use client';

import Link from 'next/link';
import { Alert, Card, DateChip, SectionTitle, Spinner, StatStrip } from '@/components/ui';
import {
  AlertIcon,
  BadgeCheckIcon,
  CardIcon,
  ChartIcon,
  ClickIcon,
  FlagIcon,
  MegaphoneIcon,
  OffersIcon,
  PricingIcon,
  SearchIcon,
  StoreIcon,
  UsersIcon,
} from '@/components/icons';
import TrendChart from '@/components/TrendChart';
import { useApi } from '@/lib/hooks';
import { age, date, money } from '@/lib/format';
import { AdminPage } from './_components/admin-ui';

interface Overview {
  supply: { listed: number; claimed: number; verified: number; liveOffers: number; claimedRate: number };
  queues: {
    claimsWaiting: number;
    oldestClaimAgeHours: number | null;
    claimsInfoRequested: number;
    pendingProfileChanges: number;
    offersWaiting: number;
    oldestOfferAgeHours: number | null;
    reportsOpen: number;
    suspensionReviews: number;
  };
  demand: {
    users: number;
    signups7d: number;
    searches30d: number;
    orderClicks30d: number;
    topSearchAreas: { _id: string | null; count: number }[];
    signupsByDay: { _id: string; count: number }[];
  };
  revenue: { paidAccounts: number; mrr: number; arpa: number; pastDue: number; failedPayments30d: number; promotionsLive: number };
}

/** One queue: how many are waiting and how long the oldest has waited. Click through to the queue. */
function QueueCard({ href, label, count, oldest, hint }: { href: string; label: string; count: number; oldest?: number | null; hint?: string }) {
  const late = oldest !== undefined && oldest !== null && oldest >= 48;
  return (
    <Link href={href} className="bg-surface hover:bg-tint-blue/60 transition-colors rounded-3xl p-5 flex flex-col gap-1">
      <span className="text-[13px] text-muted font-semibold">{label}</span>
      <span className="font-display text-3xl font-extrabold">{count}</span>
      {oldest !== undefined && <span className={`text-[12.5px] font-bold ${late ? 'text-danger' : 'text-muted'}`}>Oldest: {age(oldest)}</span>}
      {hint && <span className="text-[12.5px] font-bold text-muted">{hint}</span>}
    </Link>
  );
}

export default function AdminOverviewPage() {
  const { data, error } = useApi<Overview>('/admin/overview');

  if (error) {
    return (
      <AdminPage title="Overview">
        <Alert tone="danger">{error}</Alert>
      </AdminPage>
    );
  }
  if (!data) return <Spinner />;
  const { supply, queues, demand, revenue } = data;

  return (
    <AdminPage title="Overview" subtitle="The site at a glance. Every figure opens the list behind it." actions={<DateChip />}>
      <section className="mb-10">
        <SectionTitle>Queues</SectionTitle>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <QueueCard href="/admin/claims" label="Claims to review" count={queues.claimsWaiting} oldest={queues.oldestClaimAgeHours} />
          <QueueCard href="/admin/claims?tab=changes" label="Profile changes" count={queues.pendingProfileChanges} hint="Locked fields" />
          <QueueCard href="/admin/offers?status=pending" label="Offers to review" count={queues.offersWaiting} oldest={queues.oldestOfferAgeHours} />
          <QueueCard href="/admin/reports" label="Open reports" count={queues.reportsOpen} />
          <QueueCard href="/admin/businesses?flag=suspension_review" label="Suspension reviews" count={queues.suspensionReviews} />
        </div>
        {queues.claimsInfoRequested > 0 && (
          <p className="text-sm text-muted font-semibold mt-3">
            {queues.claimsInfoRequested} claim{queues.claimsInfoRequested === 1 ? ' is' : 's are'} waiting on the business for more information.
          </p>
        )}
      </section>

      <section className="mb-10">
        <SectionTitle>Supply</SectionTitle>
        <StatStrip
          stats={[
            { icon: StoreIcon, tint: 'blue', label: 'Listed takeaways', value: supply.listed.toLocaleString('en-GB'), href: '/admin/businesses' },
            { icon: BadgeCheckIcon, tint: 'mint', label: 'Claimed', value: supply.claimed.toLocaleString('en-GB'), note: { text: `${supply.claimedRate}%`, tone: 'neutral' }, href: '/admin/businesses?level=1' },
            { icon: BadgeCheckIcon, tint: 'lilac', label: 'Verified', value: supply.verified.toLocaleString('en-GB'), href: '/admin/businesses?level=2' },
            { icon: OffersIcon, tint: 'peach', label: 'Live offers', value: supply.liveOffers.toLocaleString('en-GB'), href: '/admin/offers?status=active' },
          ]}
        />
      </section>

      <section className="mb-10">
        <SectionTitle>Revenue</SectionTitle>
        <StatStrip
          stats={[
            { icon: PricingIcon, tint: 'mint', label: 'Monthly recurring revenue', value: money(revenue.mrr), href: '/admin/billing' },
            { icon: CardIcon, tint: 'blue', label: 'Paying businesses', value: revenue.paidAccounts, note: { text: `ARPA ${money(revenue.arpa)}`, tone: 'neutral' }, href: '/admin/billing' },
            {
              icon: AlertIcon,
              tint: 'peach',
              label: 'Failed payments (30 days)',
              value: revenue.failedPayments30d,
              note: revenue.pastDue ? { text: `${revenue.pastDue} past due`, tone: 'bad' } : undefined,
              href: '/admin/billing?tab=failed',
            },
            { icon: MegaphoneIcon, tint: 'lilac', label: 'Live promotions', value: revenue.promotionsLive, href: '/admin/promotions' },
          ]}
        />
      </section>

      <section className="mb-10">
        <SectionTitle>Demand</SectionTitle>
        <StatStrip
          stats={[
            { icon: UsersIcon, tint: 'blue', label: 'Customers', value: demand.users.toLocaleString('en-GB'), note: { text: `+${demand.signups7d} this week`, tone: demand.signups7d ? 'good' : 'neutral' }, href: '/admin/users' },
            { icon: SearchIcon, tint: 'lilac', label: 'Postcode searches (30 days)', value: demand.searches30d.toLocaleString('en-GB') },
            { icon: ClickIcon, tint: 'mint', label: 'Order clicks (30 days)', value: demand.orderClicks30d.toLocaleString('en-GB') },
            { icon: FlagIcon, tint: 'peach', label: 'Open reports', value: queues.reportsOpen, href: '/admin/reports' },
          ]}
        />
      </section>

      <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6">
        <Card>
          <SectionTitle aside={<ChartIcon className="w-5 h-5 text-muted" />}>Sign-ups, last 30 days</SectionTitle>
          {demand.signupsByDay.length ? (
            <TrendChart metric="Sign-ups" points={demand.signupsByDay.map((d) => ({ label: date(d._id, { day: 'numeric', month: 'short' }), value: d.count }))} />
          ) : (
            <p className="text-sm text-muted">No sign-ups in the last 30 days.</p>
          )}
        </Card>
        <Card>
          <SectionTitle>Top searched areas</SectionTitle>
          {demand.topSearchAreas.length ? (
            <ol className="flex flex-col gap-2 text-sm">
              {demand.topSearchAreas.map((area, i) => (
                <li key={area._id ?? i} className="flex items-center gap-3">
                  <span className="w-6 text-muted font-bold">{i + 1}</span>
                  <span className="flex-1 font-bold">{area._id || 'Unknown'}</span>
                  <span className="font-extrabold">{area.count.toLocaleString('en-GB')}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">No searches yet.</p>
          )}
        </Card>
      </div>
    </AdminPage>
  );
}
