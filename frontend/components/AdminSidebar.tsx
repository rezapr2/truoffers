'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { can, useAuth } from '@/lib/auth-context';
import { humanise } from '@/lib/format';
import Logo from './Logo';
import { SideLink } from './AppShell';
import {
  BadgeCheckIcon,
  CardIcon,
  DashboardIcon,
  FileIcon,
  FlagIcon,
  LayersIcon,
  LayoutIcon,
  LogoutIcon,
  MailIcon,
  MegaphoneIcon,
  OffersIcon,
  PricingIcon,
  RobotIcon,
  SettingsIcon,
  ShieldIcon,
  StoreIcon,
  TagIcon,
  UsersIcon,
} from './icons';

interface Queues {
  claimsWaiting: number;
  pendingProfileChanges: number;
  offersWaiting: number;
  reportsOpen: number;
  suspensionReviews: number;
}

interface Item {
  href: string;
  label: string;
  icon: (p: { className?: string }) => React.ReactNode;
  capability: string;
  badge?: (q: Queues) => number;
  exact?: boolean;
}

// Spec "Super admin panel": the existing overview and import robot plus the new modules, in one sidebar.
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Run the site',
    items: [
      { href: '/admin', label: 'Overview', icon: DashboardIcon, capability: 'admin.panel', exact: true },
      { href: '/admin/claims', label: 'Verification queue', icon: BadgeCheckIcon, capability: 'claims.review', badge: (q) => q.claimsWaiting + q.pendingProfileChanges },
      { href: '/admin/offers', label: 'Offer moderation', icon: OffersIcon, capability: 'offers.moderate', badge: (q) => q.offersWaiting },
      { href: '/admin/reports', label: 'Reports & flags', icon: FlagIcon, capability: 'reports.review', badge: (q) => q.reportsOpen },
      { href: '/admin/businesses', label: 'Businesses', icon: StoreIcon, capability: 'admin.panel', badge: (q) => q.suspensionReviews },
      { href: '/admin/users', label: 'Users', icon: UsersIcon, capability: 'users.view' },
    ],
  },
  {
    title: 'Money',
    items: [
      { href: '/admin/plans', label: 'Plans & pricing', icon: PricingIcon, capability: 'plans.manage' },
      { href: '/admin/promotions', label: 'Promotions', icon: MegaphoneIcon, capability: 'admin.panel' },
      { href: '/admin/billing', label: 'Subscriptions & payments', icon: CardIcon, capability: 'billing.view' },
      { href: '/admin/coupons', label: 'Coupons', icon: TagIcon, capability: 'coupons.manage' },
    ],
  },
  {
    title: 'Site',
    items: [
      { href: '/admin/taxonomy', label: 'Categories & cities', icon: LayersIcon, capability: 'taxonomy.manage' },
      { href: '/admin/content', label: 'Content', icon: LayoutIcon, capability: 'content.manage' },
      { href: '/admin/notifications', label: 'Emails & notifications', icon: MailIcon, capability: 'templates.manage' },
      { href: '/admin/scraper', label: 'Import robot', icon: RobotIcon, capability: 'scraper' },
    ],
  },
  {
    title: 'Admin',
    items: [
      { href: '/admin/team', label: 'Admin team', icon: ShieldIcon, capability: 'team.manage' },
      { href: '/admin/audit', label: 'Audit log', icon: FileIcon, capability: 'audit.view' },
      { href: '/admin/settings', label: 'Settings', icon: SettingsIcon, capability: 'settings.manage' },
    ],
  },
];

export default function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [queues, setQueues] = useState<Queues | null>(null);

  useEffect(() => {
    void api<{ queues: Queues }>('/admin/overview')
      .then((o) => setQueues(o.queues))
      .catch(() => {});
  }, [pathname]);

  const active = (item: Item) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`));

  return (
    <div className="flex flex-col min-h-full gap-5">
      <div className="px-2 pt-1">
        <Logo />
        <div className="text-[12px] font-bold text-muted mt-2 px-1">
          {user?.name} · {humanise(user?.role)}
        </div>
      </div>
      {GROUPS.map((group) => {
        const items = group.items.filter((item) => can(user, item.capability));
        if (!items.length) return null;
        return (
          <nav key={group.title} className="flex flex-col gap-0.5">
            <div className="text-[11px] font-extrabold uppercase tracking-wide text-muted px-3.5 mb-1">{group.title}</div>
            {items.map((item) => (
              <SideLink key={item.href} href={item.href} label={item.label} icon={item.icon} active={active(item)} badge={queues && item.badge ? item.badge(queues) || undefined : undefined} onNavigate={onNavigate} />
            ))}
          </nav>
        );
      })}
      <div className="mt-auto pt-4 border-t border-line">
        <button onClick={logout} className="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-[14px] font-bold text-muted-2 hover:text-ink hover:bg-surface cursor-pointer w-full text-left">
          <LogoutIcon className="w-5 h-5" /> Log out
        </button>
      </div>
    </div>
  );
}
