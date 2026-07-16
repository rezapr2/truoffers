'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import Logo from './Logo';

const NAV = [
  { href: '/offers', label: 'Offers' },
  { href: '/categories', label: 'Categories' },
  { href: '/takeaways', label: 'Takeaways' },
  { href: '/suppliers', label: 'Suppliers' },
  { href: '/pricing', label: 'Pricing' },
];

export default function Header() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const dashboardHref = user
    ? ['super_admin', 'support_admin', 'sales_admin'].includes(user.role)
      ? '/admin'
      : '/dashboard'
    : '/login';

  return (
    <header className="sticky top-0 z-40 bg-surface/95 backdrop-blur border-b border-line">
      <div className="mx-auto max-w-7xl flex items-center gap-8 px-5 md:px-10 py-4">
        <Logo />
        <nav className="hidden md:flex gap-7 text-[15px] font-bold text-ink-soft">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="hover:text-primary transition-colors">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden md:flex items-center gap-4">
          {user ? (
            <>
              {user.followedBusinesses.length > 0 && (
                <span className="inline-flex items-center gap-1.5 text-[15px] font-bold text-ink-soft">
                  Following
                  <span className="bg-primary text-cream text-[11px] font-extrabold px-2 py-0.5 rounded-full">
                    {user.followedBusinesses.length}
                  </span>
                </span>
              )}
              <Link
                href={dashboardHref}
                className="text-[15px] font-bold text-ink-soft hover:text-primary"
              >
                {user.name.split(' ')[0]}
              </Link>
              <button
                onClick={logout}
                className="bg-ink text-surface text-[15px] font-bold px-5 py-2.5 rounded-full hover:bg-primary transition-colors cursor-pointer"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/claim-your-business"
                className="text-[15px] font-bold text-primary hover:text-primary-dark"
              >
                Add your business
              </Link>
              <Link
                href="/login"
                className="bg-ink text-surface text-[15px] font-bold px-5 py-2.5 rounded-full hover:bg-primary transition-colors"
              >
                Log in
              </Link>
            </>
          )}
        </div>
        {/* Mobile burger */}
        <button
          aria-label="Menu"
          onClick={() => setOpen(!open)}
          className="ml-auto md:hidden flex flex-col gap-1 items-center justify-center w-11 h-11 bg-ink rounded-full"
        >
          <span className="w-4 h-0.5 bg-surface rounded" />
          <span className="w-4 h-0.5 bg-surface rounded" />
          <span className="w-4 h-0.5 bg-surface rounded" />
        </button>
      </div>
      {open && (
        <nav className="md:hidden border-t border-line px-5 py-4 flex flex-col gap-3 bg-surface">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="text-[15px] font-bold text-ink-soft"
            >
              {item.label}
            </Link>
          ))}
          {user ? (
            <>
              <Link href={dashboardHref} onClick={() => setOpen(false)} className="text-[15px] font-bold text-primary">
                My dashboard
              </Link>
              <button onClick={() => { logout(); setOpen(false); }} className="text-left text-[15px] font-bold text-ink-soft">
                Log out
              </button>
            </>
          ) : (
            <>
              <Link href="/claim-your-business" onClick={() => setOpen(false)} className="text-[15px] font-bold text-primary">
                Add your business
              </Link>
              <Link href="/login" onClick={() => setOpen(false)} className="text-[15px] font-bold text-ink-soft">
                Log in
              </Link>
            </>
          )}
        </nav>
      )}
    </header>
  );
}
