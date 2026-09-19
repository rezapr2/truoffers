'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { DateChip, PageHeader, StatStrip, Tabs } from '@/components/ui';
import { ClickIcon, DashboardIcon, EyeIcon, OffersIcon, PricingIcon, SearchIcon, ShieldIcon, StoreIcon, UsersIcon } from '@/components/icons';

interface Dashboard {
  supply: { listedBusinesses: number; claimedBusinesses: number; activeOffers: number; claimedRate: number };
  demand: { users: number; searches30d: number; orderClicks30d: number; topSearchAreas: { _id: string; count: number }[] };
  revenue: { paidAccounts: number; mrr: number; arpa: number };
  moderation: { pendingClaims: number; pendingOffers: number };
}

interface AdminClaim {
  _id: string;
  method: string;
  status: string;
  riskLevel: string;
  evidence?: string;
  createdAt: string;
  businessId?: { name: string; slug: string; town?: string; postcode?: string };
  userId?: { name: string; email: string; phone?: string };
}

interface AdminOffer {
  _id: string;
  title: string;
  displayLabel: string;
  terms?: string;
  status: string;
  createdAt: string;
  businessId?: { name: string; slug: string; town?: string; verificationStatus?: string };
}

const TABS = ['Overview', 'Claim queue', 'Offer queue'] as const;

