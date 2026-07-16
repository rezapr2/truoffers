'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { FranchiseStats } from '@/lib/types';
import VerifiedBadge from '@/components/VerifiedBadge';

// Franchise / multi-location dashboard: totals across every owned business
// plus a per-location comparison table.
export default function FranchiseTab() {
  const [data, setData] = useState<FranchiseStats | null>(null);

  useEffect(() => {
    void api<FranchiseStats>('/businesses/mine/stats').then(setData).catch(() => {});
  }, []);

  if (!data) {
    return <div className="py-16 text-center text-muted font-bold">Loading…</div>;
  }

  const { locations, totals } = data;
  const tiles: Array<[string, number]> = totals
    ? [
        ['Locations', totals.locations],
        ['Live offers', totals.activeOffers],
        ['Impressions', totals.impressions],
        ['Flips', totals.flips],
        ['Order clicks', totals.orderClicks],
        ['Redemptions', totals.redemptions],
        ['Followers', totals.followers],
      ]
    : [];

  return (
    <div className="flex flex-col gap-6">
      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {tiles.map(([label, value]) => (
          <div key={label} className="bg-card rounded-2xl p-5">
            <div className="font-display text-2xl font-extrabold">{value.toLocaleString()}</div>
            <div className="text-[12px] font-bold text-muted uppercase tracking-wide mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* Per-location table */}
      <div className="bg-card rounded-3xl p-7 overflow-x-auto">
        <h2 className="font-display text-xl font-extrabold mb-4">Locations</h2>
        <table className="w-full text-left min-w-[720px]">
          <thead>
            <tr className="text-[12px] font-extrabold text-muted uppercase tracking-wide border-b border-line">
              <th className="py-3 pr-4">Location</th>
              <th className="py-3 pr-4">Rating</th>
              <th className="py-3 pr-4">Live offers</th>
              <th className="py-3 pr-4">Impressions</th>
              <th className="py-3 pr-4">Flips</th>
              <th className="py-3 pr-4">Order clicks</th>
              <th className="py-3 pr-4">Redeemed</th>
              <th className="py-3">Followers</th>
            </tr>
          </thead>
          <tbody>
            {locations.map(({ business, stats }) => (
              <tr key={business._id} className="border-b border-line last:border-0">
                <td className="py-4 pr-4">
                  <Link href={`/takeaway/${business.slug}`} className="font-extrabold hover:text-primary">
                    {business.name}
                  </Link>{' '}
                  <VerifiedBadge status={business.verificationStatus} className="text-[11px]" />
                  <div className="text-[12px] font-semibold text-muted">
                    {business.town} {business.postcode}
                  </div>
                </td>
                <td className="py-4 pr-4 font-bold">
                  {business.reviews?.rating ? `${business.reviews.rating}★` : '—'}
                  <span className="text-[12px] text-muted font-semibold">
                    {business.reviews?.count ? ` (${business.reviews.count})` : ''}
                  </span>
                </td>
                <td className="py-4 pr-4 font-bold">{business.activeOfferCount}</td>
                <td className="py-4 pr-4 font-bold">{stats.impressions.toLocaleString()}</td>
                <td className="py-4 pr-4 font-bold">{stats.flips.toLocaleString()}</td>
                <td className="py-4 pr-4 font-bold">{stats.orderClicks.toLocaleString()}</td>
                <td className="py-4 pr-4 font-bold">{stats.redemptions.toLocaleString()}</td>
                <td className="py-4 font-bold">{business.followerCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
