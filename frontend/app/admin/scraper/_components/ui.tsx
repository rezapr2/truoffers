'use client';

import { useCallback, useState } from 'react';

export const btn = {
  primary:
    'bg-primary text-cream text-sm font-bold px-5 py-2.5 rounded-full hover:bg-primary-dark transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
  dark: 'bg-ink text-surface text-sm font-bold px-5 py-2.5 rounded-full hover:bg-primary transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
  good: 'bg-verified text-white text-sm font-bold px-5 py-2.5 rounded-full hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
  outline:
    'text-[13px] font-bold border border-line bg-card px-4 py-2 rounded-full hover:border-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
  danger:
    'text-[13px] font-bold text-primary border border-primary/40 px-4 py-2 rounded-full hover:bg-primary hover:text-cream transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
};

export const inputClass =
  'border border-line rounded-xl px-4 py-2.5 font-semibold outline-none focus:border-primary bg-surface disabled:opacity-60';

const TONES = {
  good: 'bg-verified/10 text-verified',
  warn: 'bg-star/15 text-[#9a6210]',
  bad: 'bg-primary/10 text-primary',
  info: 'bg-ink/10 text-ink',
  neutral: 'bg-page text-muted-2',
};

const STATUS_TONES: Record<string, keyof typeof TONES> = {
  authorised: 'good',
  pending_authorisation: 'warn',
  awaiting_provider_review: 'warn',
  opted_out: 'bad',
  pending_review: 'warn',
  awaiting_merchant_confirmation: 'info',
  approved: 'good',
  rejected: 'bad',
  merged: 'neutral',
  needs_reextraction: 'warn',
  failed_extraction: 'bad',
  auto_matched: 'good',
  confirmed: 'good',
  needs_review: 'warn',
  new_business_proposed: 'warn',
  queued: 'neutral',
  running: 'info',
  delayed: 'warn',
  completed: 'good',
  failed: 'bad',
  cancelled: 'neutral',
  dead_lettered: 'bad',
  allowed: 'good',
  blocked: 'bad',
  unknown: 'warn',
  active: 'good',
  paused: 'neutral',
  removed: 'bad',
  pending: 'warn',
  expired: 'neutral',
  high: 'good',
  review_recommended: 'info',
  manual_investigation: 'warn',
  unverified: 'neutral',
  admin_verified: 'good',
  merchant_verified: 'good',
};

export function humanise(value: string) {
  const text = value.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`text-[11px] font-extrabold uppercase tracking-wide px-2.5 py-1 rounded-full whitespace-nowrap ${TONES[STATUS_TONES[status] ?? 'neutral']}`}>
      {label ?? status.replace(/_/g, ' ')}
    </span>
  );
}

export function ConfidenceBadge({ score, band }: { score: number; band: string }) {
  return (
    <span className={`inline-flex items-baseline gap-1 px-2.5 py-1 rounded-full font-extrabold ${TONES[STATUS_TONES[band] ?? 'bad']}`} title={humanise(band)}>
      <span className="text-sm">{score}</span>
      <span className="text-[10px] uppercase">/100</span>
    </span>
  );
}

export function formatDate(value?: string | null, withTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  return withTime
    ? date.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-card rounded-2xl p-6 ${className}`}>{children}</div>;
}

export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
      <h2 className="font-display text-lg font-extrabold">{children}</h2>
      {aside}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="bg-card rounded-2xl p-10 text-center text-muted font-semibold">{children}</div>;
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="bg-peach-2/40 border border-primary/30 text-primary-dark text-sm font-bold rounded-xl px-4 py-3">{error}</div>
  );
}

// Runs an API call with a busy flag and a readable error, for buttons and small forms.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

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
    <div className="flex gap-2 flex-wrap">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={`text-sm font-bold px-4 py-2 rounded-full transition-colors cursor-pointer ${
            active === tab.value ? 'bg-ink text-surface' : 'bg-card border border-line hover:border-primary'
          }`}
        >
          {tab.label}
          {counts[tab.value] ? ` · ${counts[tab.value]}` : ''}
        </button>
      ))}
    </div>
  );
}

export function Pager({ page, pages, onChange }: { page: number; pages: number; onChange: (page: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 text-sm font-bold">
      <button className={btn.outline} disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ← Previous
      </button>
      <span className="text-muted">
        Page {page} of {pages}
      </span>
      <button className={btn.outline} disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Next →
      </button>
    </div>
  );
}
