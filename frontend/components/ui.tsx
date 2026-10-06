'use client';

import Link from 'next/link';
import { useEffect, useId, type ReactNode } from 'react';
import { CalendarIcon, CloseIcon } from './icons';

// ---------------------------------------------------------------------------------------------------------
// The shared component library for the public site, the business dashboard and the admin panel (spec T1.1).
// ---------------------------------------------------------------------------------------------------------

/** "Hello, Margaret" style title block, with room for actions on the right. */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-7">
      <div className="flex-1 min-w-0">
        <h1 className="font-display text-2xl md:text-[28px] font-extrabold tracking-tight leading-tight">{title}</h1>
        {subtitle && <div className="text-muted text-sm mt-1.5">{subtitle}</div>}
      </div>
      {actions && <div className="flex items-center gap-3 flex-wrap">{actions}</div>}
    </div>
  );
}

/** Today's date beside a calendar button. */
export function DateChip() {
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <div className="hidden md:flex items-center gap-3 text-[13px] font-bold">
      <span suppressHydrationWarning>{today}</span>
      <span className="w-11 h-11 rounded-2xl bg-surface flex items-center justify-center text-ink-soft">
        <CalendarIcon className="w-5 h-5" />
      </span>
    </div>
  );
}

/** Soft segmented tabs: a pale pill marks the active one. */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  counts = {},
}: {
  tabs: readonly { value: T; label: string }[];
  active: T;
  onChange: (value: T) => void;
  counts?: Partial<Record<T, number>>;
}) {
  return (
    <div className="flex gap-2 flex-wrap" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={active === tab.value}
          onClick={() => onChange(tab.value)}
          className={`text-sm font-bold px-4 py-2 rounded-full transition-colors cursor-pointer ${
            active === tab.value ? 'bg-tint-blue text-primary' : 'bg-card border border-line hover:border-primary'
          }`}
        >
          {tab.label}
          {counts[tab.value] ? <span className="ml-1.5 text-[12px] opacity-80">{counts[tab.value]}</span> : null}
        </button>
      ))}
    </div>
  );
}

export interface Stat {
  icon: (p: { className?: string }) => ReactNode;
  tint: 'blue' | 'peach' | 'mint' | 'lilac';
  label: string;
  value: ReactNode;
  /** Small trend note under the value, e.g. "+8 this week" */
  note?: { text: string; tone: 'good' | 'bad' | 'neutral' };
  href?: string;
}

const TINTS = {
  blue: 'bg-tint-blue text-primary',
  peach: 'bg-tint-peach text-star',
  mint: 'bg-tint-mint text-verified',
  lilac: 'bg-tint-lilac text-primary',
};

const NOTE_TONES = { good: 'text-verified', bad: 'text-danger', neutral: 'text-muted' };

