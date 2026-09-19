'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import type { Business } from '@/lib/types';
import { DateChip, PageHeader, Tabs } from '@/components/ui';
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
    if (user.role === 'supplier') return;
    void api<Business[]>('/businesses/mine')
      .then((list) => {
        setBusinesses(list);
        if (list.length > 0) setSelectedId(list[0]._id);
      })
      .finally(() => setLoaded(true));
  }, [user, router]);

  if (loading || !user || !(loaded || user.role === 'supplier')) {
    return <div className="py-24 text-center text-muted font-bold">Loading…</div>;
  }

  const isSupplier = user.role === 'supplier';
  const activeTab = isSupplier ? 'Leads' : tab;
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
          className="btn-soft inline-block font-bold px-8 py-3.5 rounded-2xl"
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
    <div className="mx-auto max-w-7xl px-5 md:px-10 py-8">
      <PageHeader
        title={`Hello, ${user.name.split(' ')[0]}`}
        subtitle={
          isSupplier
            ? 'Leads from takeaways appear here as they come in.'
            : 'Here is how your takeaway is doing on TruOffers.'
        }
        actions={
          <>
            {!isSupplier && businesses.length > 1 && (
              <select
                value={selectedId ?? ''}
                onChange={(e) => setSelectedId(e.target.value)}
                aria-label="Business"
                className="bg-surface rounded-xl px-4 py-2.5 text-sm font-bold outline-none cursor-pointer"
              >
                {businesses.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
            <DateChip />
          </>
        }
      />

      <div className="mb-7">
        <Tabs tabs={tabs.map((t) => ({ value: t, label: t }))} active={activeTab} onChange={setTab} />
      </div>

      {activeTab === 'Overview' && selected && <OverviewTab business={selected} />}
      {activeTab === 'Offers' && selected && <OffersTab business={selected} />}
      {activeTab === 'Promote' && selected && <PromoteTab business={selected} />}
      {activeTab === 'Billing' && selected && <BillingTab business={selected} />}
      {activeTab === 'All locations' && <FranchiseTab />}
      {activeTab === 'Leads' && isSupplier && <LeadsTab />}
    </div>
  );
}
