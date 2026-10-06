'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { download, errorMessage } from '@/lib/api';
import { can, useAuth } from '@/lib/auth-context';
import { Alert, btn, inputClass, PageHeader } from '@/components/ui';
import { DownloadIcon, SearchIcon } from '@/components/icons';

export function AdminPage({ title, subtitle, actions, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="px-5 md:px-10 py-8 w-full max-w-[1400px]">
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      {children}
    </div>
  );
}

/** Shown instead of a module the caller's role doesn't include. */
export function RequireCapability({ capability, children }: { capability: string; children: ReactNode }) {
  const { user } = useAuth();
  if (!can(user, capability)) {
    return (
      <AdminPage title="Not available">
        <Alert tone="info">Your role doesn’t include this part of the admin panel. Ask a super admin if you need it.</Alert>
      </AdminPage>
    );
  }
  return <>{children}</>;
}

export interface FilterDef {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

/**
 * The bar above every admin list (spec: "search, filters, bulk actions, CSV export").
 */
export function ListToolbar({
  search,
  onSearch,
  placeholder = 'Search…',
  filters = [],
  values,
  onFilter,
  csvPath,
  csvName,
  children,
}: {
  search?: string;
  onSearch?: (value: string) => void;
  placeholder?: string;
  filters?: FilterDef[];
  values?: Record<string, string>;
  onFilter?: (key: string, value: string) => void;
  csvPath?: string;
  csvName?: string;
  children?: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3 mb-5">
      <div className="flex gap-2 flex-wrap items-center">
        {onSearch && (
          <label className="relative flex-1 min-w-[220px] max-w-md">
            <SearchIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={search ?? ''} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder} className={`${inputClass} pl-10`} aria-label="Search" />
          </label>
        )}
        {filters.map((f) => (
          <select
            key={f.key}
            aria-label={f.label}
            value={values?.[f.key] ?? ''}
            onChange={(e) => onFilter?.(f.key, e.target.value)}
            className="bg-surface border border-line rounded-xl px-3 py-2.5 text-sm font-bold outline-none cursor-pointer"
          >
            <option value="">{f.label}: all</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ))}
        {children}
        {csvPath && (
          <button
            className={`${btn.secondary} ml-auto`}
            onClick={async () => {
              setError(null);
              try {
                await download(csvPath, csvName ?? 'export.csv');
              } catch (err) {
                setError(errorMessage(err));
              }
            }}
          >
            <DownloadIcon className="w-4 h-4" /> Export CSV
          </button>
        )}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}

/** Builds a query string from non-empty values. */
export function qs(values: Record<string, string | number | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`text-left px-4 py-3 text-[12px] font-extrabold uppercase tracking-wide text-muted whitespace-nowrap ${className}`}>{children}</th>;
}

export function Td({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}

export function Table({ children, minWidth = 760 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="border border-line rounded-3xl overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="text-sm">
      {items.map(([k, v], i) => (
        <div key={i} className="flex gap-4 py-2 border-b border-line last:border-0">
          <dt className="w-40 flex-none text-muted font-semibold">{k}</dt>
          <dd className="flex-1 min-w-0 font-semibold break-words">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface AuditEntry {
  _id: string;
  action: string;
  targetType?: string;
  targetId?: string;
  actor: { kind: string; userId?: { _id: string; name?: string; email?: string } | null; role?: string; component?: string; ip?: string };
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  note?: string;
  createdAt: string;
}

export function actorName(actor: AuditEntry['actor']): string {
  return actor.userId?.name ?? actor.userId?.email ?? actor.component ?? actor.kind;
}

function showValue(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null || value === '') return 'empty';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Before → after, field by field. */
export function AuditDiff({ before, after }: { before?: Record<string, unknown>; after?: Record<string, unknown> }) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  if (!keys.length) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-0.5 text-[12.5px]">
      {keys.map((key) => (
        <div key={key} className="break-all">
          <span className="font-bold text-muted">{key}: </span>
          {before && key in before && (
            <>
              <span className="line-through text-muted">{showValue(before[key])}</span>
              {' → '}
            </>
          )}
          <span className="font-semibold">{after && key in after ? showValue(after[key]) : '—'}</span>
        </div>
      ))}
    </div>
  );
}

/** The audit trail shown in detail drawers (spec T1.4). */
export function AuditTrail({ entries }: { entries: AuditEntry[] }) {
  if (!entries.length) return <p className="text-sm text-muted">No recorded changes yet.</p>;
  return (
    <ol className="flex flex-col gap-3">
      {entries.map((e) => (
        <li key={e._id} className="border-l-2 border-line pl-3">
          <div className="text-sm font-bold">{e.action}</div>
          <div className="text-[12px] text-muted">
            {actorName(e.actor)} · {new Date(e.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>
          {e.note && <div className="text-[12.5px] mt-1">“{e.note}”</div>}
          <AuditDiff before={e.before} after={e.after} />
        </li>
      ))}
    </ol>
  );
}

/** Row checkboxes for bulk actions. */
export function useSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return {
    selected,
    toggle: (id: string) =>
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    setAll: (ids: string[], on: boolean) => setSelected(on ? new Set(ids) : new Set()),
    clear: () => setSelected(new Set()),
  };
}
