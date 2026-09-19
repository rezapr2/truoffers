import type { ReactNode } from 'react';
import { CategoriesIcon, HomeIcon, OffersIcon, PricingIcon, StoreIcon, TruckIcon } from './icons';

export const ADMIN_ROLES = ['super_admin', 'support_admin', 'sales_admin'];

export interface NavItem {
  href: string;
  label: string;
  icon: (p: { className?: string }) => ReactNode;
  // Path prefixes that keep the item highlighted, e.g. an offer page still belongs to "Offers"
  match: string[];
}

export const NAV: NavItem[] = [
  { href: '/', label: 'Home', icon: HomeIcon, match: [] },
  { href: '/offers', label: 'Offers', icon: OffersIcon, match: ['/offers', '/offer/'] },
  { href: '/categories', label: 'Categories', icon: CategoriesIcon, match: ['/categories'] },
  { href: '/takeaways', label: 'Takeaways', icon: StoreIcon, match: ['/takeaways', '/takeaway/'] },
  { href: '/suppliers', label: 'Suppliers', icon: TruckIcon, match: ['/suppliers'] },
  { href: '/pricing', label: 'Pricing', icon: PricingIcon, match: ['/pricing'] },
];

export const isNavActive = (item: NavItem, pathname: string) =>
  item.href === '/' ? pathname === '/' : item.match.some((prefix) => pathname.startsWith(prefix));
