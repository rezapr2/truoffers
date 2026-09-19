'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { DateChip, PageHeader } from '@/components/ui';
import { OverviewProvider, useOverview } from './_components/overview';

const ADMIN_ROLES = ['super_admin', 'support_admin', 'sales_admin'];

const NAV = [
  { href: '/admin/scraper', label: 'Overview', exact: true },
  { href: '/admin/scraper/websites', label: 'Websites', badge: 'websites' },
  { href: '/admin/scraper/candidates', label: 'Review queue', badge: 'candidates' },
  { href: '/admin/scraper/offers', label: 'Imported offers', badge: 'importedOffers' },
  { href: '/admin/scraper/network', label: 'Network' },
  { href: '/admin/scraper/adapters', label: 'Adapters' },
  { href: '/admin/scraper/fingerprints', label: 'Templates' },
  { href: '/admin/scraper/outreach', label: 'Claim invitations' },
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
    importedOffers: (overview?.importedOffers?.revision_pending ?? 0) + (overview?.importedOffers?.expiry_review ?? 0),
  };

  return (
    <nav className="flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0 lg:bg-surface lg:rounded-3xl lg:p-3 lg:sticky lg:top-8 lg:self-start">
      {NAV.map((item) => {
        const active = 'exact' in item ? pathname === item.href : pathname.startsWith(item.href);
        const count = 'badge' in item ? badges[item.badge] : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`text-sm font-bold px-4 py-2.5 rounded-2xl transition-colors whitespace-nowrap flex items-center justify-between gap-3 ${
              active ? 'bg-card text-primary shadow-sm' : 'text-ink-soft hover:bg-card/70'
            }`}
          >
            {item.label}
            {count > 0 && (
              <span className="bg-tint-blue text-primary text-[11px] font-extrabold min-w-5 h-5 px-1.5 rounded-full inline-flex items-center justify-center">
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function HaltBanner() {
  const { overview } = useOverview();
  if (!overview?.halted) return null;
  return (
    <div className="bg-danger text-white rounded-2xl px-6 py-4 mb-6 font-bold flex flex-col sm:flex-row sm:items-center gap-3">
      <span className="flex-1">Emergency stop is active: no website is being crawled.</span>
      <Link href="/admin/scraper/jobs" className="underline underline-offset-4 whitespace-nowrap">
        Review and resume
      </Link>
    </div>
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
      <div className="mx-auto max-w-7xl px-5 md:px-10 py-8">
        <PageHeader
          title="Website import robot"
          subtitle={
            <Link href="/admin" className="hover:text-primary">
              ← Admin panel
            </Link>
          }
          actions={<DateChip />}
        />
        <HaltBanner />
        <div className="grid lg:grid-cols-[220px_minmax(0,1fr)] gap-x-8 gap-y-6">
          <ScraperNav />
          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </OverviewProvider>
  );
}
