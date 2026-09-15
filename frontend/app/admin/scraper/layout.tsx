'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { OverviewProvider, useOverview } from './_components/overview';

const ADMIN_ROLES = ['super_admin', 'support_admin', 'sales_admin'];

const NAV = [
  { href: '/admin/scraper', label: 'Overview', exact: true },
  { href: '/admin/scraper/websites', label: 'Websites', badge: 'websites' },
  { href: '/admin/scraper/candidates', label: 'Review queue', badge: 'candidates' },
  { href: '/admin/scraper/jobs', label: 'Jobs' },
  { href: '/admin/scraper/policies', label: 'Policies & opt-outs', badge: 'optOuts' },
  { href: '/admin/scraper/audit', label: 'Audit log' },
  { href: '/admin/scraper/settings', label: 'Settings' },
] as const;

function ScraperNav() {
  const pathname = usePathname();
  const { overview } = useOverview();
  const badges: Record<string, number> = {
    websites: (overview?.domainsPendingAuthorisation ?? 0) + (overview?.websitesAwaitingProviderReview ?? 0),
    candidates: (overview?.candidatesAwaitingReview ?? 0) + (overview?.branchesAwaitingMatch ?? 0),
    optOuts: overview?.unacknowledgedRemovalRequests ?? 0,
  };

  return (
    <>
      {overview?.halted && (
        <div className="bg-primary text-cream rounded-2xl px-6 py-4 mb-6 font-bold flex flex-col sm:flex-row sm:items-center gap-3">
          <span className="flex-1">Emergency stop is active: no website is being crawled.</span>
          <Link href="/admin/scraper/jobs" className="underline underline-offset-4 whitespace-nowrap">
            Review and resume
          </Link>
        </div>
      )}
      <nav className="flex gap-2 mb-8 flex-wrap">
        {NAV.map((item) => {
          const active = 'exact' in item ? pathname === item.href : pathname.startsWith(item.href);
          const count = 'badge' in item ? badges[item.badge] : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`text-sm font-bold px-4 py-2 rounded-full transition-colors ${
                active ? 'bg-ink text-surface' : 'bg-card border border-line hover:border-primary'
              }`}
            >
              {item.label}
              {count > 0 && <span className={`ml-1.5 ${active ? 'text-peach' : 'text-primary'}`}>{count}</span>}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export default function ScraperAdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.push(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, user, router, pathname]);

  if (loading || !user) return <div className="py-24 text-center text-muted font-bold">Loading…</div>;
  if (!ADMIN_ROLES.includes(user.role)) {
    return (
      <div className="py-24 text-center">
        <h1 className="font-display text-2xl font-extrabold">Admin access required</h1>
      </div>
    );
  }

  return (
    <OverviewProvider>
      <div className="mx-auto max-w-6xl px-5 md:px-10 py-8">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
          <div>
            <Link href="/admin" className="text-[13px] font-bold text-muted hover:text-primary">
              ← Admin panel
            </Link>
            <h1 className="font-display text-3xl font-extrabold tracking-tight">Website import robot</h1>
          </div>
        </div>
        <ScraperNav />
        {children}
      </div>
    </OverviewProvider>
  );
}
