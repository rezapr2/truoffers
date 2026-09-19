import type { ReactNode } from 'react';
import { CalendarIcon } from './icons';

/** "Hello, Margaret" style title block, with room for actions on the right. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-7">
      <div className="flex-1 min-w-0">
        <h1 className="font-display text-2xl md:text-[28px] font-extrabold tracking-tight leading-tight">{title}</h1>
        {subtitle && <p className="text-muted text-sm mt-1.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-3 flex-wrap">{actions}</div>}
    </div>
  );
}

/** Today's date beside a calendar button, as at the top of the reference dashboard. */
export function DateChip() {
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <div className="flex items-center gap-3 text-[13px] font-bold">
      <span suppressHydrationWarning>{today}</span>
      <span className="w-11 h-11 rounded-2xl bg-surface flex items-center justify-center text-ink-soft">
        <CalendarIcon className="w-5 h-5" />
      </span>
    </div>
  );
}

/** Soft segmented tabs: a pale blue pill marks the active one. */
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
          role="tab"
          aria-selected={active === tab.value}
          onClick={() => onChange(tab.value)}
          className={`text-sm font-bold px-4 py-2 rounded-full transition-colors cursor-pointer ${
            active === tab.value
              ? 'bg-tint-blue text-primary'
              : 'bg-card border border-line hover:border-primary'
          }`}
        >
          {tab.label}
          {counts[tab.value] ? ` · ${counts[tab.value]}` : ''}
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
  /** Small trend note under the value, e.g. "+8 tasks" */
  note?: { text: string; tone: 'good' | 'bad' | 'neutral' };
}

const TINTS = {
  blue: 'bg-tint-blue text-primary',
  peach: 'bg-tint-peach text-star',
  mint: 'bg-tint-mint text-verified',
  lilac: 'bg-tint-lilac text-primary',
};

const NOTE_TONES = { good: 'text-verified', bad: 'text-danger', neutral: 'text-muted' };

/** The row of icon-circle figures with hairline dividers between them. It reflows by its own width, not the window's. */
export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-2 @2xl:grid-cols-4 gap-y-6 border-y border-line py-5 @2xl:divide-x @2xl:divide-line">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="flex items-center gap-3 @2xl:px-5 @2xl:first:pl-0">
              <span className={`w-11 h-11 rounded-full flex items-center justify-center flex-none ${TINTS[stat.tint]}`}>
                <Icon className="w-5 h-5" />
              </span>
              <div className="min-w-0">
                <div className="text-[13px] text-muted leading-snug">{stat.label}</div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-display text-2xl font-extrabold leading-tight">{stat.value}</span>
                  {stat.note && (
                    <span className={`text-[12px] font-bold ${NOTE_TONES[stat.note.tone]}`}>{stat.note.text}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
