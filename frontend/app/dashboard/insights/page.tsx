'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { download, errorMessage } from '@/lib/api';
import { money } from '@/lib/format';
import { useBusiness } from '@/lib/business-context';
import { useApi } from '@/lib/hooks';
import TrendChart from '@/components/TrendChart';
import { Alert, btn, SectionTitle, Spinner, StatStrip, type Stat } from '@/components/ui';
import { ChartIcon, ClickIcon, DownloadIcon, EyeIcon, FlipIcon, PhoneIcon, StoreIcon, TicketIcon, TruckIcon, UsersIcon } from '@/components/icons';
import { DashboardPage } from '../_components/shared';

interface Insights {
  level: 'views' | 'full' | 'full_report';
  planName: string;
  days: number;
  metrics: { key: string; label: string }[];
  lockedMetrics: { key: string; label: string }[];
  totals: Record<string, number>;
  series: (Record<string, number> & { day: string })[];
  offers: (Record<string, number> & { _id: string; title: string; status: string; displayLabel: string })[];
  canExport: boolean;
  foodbellRevenue?: number;
  foodbellConnected?: boolean;
}

const ICONS: Record<string, Stat['icon']> = {
  impressions: EyeIcon,
  profileViews: StoreIcon,
  offerViews: ChartIcon,
  redeemTaps: FlipIcon,
  orderClicks: ClickIcon,
  calls: PhoneIcon,
  codeCopies: TicketIcon,
  newFollowers: UsersIcon,
  foodbellOrders: TruckIcon,
};
const TINTS: Stat['tint'][] = ['blue', 'mint', 'peach', 'lilac'];

export default function InsightsPage() {
  const { business, isOwner } = useBusiness();
  const [days, setDays] = useState(30);
  const [offerId, setOfferId] = useState('');
  const [metric, setMetric] = useState('impressions');
  const [error, setError] = useState<string | null>(null);
  const query = `days=${days}${offerId ? `&offerId=${offerId}` : ''}`;
  const { data, loading } = useApi<Insights>(business ? `/businesses/${business._id}/insights?${query}` : null);

  const points = useMemo(
    () =>
      (data?.series ?? []).map((row) => ({
        label: new Date(row.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        value: Number(row[metric] ?? 0),
      })),
    [data, metric],
  );

  if (!business || !data) return <Spinner />;
  const selected = data.metrics.find((m) => m.key === metric) ?? data.metrics[0];
  const stats: Stat[] = [...data.metrics.slice(0, 8)].map((m, i) => ({ icon: ICONS[m.key] ?? ChartIcon, tint: TINTS[i % 4], label: m.label, value: data.totals[m.key] ?? 0 }));

  async function exportCsv(kind: 'csv' | 'csv-offers') {
    setError(null);
    try {
      await download(`/businesses/${business!._id}/insights?${query}&format=${kind}`, kind === 'csv' ? `insights-${days}d.csv` : `offers-${days}d.csv`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <DashboardPage
      title="Insights"
      subtitle={`How customers find and use your offers. ${data.totals.followers ?? 0} people follow ${business.name}.`}
      actions={
        <>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period" className="bg-surface rounded-xl px-4 py-2.5 text-sm font-bold outline-none cursor-pointer">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          {data.canExport && (
            <button className={btn.secondary} onClick={() => exportCsv('csv')}>
              <DownloadIcon className="w-4 h-4" /> CSV
            </button>
          )}
        </>
      }
    >
      {error && <Alert tone="danger" className="mb-5">{error}</Alert>}
      {data.level === 'views' && (
        <Alert tone="info" className="mb-6" action={isOwner ? <Link href="/dashboard/billing" className={btn.small}>See plans</Link> : undefined}>
          The {data.planName} plan shows views. Standard and Professional add redeem taps, order clicks, calls, code copies and followers, per offer and per day, with CSV export.
        </Alert>
      )}

      <StatStrip stats={stats} />
      {data.metrics.some((m) => m.key === 'foodbellOrders') && (
        <p className="text-sm mt-4">
          <TruckIcon className="w-4 h-4 inline mr-1.5 text-primary" />
          <b>{data.totals.foodbellOrders ?? 0}</b> {data.totals.foodbellOrders === 1 ? 'order' : 'orders'} on your Foodbell site came from TruOffers in this period
          {data.foodbellRevenue ? <>, worth <b>{money(data.foodbellRevenue)}</b></> : null}.
          {!data.foodbellConnected && <span className="text-muted"> Foodbell is no longer connected.</span>}
        </p>
      )}

      <section className="mt-8">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <SectionTitle className="mb-0">{selected?.label} per day</SectionTitle>
          <div className="flex gap-2 flex-wrap">
            <select value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Metric" className="bg-surface rounded-xl px-3 py-2 text-[13px] font-bold outline-none cursor-pointer">
              {data.metrics.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
            {data.canExport && (
              <select value={offerId} onChange={(e) => setOfferId(e.target.value)} aria-label="Offer" className="bg-surface rounded-xl px-3 py-2 text-[13px] font-bold outline-none cursor-pointer max-w-[240px]">
                <option value="">All offers</option>
                {data.offers.map((o) => (
                  <option key={o._id} value={o._id}>
                    {o.title}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        {loading ? <Spinner /> : <TrendChart points={points} metric={selected?.label ?? ''} />}
      </section>

      {data.canExport ? (
        <section className="mt-10">
          <SectionTitle aside={<button className={btn.small} onClick={() => exportCsv('csv-offers')}><DownloadIcon className="w-3.5 h-3.5" /> CSV</button>}>By offer</SectionTitle>
          <div className="border border-line rounded-3xl overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-surface text-[12px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="text-left px-4 py-3">Offer</th>
                  {data.metrics.filter((m) => m.key !== 'profileViews' && m.key !== 'newFollowers').map((m) => (
                    <th key={m.key} className="text-right px-3 py-3 whitespace-nowrap">
                      {m.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.offers.map((o) => (
                  <tr key={o._id} className="border-t border-line">
                    <td className="px-4 py-3 font-bold">
                      <span className="text-primary font-display mr-2">{o.displayLabel}</span>
                      {o.title}
                    </td>
                    {data.metrics.filter((m) => m.key !== 'profileViews' && m.key !== 'newFollowers').map((m) => (
                      <td key={m.key} className="text-right px-3 py-3">
                        {o[m.key] ?? 0}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        data.lockedMetrics.length > 0 && <p className="text-[13px] text-muted mt-6">Also on paid plans: {data.lockedMetrics.map((m) => m.label.toLowerCase()).join(', ')}.</p>
      )}
    </DashboardPage>
  );
}
