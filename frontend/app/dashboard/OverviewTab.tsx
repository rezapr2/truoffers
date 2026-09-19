'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { Business } from '@/lib/types';
import VerifiedBadge from '@/components/VerifiedBadge';
import TrendChart from '@/components/TrendChart';
import { StatStrip, type Stat } from '@/components/ui';
import {
  CheckIcon,
  ClickIcon,
  EyeIcon,
  FlipIcon,
  PhoneIcon,
  PinIcon,
  StoreIcon,
  TicketIcon,
  ArrowRightIcon,
} from '@/components/icons';

interface Metrics {
  periodDays: number;
  totals: {
    impressions: number;
    flips: number;
    profileViews: number;
    orderClicks: number;
    callClicks: number;
    directionsClicks: number;
    redeems: number;
    saves: number;
  };
  rates: {
    flipRate: number;
    offerToProfileRate: number;
    profileToOrderRate: number;
    redemptionRate: number;
  };
  daily: { day: string; event: string; count: number }[];
}

const CHART_METRICS = [
  { event: 'offer_impression', label: 'Offer impressions' },
  { event: 'business_profile_view', label: 'Profile views' },
  { event: 'order_click', label: 'Order clicks' },
] as const;

function completeness(b: Business): { score: number; missing: string[] } {
  const checks: Array<[boolean, string]> = [
    [!!b.description, 'Add a description'],
    [!!b.phone, 'Add a phone number'],
    [!!b.orderUrl, 'Add an online ordering link'],
    [!!b.address, 'Add your address'],
    [Array.isArray(b.categories) && b.categories.length > 0, 'Pick a cuisine'],
    [b.activeOfferCount > 0, 'Post your first offer'],
    [b.verificationStatus !== 'unclaimed' && b.verificationStatus !== 'claimed', 'Get verified'],
  ];
  const done = checks.filter(([ok]) => ok).length;
  return {
    score: Math.round((done / checks.length) * 100),
    missing: checks.filter(([ok]) => !ok).map(([, label]) => label),
  };
}

// One point per day for the whole period; days with no events are zero rather than missing.
function dailySeries(metrics: Metrics, event: string) {
  const counts = new Map(metrics.daily.filter((d) => d.event === event).map((d) => [d.day, d.count]));
  return Array.from({ length: metrics.periodDays }, (_, i) => {
    const date = new Date(Date.now() - (metrics.periodDays - 1 - i) * 24 * 3600 * 1000);
    return {
      label: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      value: counts.get(date.toISOString().slice(0, 10)) ?? 0,
    };
  });
}

