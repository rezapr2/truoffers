'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import Logo from './Logo';
import { MenuIcon } from './icons';
import { ADMIN_ROLES, NAV, isNavActive } from './nav';

// Home is the logo; the top bar lists the sections.
const LINKS = NAV.filter((item) => item.href !== '/');

/** The public site's navigation: a top bar inside the rounded canvas. */
export default function TopNav({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();

  const dashboardHref = user && ADMIN_ROLES.includes(user.role) ? '/admin' : '/dashboard';
  const followed = user?.followedBusinesses.length ?? 0;

  return (
    <header className="sticky top-0 z-30 bg-card/95 backdrop-blur border-b border-line">
      <div className="mx-auto max-w-7xl flex items-center gap-8 px-5 md:px-10 h-16 lg:h-20">
        <Logo />

        <nav className="hidden lg:flex items-center gap-1">
          {LINKS.map((item) => {
            const active = isNavActive(item, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`text-[15px] px-4 py-2 rounded-full transition-colors ${
                  active ? 'bg-surface text-ink font-extrabold' : 'text-muted hover:text-ink font-bold'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto hidden lg:flex items-center gap-3">
          {user ? (
            <>
              {followed > 0 && (
                <span className="text-[14px] font-bold text-ink-soft inline-flex items-center gap-2">
                  Following
                  <span className="bg-tint-blue text-primary text-[11px] font-extrabold min-w-5 h-5 px-1.5 rounded-full inline-flex items-center justify-center">
                    {followed}
                  </span>
                </span>
              )}
              <Link
                href={dashboardHref}
                className="text-[14px] font-bold bg-surface px-4 py-2.5 rounded-2xl hover:text-primary transition-colors"
              >
                {user.name.split(' ')[0]}
              </Link>
              <button
                onClick={logout}
                className="text-[14px] font-bold border border-line px-4 py-2.5 rounded-2xl hover:border-primary hover:text-primary transition-colors cursor-pointer"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/claim-your-business"
                className="text-[14px] font-bold text-primary hover:text-primary-dark px-2"
              >
                Add your business
              </Link>
              <Link href="/login" className="btn-soft text-[14px] font-bold px-6 py-2.5 rounded-2xl">
                Log in
              </Link>
            </>
          )}
        </div>

        <button
          aria-label="Open menu"
          onClick={onOpenMenu}
          className="ml-auto lg:hidden w-10 h-10 rounded-2xl bg-surface flex items-center justify-center cursor-pointer"
        >
          <MenuIcon />
        </button>
      </div>
    </header>
  );
}
