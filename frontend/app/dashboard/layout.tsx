'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { WorkspaceFrame } from '@/components/AppShell';
import BusinessSidebar from '@/components/BusinessSidebar';
import Logo from '@/components/Logo';
import { btn, Card, Spinner, StatusPill } from '@/components/ui';
import { LogoutIcon } from '@/components/icons';
import { isStaff, useAuth } from '@/lib/auth-context';
import { BusinessProvider, useBusiness } from '@/lib/business-context';
import { useApi } from '@/lib/hooks';
import { date } from '@/lib/format';
import LeadsTab from './LeadsTab';

interface MyClaim {
  _id: string;
  status: string;
  kind: string;
  business?: { name: string; slug: string; town?: string };
  createdAt: string;
  notes?: string;
}

/** Signed in, but not on any business's team yet: claim or add one, and see claims in progress. */
function NoBusiness() {
  const { data: claims } = useApi<MyClaim[]>('/claims/mine');
  const open = (claims ?? []).filter((c) => ['draft', 'pending', 'info_requested', 'disputed'].includes(c.status));
  return (
    <div className="max-w-2xl mx-auto px-5 py-14">
      <h1 className="font-display text-3xl font-extrabold mb-3">Let’s get your takeaway on TruOffers</h1>
      <p className="text-muted mb-8">Claim your listing, or add your takeaway if it isn’t listed yet. We check you run it, then your offers can go live.</p>
      <Link href="/claim-your-business" className={btn.primary}>
        Claim or add your business
      </Link>
      {open.length > 0 && (
        <div className="mt-10">
          <h2 className="font-display text-lg font-extrabold mb-3">Your claims</h2>
          <div className="flex flex-col gap-3">
            {open.map((c) => (
              <Card key={c._id} className="flex items-center gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="font-extrabold">{c.business?.name}</div>
                  <div className="text-[13px] text-muted">Started {date(c.createdAt)}</div>
                </div>
                <StatusPill status={c.status} label={c.status === 'draft' ? 'In progress' : undefined} />
                <Link href={`/claim-your-business?claim=${c._id}`} className={btn.small}>
                  Continue
                </Link>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const { businesses, loading, business } = useBusiness();
  const pathname = usePathname();
  if (loading && !business) return <Spinner />;
  if (businesses.length === 0 && pathname !== '/dashboard/notifications') return <NoBusiness />;
  return <WorkspaceFrame sidebar={(close) => <BusinessSidebar onNavigate={close} />}>{children}</WorkspaceFrame>;
}

/** Suppliers keep their lead inbox (supplier dashboards wait for phase 2). */
function SupplierDashboard() {
  const { logout } = useAuth();
  return (
    <WorkspaceFrame
      sidebar={() => (
        <div className="flex flex-col gap-6 min-h-full">
          <Logo />
          <div className="mt-auto">
            <button onClick={logout} className="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-[14px] font-bold text-muted-2 hover:bg-surface cursor-pointer">
              <LogoutIcon className="w-5 h-5" /> Log out
            </button>
          </div>
        </div>
      )}
    >
      <div className="px-5 md:px-10 py-8">
        <h1 className="font-display text-2xl font-extrabold mb-6">Leads</h1>
        <LeadsTab />
      </div>
    </WorkspaceFrame>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (isStaff(user) && !user.impersonatedBy) router.replace('/admin');
  }, [loading, user, router, pathname]);

  if (loading || !user || (isStaff(user) && !user.impersonatedBy)) return <Spinner />;
  if (user.role === 'supplier') return <SupplierDashboard />;
  return (
    <BusinessProvider>
      <Frame>{children}</Frame>
    </BusinessProvider>
  );
}
