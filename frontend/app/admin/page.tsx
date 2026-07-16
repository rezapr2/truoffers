'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

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
    <div className="mx-auto max-w-6xl px-5 md:px-10 py-8">
      <h1 className="font-display text-3xl font-extrabold tracking-tight mb-8">Admin panel</h1>

      <div className="flex gap-2 mb-7 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-sm font-bold px-5 py-2.5 rounded-full transition-colors cursor-pointer ${
              tab === t ? 'bg-ink text-surface' : 'bg-card border border-line hover:border-primary'
            }`}
          >
            {t}
            {t === 'Claim queue' && claims.length > 0 ? ` · ${claims.length}` : ''}
            {t === 'Offer queue' && offers.length > 0 ? ` · ${offers.length}` : ''}
          </button>
        ))}
      </div>

      {tab === 'Overview' && dashboard && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              ['Listed businesses', dashboard.supply.listedBusinesses],
              ['Claimed', `${dashboard.supply.claimedBusinesses} (${dashboard.supply.claimedRate}%)`],
              ['Active offers', dashboard.supply.activeOffers],
              ['Users', dashboard.demand.users],
              ['Searches (30d)', dashboard.demand.searches30d],
              ['Order clicks (30d)', dashboard.demand.orderClicks30d],
              ['Paid accounts', dashboard.revenue.paidAccounts],
              ['MRR', `£${dashboard.revenue.mrr}`],
            ].map(([label, value]) => (
              <div key={label as string} className="bg-card rounded-2xl p-5">
                <div className="font-display text-2xl font-extrabold">{value}</div>
                <div className="text-[13px] font-bold text-muted">{label}</div>
              </div>
            ))}
          </div>
          <div className="bg-card rounded-2xl p-6">
            <h2 className="font-display text-lg font-extrabold mb-4">Top search areas (30 days)</h2>
            <div className="flex gap-2 flex-wrap">
              {dashboard.demand.topSearchAreas.map((a) => (
                <span key={a._id || 'unknown'} className="bg-surface border border-line text-sm font-bold px-4 py-2 rounded-full">
                  {a._id || '—'} · {a.count}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'Claim queue' && (
        <div className="flex flex-col gap-3">
          {claims.map((claim) => (
            <div key={claim._id} className="bg-card rounded-2xl p-6 flex flex-col md:flex-row md:items-center gap-4">
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
                  className="border border-primary text-primary text-sm font-bold px-5 py-2.5 rounded-full cursor-pointer hover:bg-primary hover:text-cream transition-colors"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
          {claims.length === 0 && (
            <div className="bg-card rounded-2xl p-10 text-center text-muted font-semibold">
              Claim queue is empty. 🎉
            </div>
          )}
        </div>
      )}

      {tab === 'Offer queue' && (
        <div className="flex flex-col gap-3">
          {offers.map((offer) => (
            <div key={offer._id} className="bg-card rounded-2xl p-6 flex flex-col md:flex-row md:items-center gap-4">
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
                  className="border border-primary text-primary text-sm font-bold px-5 py-2.5 rounded-full cursor-pointer hover:bg-primary hover:text-cream transition-colors"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
          {offers.length === 0 && (
            <div className="bg-card rounded-2xl p-10 text-center text-muted font-semibold">
              No offers awaiting moderation.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
