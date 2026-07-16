'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import type { Business } from '@/lib/types';
import OverviewTab from './OverviewTab';
import OffersTab from './OffersTab';
import PromoteTab from './PromoteTab';
import BillingTab from './BillingTab';
import LeadsTab from './LeadsTab';
import FranchiseTab from './FranchiseTab';

const BIZ_TABS = ['Overview', 'Offers', 'Promote', 'Billing'] as const;

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<string>('Overview');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push('/login?next=/dashboard');
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    if (['super_admin', 'support_admin', 'sales_admin'].includes(user.role)) {
      router.push('/admin');
      return;
    }
    if (user.role === 'supplier') {
      setTab('Leads');
      setLoaded(true);
      return;
    }
    void api<Business[]>('/businesses/mine')
      .then((list) => {
        setBusinesses(list);
        if (list.length > 0) setSelectedId(list[0]._id);
      })
      .finally(() => setLoaded(true));
  }, [user, router]);

  if (loading || !user || !loaded) {
    return <div className="py-24 text-center text-muted font-bold">Loading…</div>;
  }

  const isSupplier = user.role === 'supplier';
  const selected = businesses.find((b) => b._id === selectedId) || null;

  if (!isSupplier && businesses.length === 0) {
    return (
      <div className="mx-auto max-w-xl px-5 py-20 text-center">
        <div className="text-5xl mb-4">🏪</div>
        <h1 className="font-display text-3xl font-extrabold mb-3">No business yet</h1>
        <p className="text-muted font-semibold mb-7">
          Claim your existing listing or add your takeaway to start posting offers.
        </p>
        <Link
          href="/claim-your-business"
          className="bg-primary text-cream font-bold px-8 py-3.5 rounded-full hover:bg-primary-dark transition-colors"
        >
          Claim or add your business
        </Link>
      </div>
    );
  }

  // Multi-location owners (franchises) get a cross-location view
  const tabs = isSupplier
    ? ['Leads']
    : businesses.length > 1
      ? [...BIZ_TABS, 'All locations']
      : [...BIZ_TABS];

  return (
    <div className="mx-auto max-w-6xl px-5 md:px-10 py-8">
      <div className="flex flex-col md:flex-row md:items-center gap-4 mb-8">
        <div className="flex-1">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">
            {isSupplier ? 'Supplier dashboard' : 'Business dashboard'}
          </h1>
          <p className="text-muted font-semibold text-sm mt-1">Welcome back, {user.name}</p>
        </div>
        {!isSupplier && businesses.length > 1 && (
          <select
            value={selectedId ?? ''}
            onChange={(e) => setSelectedId(e.target.value)}
            className="border border-line rounded-full px-5 py-3 font-bold bg-card outline-none"
          >
            {businesses.map((b) => (
              <option key={b._id} value={b._id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        {selected && (
          <Link
            href={`/takeaway/${selected.slug}`}
            className="border-[1.5px] border-ink text-sm font-bold px-5 py-3 rounded-full hover:bg-ink hover:text-surface transition-colors"
          >
            View public profile
          </Link>
        )}
      </div>

      <div className="flex gap-2 mb-7 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-sm font-bold px-5 py-2.5 rounded-full transition-colors cursor-pointer ${
              tab === t ? 'bg-ink text-surface' : 'bg-card border border-line hover:border-primary'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && selected && <OverviewTab business={selected} />}
      {tab === 'Offers' && selected && <OffersTab business={selected} />}
      {tab === 'Promote' && selected && <PromoteTab business={selected} />}
      {tab === 'Billing' && selected && <BillingTab business={selected} />}
      {tab === 'All locations' && <FranchiseTab />}
      {tab === 'Leads' && isSupplier && <LeadsTab />}
    </div>
  );
}
