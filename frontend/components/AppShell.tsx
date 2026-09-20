'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import Logo from './Logo';
import Sidebar from './Sidebar';
import TopNav from './TopNav';
import { CloseIcon, MenuIcon } from './icons';

// The signed-in workspaces get the sidebar layout; everything else is the public site
const APP_PREFIXES = ['/dashboard', '/admin'];

/**
 * Public pages sit on a plain white page under a top bar, inside `theme-public`, which re-points
 * the shared colour tokens at the green food palette (see globals.css). Workspaces (dashboard,
 * admin) keep the blue scale: a white rounded canvas floating on a grey backdrop, with a sidebar
 * on the left. Below the lg breakpoint the sidebar becomes a slide-in drawer in both cases.
 */
export default function AppShell({
  children,
  footer,
}: {
  children: React.ReactNode;
  /** The marketing footer: rendered on the public site, left off the workspaces. */
  footer?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isWorkspace = APP_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  const drawer = open && (
    <div className="lg:hidden fixed inset-0 z-50">
      <button
        aria-label="Close menu"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-ink/40 cursor-pointer"
      />
      <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-card p-6 overflow-y-auto shadow-lg">
        <button
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="absolute top-5 right-4 w-9 h-9 rounded-xl bg-surface flex items-center justify-center cursor-pointer"
        >
          <CloseIcon className="w-4 h-4" />
        </button>
        <Sidebar onNavigate={() => setOpen(false)} />
      </div>
    </div>
  );

  if (!isWorkspace) {
    return (
      <div className="theme-public min-h-screen bg-card flex flex-col">
        <TopNav onOpenMenu={() => setOpen(true)} />
        {drawer}
        <div className="flex-1 min-w-0 flex flex-col">{children}</div>
        {footer}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-backdrop lg:p-6">
      <div className="mx-auto max-w-[1680px] bg-card lg:rounded-4xl lg:shadow-canvas lg:min-h-[calc(100vh-3rem)] lg:flex">
        <aside className="hidden lg:block w-64 flex-none border-r border-line">
          <div className="sticky top-6 h-[calc(100vh-3rem)] overflow-y-auto p-6">
            <Sidebar />
          </div>
        </aside>

        <header className="lg:hidden sticky top-0 z-30 bg-card/95 backdrop-blur border-b border-line flex items-center justify-between px-5 h-16">
          <Logo size="sm" />
          <button
            aria-label="Open menu"
            onClick={() => setOpen(true)}
            className="w-10 h-10 rounded-2xl bg-surface flex items-center justify-center cursor-pointer"
          >
            <MenuIcon />
          </button>
        </header>

        {drawer}

        <div className="flex-1 min-w-0 flex flex-col">{children}</div>
      </div>
    </div>
  );
}
