'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useBusiness } from '@/lib/business-context';
import { useApi } from '@/lib/hooks';
import VerifiedBadge from '@/components/VerifiedBadge';
import { btn, Spinner, StatStrip, Tag } from '@/components/ui';
import { ClickIcon, EyeIcon, OffersIcon, UsersIcon } from '@/components/icons';
import { DashboardPage } from '../_components/shared';

interface Stats {
  locations: {
    business: { _id: string; name: string; slug: string; town?: string; postcode: string; verificationLevel: number; followerCount: number; activeOfferCount: number; status: string };
    role: string;
    stats: { impressions: number; orderClicks: number; redemptions: number; offerCount: number };
  }[];
  totals: { impressions: number; orderClicks: number; activeOffers: number; followers: number; locations: number } | null;
}

export default function BranchesPage() {
  const { business, select } = useBusiness();
  const router = useRouter();
  const { data } = useApi<Stats>('/businesses/mine/stats');
  if (!data || !business) return <Spinner />;
  return (
    <DashboardPage
      title="Branches"
      subtitle="Every takeaway you’re on the team of. Switch between them here or in the sidebar."
      actions={
        <Link href="/claim-your-business" className={btn.primary}>
          Add a branch
        </Link>
      }
    >
      {data.totals && data.locations.length > 1 && (
        <div className="mb-8">
          <StatStrip
            stats={[
              { icon: OffersIcon, tint: 'blue', label: 'Locations', value: data.totals.locations },
              { icon: OffersIcon, tint: 'mint', label: 'Live offers', value: data.totals.activeOffers },
              { icon: EyeIcon, tint: 'peach', label: 'Impressions (all time)', value: data.totals.impressions },
              { icon: UsersIcon, tint: 'lilac', label: 'Followers', value: data.totals.followers },
            ]}
          />
        </div>
      )}
      <div className="border border-line rounded-3xl overflow-hidden">
        {data.locations.map(({ business: b, role, stats }) => (
          <div key={b._id} className="flex items-center gap-4 px-5 py-4 border-t border-line first:border-t-0 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="font-extrabold flex items-center gap-2 flex-wrap">
                {b.name} {b._id === business._id && <Tag tone="info">Selected</Tag>}
                {b.status !== 'active' && <Tag tone="warn">{b.status === 'pending' ? 'Hidden until verified' : b.status}</Tag>}
              </div>
              <div className="text-[13px] text-muted">
                {b.town} {b.postcode} · <VerifiedBadge level={b.verificationLevel} /> · {role}
              </div>
            </div>
            <div className="text-sm text-muted flex gap-4">
              <span><OffersIcon className="w-4 h-4 inline" /> {b.activeOfferCount}</span>
              <span><EyeIcon className="w-4 h-4 inline" /> {stats.impressions}</span>
              <span><ClickIcon className="w-4 h-4 inline" /> {stats.orderClicks}</span>
            </div>
            {b._id !== business._id && (
              <button
                className={btn.small}
                onClick={() => {
                  select(b._id);
                  router.push('/dashboard');
                }}
              >
                Switch
              </button>
            )}
          </div>
        ))}
      </div>
    </DashboardPage>
  );
}