export default function OverviewTab({ business }: { business: Business }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [chartEvent, setChartEvent] = useState<(typeof CHART_METRICS)[number]['event']>('offer_impression');
  const { score, missing } = completeness(business);

  useEffect(() => {
    void api<Metrics>(`/dashboard/businesses/${business._id}/metrics?days=30`)
      .then(setMetrics)
      .catch(() => {});
  }, [business._id]);

  const chartMetric = CHART_METRICS.find((m) => m.event === chartEvent)!;
  const series = useMemo(() => (metrics ? dailySeries(metrics, chartEvent) : []), [metrics, chartEvent]);

  const stats: Stat[] = metrics
    ? [
        { icon: EyeIcon, tint: 'blue', label: 'Offer impressions', value: metrics.totals.impressions },
        { icon: StoreIcon, tint: 'mint', label: 'Profile views', value: metrics.totals.profileViews },
        { icon: ClickIcon, tint: 'peach', label: 'Order clicks', value: metrics.totals.orderClicks },
        { icon: TicketIcon, tint: 'lilac', label: 'Redemptions', value: metrics.totals.redeems },
      ]
    : [];

  const activity = metrics
    ? [
        { icon: FlipIcon, tint: 'bg-tint-blue text-primary', label: 'Offer flips', value: metrics.totals.flips },
        { icon: PhoneIcon, tint: 'bg-tint-mint text-verified', label: 'Calls', value: metrics.totals.callClicks },
        { icon: PinIcon, tint: 'bg-tint-peach text-star', label: 'Directions', value: metrics.totals.directionsClicks },
      ]
    : [];

  const rates = metrics
    ? [
        ['Flip rate', metrics.rates.flipRate],
        ['Flip → profile', metrics.rates.offerToProfileRate],
        ['Profile → order', metrics.rates.profileToOrderRate],
        ['Redemption rate', metrics.rates.redemptionRate],
      ]
    : [];

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_320px] gap-x-8 gap-y-8">
      <div className="min-w-0 flex flex-col gap-8">
        {metrics ? (
          <>
            <StatStrip stats={stats} />

            {/* Performance */}
            <section>
              <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
                <h2 className="font-display text-lg font-extrabold">Performance</h2>
                <label className="relative">
                  <span className="sr-only">Metric</span>
                  <select
                    value={chartEvent}
                    onChange={(e) => setChartEvent(e.target.value as typeof chartEvent)}
                    className="appearance-none bg-surface rounded-xl pl-4 pr-9 py-2 text-[13px] font-bold outline-none cursor-pointer"
                  >
                    {CHART_METRICS.map((m) => (
                      <option key={m.event} value={m.event}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <span aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] text-muted">
                    ▼
                  </span>
                </label>
              </div>
              <div className="text-[13px] text-muted mb-2">Last {metrics.periodDays} days · {chartMetric.label.toLowerCase()} per day</div>
              <TrendChart points={series} metric={chartMetric.label} />
            </section>

            {/* Engagement */}
            <section>
              <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                <h2 className="font-display text-lg font-extrabold">Engagement</h2>
                <span className="text-[13px] text-muted">Last {metrics.periodDays} days</span>
              </div>
              <ul>
                {activity.map((row) => {
                  const Icon = row.icon;
                  return (
                    <li key={row.label} className="flex items-center gap-4 py-3.5 border-b border-line last:border-0">
                      <span className={`w-11 h-11 rounded-full flex items-center justify-center flex-none ${row.tint}`}>
                        <Icon className="w-5 h-5" />
                      </span>
                      <span className="flex-1 text-[15px] font-bold">{row.label}</span>
                      <span className="font-display font-extrabold text-lg">{row.value}</span>
                    </li>
                  );
                })}
              </ul>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
                {rates.map(([label, value]) => {
                  const pct = Math.round((value as number) * 100);
                  return (
                    <div key={label as string}>
                      <div className="flex items-baseline justify-between gap-2 mb-2">
                        <span className="text-[13px] text-muted">{label}</span>
                        <span className="font-extrabold text-sm">{pct}%</span>
                      </div>
                      <div className="h-1.5 bg-page rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        ) : (
          <div className="text-muted py-10">Loading metrics…</div>
        )}
      </div>

      {/* Right column: the business at a glance, then what's left to do */}
      <aside className="flex flex-col gap-6">
        <div className="bg-surface rounded-3xl p-6 text-center">
          <div className="w-20 h-20 mx-auto rounded-full bg-tint-blue text-primary font-display font-extrabold text-3xl flex items-center justify-center mb-4">
            {business.name.charAt(0)}
          </div>
          <div className="font-display font-extrabold text-[17px] leading-snug">{business.name}</div>
          <div className="text-[13px] text-muted mt-0.5">@{business.slug}</div>
          <div className="mt-2">
            <VerifiedBadge status={business.verificationStatus} className="text-[13px]" />
          </div>
          <div className="flex justify-center gap-3 mt-5">
            {business.phone && (
              <a
                href={`tel:${business.phone}`}
                aria-label="Call the business"
                className="w-11 h-11 rounded-full bg-card flex items-center justify-center hover:text-primary transition-colors"
              >
                <PhoneIcon />
              </a>
            )}
            {business.orderUrl && (
              <a
                href={business.orderUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open the ordering link"
                className="w-11 h-11 rounded-full bg-card flex items-center justify-center hover:text-primary transition-colors"
              >
                <ClickIcon />
              </a>
            )}
            <Link
              href={`/takeaway/${business.slug}`}
              aria-label="View public profile"
              className="w-11 h-11 rounded-full bg-card flex items-center justify-center hover:text-primary transition-colors"
            >
              <ArrowRightIcon />
            </Link>
          </div>
        </div>

        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-display text-[15px] font-extrabold">Profile completeness</h2>
            <span className="font-display font-extrabold text-primary">{score}%</span>
          </div>
          <div className="h-2 bg-page rounded-full overflow-hidden mb-5">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${score}%` }} />
          </div>
          {missing.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {missing.map((m) => (
                <li key={m} className="flex items-center gap-3 text-[13px] font-bold text-ink-soft">
                  <span className="w-8 h-8 rounded-full bg-tint-peach text-star flex items-center justify-center flex-none">
                    <ArrowRightIcon className="w-4 h-4" />
                  </span>
                  {m}
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-3 text-[13px] font-bold text-verified">
              <span className="w-8 h-8 rounded-full bg-tint-mint flex items-center justify-center flex-none">
                <CheckIcon className="w-4 h-4" />
              </span>
              Your profile is complete
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}
