'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import Logo from './Logo';
import { DashboardIcon, HelpIcon, LoginIcon, LogoutIcon, ShieldIcon } from './icons';
import { ADMIN_ROLES, NAV, isNavActive, type NavItem } from './nav';

const itemClass = (active: boolean) =>
  `flex items-center gap-3.5 px-3.5 py-2.5 rounded-2xl text-[15px] transition-colors cursor-pointer w-full text-left ${
    active
      ? 'bg-surface text-ink font-extrabold'
      : 'text-muted hover:text-ink hover:bg-surface/70 font-bold'
  }`;

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();

  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);
  // Owners and suppliers already have their business; the invitation is for everyone else
  const showPromo = !user || user.role === 'customer';
  const followed = user?.followedBusinesses.length ?? 0;

  const accountItem: NavItem | null = user
    ? {
        href: isAdmin ? '/admin' : '/dashboard',
        label: isAdmin ? 'Admin' : 'Dashboard',
        icon: isAdmin ? ShieldIcon : DashboardIcon,
        match: [isAdmin ? '/admin' : '/dashboard'],
      }
    : null;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3.5 pt-1 pb-8">
        <Logo />
      </div>

      <nav className="flex flex-col gap-1">
        {[...NAV, ...(accountItem ? [accountItem] : [])].map((item) => {
          const Icon = item.icon;
          const active = isNavActive(item, pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={itemClass(active)}
            >
              <Icon className="w-5 h-5 flex-none" />
              <span className="flex-1">{item.label}</span>
              {item.href === '/takeaways' && followed > 0 && (
                <span
                  title="Takeaways you follow"
                  className="bg-tint-blue text-primary text-[11px] font-extrabold min-w-5 h-5 px-1.5 rounded-full inline-flex items-center justify-center"
                >
                  {followed}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-1 pt-8">
        {showPromo && (
          <div className="bg-surface rounded-3xl p-5 mb-5 text-center">
            <div className="font-display font-extrabold text-[15px] mb-1.5">Own a takeaway?</div>
            <p className="text-[12px] text-muted leading-relaxed mb-4">
              List your business and post offers to hungry locals, free.
            </p>
            <Link
              href="/claim-your-business"
              onClick={onNavigate}
              className="btn-soft block whitespace-nowrap text-[13px] font-extrabold px-4 py-2.5 rounded-2xl"
            >
              Add your business
            </Link>
          </div>
        )}

        <Link href="/contact" onClick={onNavigate} className={itemClass(pathname.startsWith('/contact'))}>
          <HelpIcon className="w-5 h-5 flex-none" />
          Help &amp; information
        </Link>
        {user ? (
          <button
            onClick={() => {
              logout();
              onNavigate?.();
            }}
            className={itemClass(false)}
          >
            <LogoutIcon className="w-5 h-5 flex-none" />
            Log out
          </button>
        ) : (
          <Link href="/login" onClick={onNavigate} className={itemClass(pathname.startsWith('/login'))}>
            <LoginIcon className="w-5 h-5 flex-none" />
            Log in
          </Link>
        )}
      </div>
    </div>
  );
}
