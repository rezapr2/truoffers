'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { isStaff, useAuth } from '@/lib/auth-context';
import { useSite } from '@/lib/site';
import Logo from './Logo';
import Sidebar from './Sidebar';
import TopNav from './TopNav';
import { CloseIcon, MenuIcon } from './icons';

// The signed-in workspaces get the sidebar layout (supplied by their own layouts); everything else is the public site
const APP_PREFIXES = ['/dashboard', '/admin'];
const ALWAYS_OPEN = ['/login', '/reset-password', '/forgot-password'];

/** Shown on every page while an admin is viewing the site as a business owner (read-only). */
function ImpersonationBanner() {
  const { user, stopImpersonating } = useAuth();
  const router = useRouter();
  if (!user?.impersonatedBy) return null;
  return (
    <div className="sticky top-0 z-[70] bg-ink text-white text-sm font-bold px-5 py-2.5 flex flex-wrap items-center gap-3 justify-center">
      <span>
        Viewing as {user.name} ({user.email}). Read-only: changes are disabled.
      </span>
      <button
        onClick={async () => {
          await stopImpersonating();
          router.push('/admin/businesses');
        }}
        className="bg-sun text-[#43310A] px-3 py-1 rounded-full cursor-pointer"
      >
        Exit
      </button>
    </div>
  );
}

function Maintenance({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-brand-deep hero-pattern text-white flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="flex justify-center mb-8">
          <Logo tone="light" />
        </div>
        <h1 className="font-display text-3xl font-extrabold mb-3">We’ll be right back</h1>
        <p className="text-leaf-soft/85 leading-relaxed">{message}</p>
        <Link href="/login" className="inline-block mt-8 text-sm font-bold text-sun underline underline-offset-4">
          Staff sign-in
        </Link>
      </div>
    </div>
  );
}

/**
 * Public pages sit on a white page under the green top bar. Workspaces (dashboard, admin) render their own
 * frame (WorkspaceFrame) with their own sidebar; both use the same brand tokens.
 */
export default function AppShell({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const site = useSite();
  const [open, setOpen] = useState(false);
  const isWorkspace = APP_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  if (site?.maintenanceMode && !loading && !isStaff(user) && !ALWAYS_OPEN.some((p) => pathname.startsWith(p))) {
    return <Maintenance message={site.maintenanceMessage} />;
  }

  if (isWorkspace) {
    return (
      <>
        <ImpersonationBanner />
        <div className="min-h-screen bg-backdrop">{children}</div>
      </>
    );
  }

  return (
    <div className="theme-public min-h-screen bg-card flex flex-col">
      <ImpersonationBanner />
      <TopNav onOpenMenu={() => setOpen(true)} />
      {open && (
        <div className="lg:hidden fixed inset-0 z-50">
          <button aria-label="Close menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-ink/40 cursor-pointer" />
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
      )}
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
      {footer}
    </div>
  );
}

/**
 * The dashboard and admin canvas: a white rounded panel on the backdrop, the sidebar on the left, and a slide-in
 * drawer for the sidebar below the lg breakpoint.
 */
export function WorkspaceFrame({ sidebar, children }: { sidebar: (close: () => void) => React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <div className="lg:p-6">
      <div className="mx-auto max-w-[1680px] bg-card lg:rounded-4xl lg:shadow-canvas lg:min-h-[calc(100vh-3rem)] lg:flex">
        <aside className="hidden lg:block w-72 flex-none border-r border-line">
          <div className="sticky top-6 h-[calc(100vh-3rem)] overflow-y-auto p-6">{sidebar(() => undefined)}</div>
        </aside>

        <header className="lg:hidden sticky top-0 z-30 bg-card/95 backdrop-blur border-b border-line flex items-center justify-between px-5 h-16">
          <Logo size="sm" />
          <button aria-label="Open menu" onClick={() => setOpen(true)} className="w-10 h-10 rounded-2xl bg-surface flex items-center justify-center cursor-pointer">
            <MenuIcon />
          </button>
        </header>

        {open && (
          <div className="lg:hidden fixed inset-0 z-50">
            <button aria-label="Close menu" onClick={close} className="absolute inset-0 bg-ink/40 cursor-pointer" />
            <div className="absolute inset-y-0 left-0 w-80 max-w-[88vw] bg-card p-6 overflow-y-auto shadow-lg">
              <button aria-label="Close menu" onClick={close} className="absolute top-5 right-4 w-9 h-9 rounded-xl bg-surface flex items-center justify-center cursor-pointer">
                <CloseIcon className="w-4 h-4" />
              </button>
              {sidebar(close)}
            </div>
          </div>
        )}

        <div className="flex-1 min-w-0 flex flex-col">{children}</div>
      </div>
    </div>
  );
}

/** One link in a workspace sidebar. */
export function SideLink({
  href,
  label,
  icon: Icon,
  active,
  badge,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: (p: { className?: string }) => React.ReactNode;
  active: boolean;
  badge?: number | string;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-[14.5px] transition-colors ${
        active ? 'bg-tint-blue text-primary font-extrabold' : 'text-muted-2 hover:text-ink hover:bg-surface font-bold'
      }`}
    >
      <Icon className="w-5 h-5 flex-none" />
      <span className="flex-1 truncate">{label}</span>
      {badge ? (
        <span className="bg-sun text-[#43310A] text-[11px] font-extrabold min-w-5 h-5 px-1.5 rounded-full inline-flex items-center justify-center">{badge}</span>
      ) : null}
    </Link>
  );
}
