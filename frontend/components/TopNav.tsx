'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import Logo from './Logo';
import { MenuIcon } from './icons';
import { ADMIN_ROLES, NAV, isNavActive } from './nav';

// Home is the logo; the top bar lists the sections.
const LINKS = NAV.filter((item) => item.href !== '/');

/** The public site's navigation: the green bar the reference carries across the whole site. */
export default function TopNav({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const dashboardHref = user && ADMIN_ROLES.includes(user.role) ? '/admin' : '/dashboard';
  const followed = user?.followedBusinesses.length ?? 0;

  return (
    <header className="sticky top-0 z-30 bg-brand-deep text-white">
      <div className="mx-auto max-w-7xl flex items-center gap-8 px-5 md:px-10 h-16 lg:h-20">
        <Logo tone="light" />

        <nav className="hidden lg:flex items-center gap-1">
          {LINKS.map((item) => {
            const active = isNavActive(item, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`text-[15px] px-4 py-2 rounded-full transition-colors ${
                  active
                    ? 'bg-white/12 text-white font-extrabold'
                    : 'text-leaf-soft/80 hover:text-white font-bold'
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
                <Link
                  href="/takeaways"
                  className="text-[14px] font-bold inline-flex items-center gap-2 text-leaf-soft/85 hover:text-white"
                >
                  Following
                  <span
                    className="text-[11px] font-extrabold min-w-5 h-5 px-1.5 rounded-full inline-flex items-center justify-center bg-sun text-[#43310A]"
                  >
                    {followed}
                  </span>
                </Link>
              )}
              <Link
                href={dashboardHref}
                className="text-[14px] font-bold px-4 py-2.5 rounded-2xl transition-colors bg-white/12 text-white hover:bg-white/20"
              >
                {user.name.split(' ')[0]}
              </Link>
              <button
                onClick={logout}
                className="text-[14px] font-bold px-4 py-2.5 rounded-2xl border transition-colors cursor-pointer border-white/30 text-white hover:bg-white hover:text-brand-deep"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/claim-your-business"
                className="text-[14px] font-bold px-2 text-sun hover:text-sun-soft"
              >
                Add your business
              </Link>
              <Link
                href="/login"
                className="text-[14px] font-extrabold px-6 py-2.5 rounded-full transition-colors border-[1.5px] border-white/50 text-white hover:bg-white hover:text-brand-deep"
              >
                Log in
              </Link>
            </>
          )}
        </div>

        <button
          aria-label="Open menu"
          onClick={onOpenMenu}
          className="ml-auto lg:hidden w-10 h-10 rounded-2xl flex items-center justify-center cursor-pointer bg-white/12 text-white"
        >
          <MenuIcon />
        </button>
      </div>
    </header>
  );
}
