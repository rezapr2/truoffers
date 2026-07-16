'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Business } from '@/lib/types';
import VerifiedBadge from '@/components/VerifiedBadge';

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

export default function OverviewTab({ business }: { business: Business }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const { score, missing } = completeness(business);

  useEffect(() => {
    void api<Metrics>(`/dashboard/businesses/${business._id}/metrics?days=30`)
      .then(setMetrics)
      .catch(() => {});
  }, [business._id]);

  const stats = metrics
    ? [
        ['Offer impressions', metrics.totals.impressions],
        ['Offer flips', metrics.totals.flips],
        ['Profile views', metrics.totals.profileViews],
        ['Order clicks', metrics.totals.orderClicks],
        ['Calls', metrics.totals.callClicks],
        ['Directions', metrics.totals.directionsClicks],
        ['Redemptions', metrics.totals.redeems],
      ]
    : [];

  return (
    <div className="flex flex-col gap-5">
      {/* Profile completeness */}
      <div className="bg-card rounded-3xl p-7">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-display text-xl font-extrabold">
            Profile completeness: <span className="text-primary">{score}%</span>
          </h2>
          <VerifiedBadge status={business.verificationStatus} className="text-sm" />
        </div>
        <div className="h-3 bg-page rounded-full overflow-hidden mb-4">
          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${score}%` }} />
        </div>
        {missing.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {missing.map((m) => (
              <span key={m} className="text-[13px] font-bold text-ink-soft bg-surface border border-line px-3.5 py-1.5 rounded-full">
                {m}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* This month stats */}
      <div className="bg-card rounded-3xl p-7">
        <h2 className="font-display text-xl font-extrabold mb-5">Last 30 days</h2>
        {metrics ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {stats.map(([label, value]) => (
                <div key={label} className="bg-surface rounded-2xl p-4">
                  <div className="font-display text-2xl font-extrabold">{value}</div>
                  <div className="text-[13px] font-bold text-muted">{label}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              {[
                ['Flip rate', metrics.rates.flipRate],
                ['Flip → profile', metrics.rates.offerToProfileRate],
                ['Profile → order', metrics.rates.profileToOrderRate],
                ['Redemption rate', metrics.rates.redemptionRate],
              ].map(([label, value]) => (
                <div key={label as string} className="flex justify-between gap-2 border-t border-line pt-3">
                  <span className="font-bold text-muted">{label}</span>
                  <span className="font-extrabold">{Math.round((value as number) * 100)}%</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-muted font-semibold">Loading metrics…</div>
        )}
      </div>
    </div>
  );
}
