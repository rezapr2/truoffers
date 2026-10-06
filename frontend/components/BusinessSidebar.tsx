'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useBusiness } from '@/lib/business-context';
import Logo from './Logo';
import { SideLink } from './AppShell';
import VerifiedBadge from './VerifiedBadge';
import {
  BadgeCheckIcon,
  BellIcon,
  BranchIcon,
  CardIcon,
  ChartIcon,
  DashboardIcon,
  ExternalIcon,
  FlagIcon,
  HelpIcon,
  LogoutIcon,
  MegaphoneIcon,
  OffersIcon,
  PlusIcon,
  StoreIcon,
  UsersIcon,
} from './icons';

interface Item {
  href: string;
  label: string;
  icon: (p: { className?: string }) => React.ReactNode;
  ownerOnly?: boolean;
  exact?: boolean;
}

// Spec "Business dashboard (Gumtree-style)": everything sits in the left sidebar; My offers is the centre.
const ITEMS: Item[] = [
  { href: '/dashboard', label: 'Home', icon: DashboardIcon, exact: true },
  { href: '/dashboard/offers', label: 'My offers', icon: OffersIcon, exact: true },
  { href: '/dashboard/offers/new', label: 'Post an offer', icon: PlusIcon },
  { href: '/dashboard/promote', label: 'Promote', icon: MegaphoneIcon, ownerOnly: true },
  { href: '/dashboard/profile', label: 'Business profile', icon: StoreIcon },
  { href: '/dashboard/verification', label: 'Verification', icon: BadgeCheckIcon },
  { href: '/dashboard/billing', label: 'Plan and billing', icon: CardIcon, ownerOnly: true },
  { href: '/dashboard/insights', label: 'Insights', icon: ChartIcon },
  { href: '/dashboard/team', label: 'Team', icon: UsersIcon },
  { href: '/dashboard/branches', label: 'Branches', icon: BranchIcon },
  { href: '/dashboard/reports', label: 'Customer reports', icon: FlagIcon },
  { href: '/dashboard/notifications', label: 'Notifications', icon: BellIcon },
];

export default function BusinessSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { logout } = useAuth();
  const { businesses, business, select, isOwner, manage } = useBusiness();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    void api<{ count: number }>('/notifications/unread-count').then((r) => setUnread(r.count)).catch(() => {});
  }, [pathname]);

  const items = ITEMS.filter((item) => !item.ownerOnly || isOwner || manage?.myRole === 'staff_override');
  const active = (item: Item) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`));

  return (
    <div className="flex flex-col min-h-full gap-6">
      <div className="px-2 pt-1">
        <Logo />
      </div>

      {business && (
        <div className="bg-surface rounded-3xl p-4">
          <div className="text-[11px] font-extrabold uppercase tracking-wide text-muted mb-1">Your business</div>
          {businesses.length > 1 ? (
            <select
              aria-label="Switch business"
              value={business._id}
              onChange={(e) => {
                select(e.target.value);
                onNavigate?.();
              }}
              className="w-full bg-card border border-line rounded-xl px-3 py-2 text-sm font-extrabold outline-none cursor-pointer"
            >
              {businesses.map((b) => (
                <option key={b._id} value={b._id}>
                  {b.name}
                  {b.town ? ` · ${b.town}` : ''}
                </option>
              ))}
            </select>
          ) : (
            <div className="font-display font-extrabold text-[16px] leading-snug truncate">{business.name}</div>
          )}
          <div className="mt-2 flex items-center gap-2 flex-wrap text-[12.5px]">
            <VerifiedBadge level={business.verificationLevel} />
            {business.verificationLevel === 1 && <span className="text-[#7a5408] font-bold">· Claim in review</span>}
          </div>
          {manage && <div className="text-[12px] text-muted mt-1">{manage.plan.name} plan</div>}
        </div>
      )}

      <nav className="flex flex-col gap-1">
        {items.map((item) => (
          <SideLink
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            active={active(item)}
            badge={item.href === '/dashboard/notifications' && unread ? unread : undefined}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-1 pt-4 border-t border-line">
        {business?.status === 'active' && (
          <Link href={`/takeaway/${business.slug}`} onClick={onNavigate} className="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-[14px] font-bold text-muted-2 hover:text-ink hover:bg-surface">
            <ExternalIcon className="w-5 h-5" /> View public page
          </Link>
        )}
        <Link href="/help" onClick={onNavigate} className="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-[14px] font-bold text-muted-2 hover:text-ink hover:bg-surface">
          <HelpIcon className="w-5 h-5" /> Help
        </Link>
        <button onClick={logout} className="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-[14px] font-bold text-muted-2 hover:text-ink hover:bg-surface cursor-pointer text-left">
          <LogoutIcon className="w-5 h-5" /> Log out
        </button>
      </div>
    </div>
  );
}