export default function AdminPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [claims, setClaims] = useState<AdminClaim[]>([]);
  const [offers, setOffers] = useState<AdminOffer[]>([]);
  const [denied, setDenied] = useState(false);

  const load = useCallback(() => {
    void api<Dashboard>('/admin/dashboard').then(setDashboard).catch((e) => {
      if (e?.status === 403) setDenied(true);
    });
    void api<AdminClaim[]>('/admin/claims').then(setClaims).catch(() => {});
    void api<AdminOffer[]>('/admin/offers').then(setOffers).catch(() => {});
  }, []);

  useEffect(() => {
    if (!loading && !user) router.push('/login?next=/admin');
    if (user) load();
  }, [loading, user, router, load]);

  if (loading || !user) return <div className="py-24 text-center text-muted font-bold">Loading…</div>;
  if (denied) {
    return (
      <div className="py-24 text-center">
        <h1 className="font-display text-2xl font-extrabold">Admin access required</h1>
      </div>
    );
  }

  async function reviewClaim(claim: AdminClaim, approve: boolean) {
    await api(`/admin/claims/${claim._id}/review`, {
      method: 'PATCH',
      body: JSON.stringify({ approve }),
    }).catch(() => {});
    load();
  }

  async function moderateOffer(offer: AdminOffer, approve: boolean) {
    const note = approve ? undefined : prompt('Rejection note (shown to the owner):') || undefined;
    await api(`/admin/offers/${offer._id}/moderate`, {
      method: 'PATCH',
      body: JSON.stringify({ approve, note }),
    }).catch(() => {});
    load();
  }

  return (
    <div className="mx-auto max-w-7xl px-5 md:px-10 py-8">
      <PageHeader
        title={`Hello, ${user.name.split(' ')[0]}`}
        subtitle="Keep an eye on supply, demand and the review queues."
        actions={
          <>
            <Link href="/admin/scraper" className="btn-soft text-sm font-bold px-5 py-3 rounded-2xl">
              Website import robot →
            </Link>
            <DateChip />
          </>
        }
      />

      <div className="mb-7">
        <Tabs
          tabs={TABS.map((t) => ({ value: t, label: t }))}
          active={tab}
          onChange={setTab}
          counts={{ 'Claim queue': claims.length, 'Offer queue': offers.length }}
        />
      </div>

      {tab === 'Overview' && dashboard && (
        <div className="grid xl:grid-cols-[minmax(0,1fr)_320px] gap-x-8 gap-y-8">
          <div className="min-w-0 flex flex-col gap-6">
            <StatStrip
              stats={[
                { icon: StoreIcon, tint: 'blue', label: 'Listed businesses', value: dashboard.supply.listedBusinesses },
                {
                  icon: ShieldIcon,
                  tint: 'mint',
                  label: 'Claimed',
                  value: dashboard.supply.claimedBusinesses,
                  note: { text: `${dashboard.supply.claimedRate}%`, tone: 'neutral' },
                },
                { icon: OffersIcon, tint: 'peach', label: 'Active offers', value: dashboard.supply.activeOffers },
                { icon: UsersIcon, tint: 'lilac', label: 'Users', value: dashboard.demand.users },
              ]}
            />
            <StatStrip
              stats={[
                { icon: SearchIcon, tint: 'blue', label: 'Searches (30d)', value: dashboard.demand.searches30d },
                { icon: ClickIcon, tint: 'mint', label: 'Order clicks (30d)', value: dashboard.demand.orderClicks30d },
                { icon: PricingIcon, tint: 'peach', label: 'Paid accounts', value: dashboard.revenue.paidAccounts },
                { icon: DashboardIcon, tint: 'lilac', label: 'MRR', value: `£${dashboard.revenue.mrr}` },
              ]}
            />
          </div>

          <aside>
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="font-display text-[15px] font-extrabold">Top search areas</h2>
              <span className="text-[13px] text-muted">30 days</span>
            </div>
            <ul>
              {dashboard.demand.topSearchAreas.map((a) => (
                <li key={a._id || 'unknown'} className="flex items-center gap-3 py-3 border-b border-line last:border-0">
                  <span className="w-9 h-9 rounded-full bg-tint-blue text-primary flex items-center justify-center flex-none">
                    <EyeIcon className="w-4 h-4" />
                  </span>
                  <span className="flex-1 text-sm font-bold">{a._id || '—'}</span>
                  <span className="text-sm text-muted">{a.count}</span>
                </li>
              ))}
              {dashboard.demand.topSearchAreas.length === 0 && (
                <li className="text-sm text-muted">No searches yet.</li>
              )}
            </ul>
          </aside>
        </div>
      )}

      {tab === 'Claim queue' && (
        <div className="flex flex-col gap-3">
          {claims.map((claim) => (
            <div key={claim._id} className="bg-card border border-line rounded-2xl p-6 flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="font-extrabold">
                  {claim.businessId?.name}{' '}
                  <span className="text-muted font-semibold text-sm">
                    · {claim.businessId?.town} {claim.businessId?.postcode}
                  </span>
                </div>
                <div className="text-[13px] font-semibold text-muted mt-1">
                  Claimed by {claim.userId?.name} ({claim.userId?.email}) · method:{' '}
                  <span className="font-bold">{claim.method}</span> · risk:{' '}
                  <span className="font-bold">{claim.riskLevel}</span>
                </div>
                {claim.evidence && (
                  <div className="text-[13px] font-semibold text-ink-soft mt-1">Evidence: {claim.evidence}</div>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => reviewClaim(claim, true)}
                  className="bg-verified text-white text-sm font-bold px-5 py-2.5 rounded-full cursor-pointer hover:opacity-90"
                >
                  Approve
                </button>
                <button
                  onClick={() => reviewClaim(claim, false)}
                  className="border border-danger text-danger text-sm font-bold px-5 py-2.5 rounded-full cursor-pointer hover:bg-danger hover:text-white transition-colors"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
          {claims.length === 0 && (
            <div className="bg-card border border-line rounded-2xl p-10 text-center text-muted font-semibold">
              Claim queue is empty. 🎉
            </div>
          )}
        </div>
      )}

      {tab === 'Offer queue' && (
        <div className="flex flex-col gap-3">
          {offers.map((offer) => (
            <div key={offer._id} className="bg-card border border-line rounded-2xl p-6 flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-display text-lg font-extrabold text-primary">{offer.displayLabel}</span>
                  <span className="font-extrabold">{offer.title}</span>
                </div>
                <div className="text-[13px] font-semibold text-muted mt-1">
                  {offer.businessId?.name} · {offer.businessId?.town} ·{' '}
                  {offer.businessId?.verificationStatus}
                  {offer.terms ? ` · Terms: ${offer.terms}` : ''}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => moderateOffer(offer, true)}
                  className="bg-verified text-white text-sm font-bold px-5 py-2.5 rounded-full cursor-pointer hover:opacity-90"
                >
                  Approve
                </button>
                <button
                  onClick={() => moderateOffer(offer, false)}
                  className="border border-danger text-danger text-sm font-bold px-5 py-2.5 rounded-full cursor-pointer hover:bg-danger hover:text-white transition-colors"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
          {offers.length === 0 && (
            <div className="bg-card border border-line rounded-2xl p-10 text-center text-muted font-semibold">
              No offers awaiting moderation.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