/** The row of icon-circle figures with hairline dividers between them. It reflows by its own width. */
export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-2 @2xl:grid-cols-4 gap-y-6 border-y border-line py-5 @2xl:divide-x @2xl:divide-line">
        {stats.map((stat) => {
          const Icon = stat.icon;
          const body = (
            <>
              <span className={`w-11 h-11 rounded-full flex items-center justify-center flex-none ${TINTS[stat.tint]}`}>
                <Icon className="w-5 h-5" />
              </span>
              <div className="min-w-0">
                <div className="text-[13px] text-muted leading-snug">{stat.label}</div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-display text-2xl font-extrabold leading-tight">{stat.value}</span>
                  {stat.note && <span className={`text-[12px] font-bold ${NOTE_TONES[stat.note.tone]}`}>{stat.note.text}</span>}
                </div>
              </div>
            </>
          );
          return stat.href ? (
            <Link key={stat.label} href={stat.href} className="flex items-center gap-3 @2xl:px-5 @2xl:first:pl-0 rounded-2xl hover:bg-surface/60 transition-colors">
              {body}
            </Link>
          ) : (
            <div key={stat.label} className="flex items-center gap-3 @2xl:px-5 @2xl:first:pl-0">
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Buttons -----------------------------------------------------------------------------------------

export const btn = {
  primary: 'btn-soft inline-flex items-center justify-center gap-2 text-sm font-bold px-5 py-2.5 rounded-2xl cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
  secondary:
    'inline-flex items-center justify-center gap-2 text-sm font-bold border border-line bg-card px-4 py-2.5 rounded-2xl hover:border-primary hover:text-primary transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
  small:
    'inline-flex items-center justify-center gap-1.5 text-[13px] font-bold border border-line bg-card px-3.5 py-1.5 rounded-full hover:border-primary hover:text-primary transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
  smallPrimary:
    'btn-soft inline-flex items-center justify-center gap-1.5 text-[13px] font-bold px-3.5 py-1.5 rounded-full cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
  good: 'inline-flex items-center justify-center gap-2 bg-verified text-white text-sm font-bold px-5 py-2.5 rounded-2xl hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
  danger:
    'inline-flex items-center justify-center gap-2 text-sm font-bold text-danger border border-danger/40 bg-card px-4 py-2.5 rounded-2xl hover:bg-danger hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
  smallDanger:
    'inline-flex items-center justify-center gap-1.5 text-[13px] font-bold text-danger border border-danger/40 bg-card px-3.5 py-1.5 rounded-full hover:bg-danger hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
  sun: 'btn-sun inline-flex items-center justify-center gap-2 text-sm font-extrabold px-5 py-2.5 rounded-full cursor-pointer disabled:opacity-50',
  link: 'text-primary font-bold hover:text-primary-dark cursor-pointer disabled:opacity-50',
};

export const inputClass =
  'w-full border border-line rounded-xl px-4 py-2.5 text-[15px] font-semibold outline-none focus:border-primary bg-surface disabled:opacity-60 placeholder:font-normal';

// ---- Layout pieces ------------------------------------------------------------------------------------

export function Card({ children, className = '', padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <div className={`bg-card border border-line rounded-3xl ${padded ? 'p-6' : ''} ${className}`}>{children}</div>;
}

export function SectionTitle({ children, aside, className = '' }: { children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 flex-wrap mb-4 ${className}`}>
      <h2 className="font-display text-lg font-extrabold">{children}</h2>
      {aside}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="bg-surface rounded-3xl px-6 py-10 text-center">
      {title && <div className="font-display font-extrabold text-lg mb-1.5">{title}</div>}
      {children && <div className="text-sm text-muted max-w-md mx-auto leading-relaxed">{children}</div>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

const ALERT_TONES = {
  info: 'bg-tint-blue border-primary/15 text-ink',
  success: 'bg-verified/10 border-verified/25 text-[#145c3c]',
  warning: 'bg-sun-soft/60 border-sun/50 text-[#5e430b]',
  danger: 'bg-danger/10 border-danger/25 text-danger-dark',
};

export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className = '',
}: {
  tone?: keyof typeof ALERT_TONES;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`border rounded-2xl px-5 py-4 text-sm flex flex-col sm:flex-row sm:items-center gap-3 ${ALERT_TONES[tone]} ${className}`}>
      <div className="flex-1 min-w-0">
        {title && <div className="font-extrabold">{title}</div>}
        {children && <div className={title ? 'mt-0.5 font-semibold opacity-90' : 'font-semibold'}>{children}</div>}
      </div>
      {action && <div className="flex-none">{action}</div>}
    </div>
  );
}

/** Shows an action's error and success message, if any. */
export function Feedback({ error, notice, className = '' }: { error?: string | null; notice?: string | null; className?: string }) {
  if (!error && !notice) return null;
  return (
    <div className={className}>
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && !error && <Alert tone="success">{notice}</Alert>}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className = '',
  required,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-sm font-extrabold">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      {children}
      {hint && !error && <span className="text-[12.5px] text-muted leading-snug">{hint}</span>}
      {error && <span className="text-[12.5px] font-bold text-danger">{error}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 w-11 h-6 rounded-full flex-none relative transition-colors cursor-pointer disabled:opacity-50 ${checked ? 'bg-primary' : 'bg-page border border-line'}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
      <label htmlFor={id} className="cursor-pointer">
        <span className="text-sm font-bold block">{label}</span>
        {hint && <span className="text-[12.5px] text-muted block">{hint}</span>}
      </label>
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="py-16 flex flex-col items-center gap-3 text-muted font-bold text-sm" role="status">
      <span className="w-8 h-8 rounded-full border-[3px] border-page border-t-primary animate-spin" />
      {label}
    </div>
  );
}

// ---- Status pills -------------------------------------------------------------------------------------

const PILL_TONES = {
  good: 'bg-verified/10 text-verified',
  warn: 'bg-sun-soft text-[#7a5408]',
  bad: 'bg-danger/10 text-danger',
  info: 'bg-tint-blue text-primary',
  neutral: 'bg-page text-muted-2',
};

const STATUS: Record<string, [label: string, tone: keyof typeof PILL_TONES]> = {
  // Offers
  active: ['Live', 'good'],
  scheduled: ['Scheduled', 'info'],
  pending: ['Pending review', 'warn'],
  draft: ['Draft', 'neutral'],
  paused: ['Paused', 'neutral'],
  expired: ['Expired', 'neutral'],
  rejected: ['Rejected', 'bad'],
  removed: ['Removed', 'bad'],
  hidden_by_reports: ['Hidden: reported', 'bad'],
  possibly_removed: ['Checking', 'warn'],
  expiry_review: ['Expiry review', 'warn'],
  revision_pending: ['Live (change waiting)', 'good'],
  // Claims
  info_requested: ['More info needed', 'warn'],
  approved: ['Approved', 'good'],
  disputed: ['Disputed', 'bad'],
  withdrawn: ['Withdrawn', 'neutral'],
  // Subscriptions and payments
  trialing: ['Trial', 'info'],
  past_due: ['Past due', 'bad'],
  cancelled: ['Cancelled', 'neutral'],
  incomplete: ['Incomplete', 'warn'],
  paid: ['Paid', 'good'],
  open: ['Open', 'warn'],
  failed: ['Failed', 'bad'],
  refunded: ['Refunded', 'neutral'],
  partially_refunded: ['Part refunded', 'neutral'],
  // Promotions
  pending_payment: ['Awaiting payment', 'warn'],
  pending_approval: ['Awaiting approval', 'warn'],
  ended: ['Ended', 'neutral'],
  // Reports
  upheld: ['Upheld', 'bad'],
  // Businesses and users
  suspended: ['Suspended', 'bad'],
  archived: ['Archived', 'neutral'],
  banned: ['Banned', 'bad'],
  deleted: ['Deleted', 'neutral'],
};

export function StatusPill({ status, label, className = '' }: { status: string; label?: string; className?: string }) {
  const [text, tone] = STATUS[status] ?? [status.replace(/_/g, ' '), 'neutral'];
  return (
    <span className={`inline-flex items-center text-[11.5px] font-extrabold px-2.5 py-1 rounded-full whitespace-nowrap ${PILL_TONES[tone]} ${className}`}>
      {label ?? text}
    </span>
  );
}

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: keyof typeof PILL_TONES }) {
  return <span className={`inline-flex items-center text-[11px] font-extrabold px-2 py-0.5 rounded-full whitespace-nowrap ${PILL_TONES[tone]}`}>{children}</span>;
}

// ---- Overlays -----------------------------------------------------------------------------------------

function useEscape(onClose: () => void, open: boolean) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = overflow;
    };
  }, [onClose, open]);
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEscape(onClose, open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/45 cursor-pointer" />
      <div className={`relative bg-card w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-3xl shadow-lg`}>
        <div className="flex items-start gap-4 px-6 pt-6 pb-3">
          <h2 className="flex-1 font-display text-xl font-extrabold leading-snug">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-xl bg-surface flex items-center justify-center cursor-pointer flex-none">
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 pb-6 overflow-y-auto">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-line flex gap-3 justify-end flex-wrap">{footer}</div>}
      </div>
    </div>
  );
}

/** The detail drawer every admin list opens (spec: "every list screen has ... a detail drawer"). */
export function Drawer({ open, onClose, title, subtitle, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEscape(onClose, open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/40 cursor-pointer" />
      <aside className="absolute inset-y-0 right-0 w-full max-w-2xl bg-card shadow-lg flex flex-col">
        <div className="flex items-start gap-4 px-6 pt-6 pb-4 border-b border-line">
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-xl font-extrabold leading-snug break-words">{title}</h2>
            {subtitle && <div className="text-sm text-muted mt-1">{subtitle}</div>}
          </div>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-xl bg-surface flex items-center justify-center cursor-pointer flex-none">
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-line flex gap-3 flex-wrap">{footer}</div>}
      </aside>
    </div>
  );
}

export function Pager({ page, pages, onChange }: { page: number; pages: number; onChange: (page: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 pt-5">
      <button type="button" className={btn.small} disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ← Previous
      </button>
      <span className="text-sm font-bold text-muted">
        Page {page} of {pages}
      </span>
      <button type="button" className={btn.small} disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Next →
      </button>
    </div>
  );
}

/** A label and value row for detail drawers. */
export function Detail({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-4 py-2 border-b border-line last:border-0 text-sm">
      <dt className="w-40 flex-none text-muted font-semibold">{label}</dt>
      <dd className="flex-1 min-w-0 font-semibold break-words">{children}</dd>
    </div>
  );
}
