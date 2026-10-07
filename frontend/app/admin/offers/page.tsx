'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, btn, EmptyState, Feedback, Pager, Spinner, StatusPill, Tabs, Tag } from '@/components/ui';
import { api } from '@/lib/api';
import { can, useAuth } from '@/lib/auth-context';
import { useAction, useApi, useDebounced } from '@/lib/hooks';
import { date, timeAgo } from '@/lib/format';
import { OFFER_TYPE_LABELS, REJECT_REASON_LABELS } from '@/app/dashboard/_components/offer-meta';
import { AdminPage, ListToolbar, qs, RequireCapability, Table, Td, Th, useSelection } from '../_components/admin-ui';
import { OfferDrawer, type AdminOffer } from './OfferDrawer';
import { RulesEditor } from './RulesEditor';

interface OfferList {
  items: AdminOffer[];
  total: number;
  page: number;
  pages: number;
  statusCounts: Record<string, number>;
}

const TABS = [
  { value: 'queue', label: 'To review' },
  { value: 'active,scheduled', label: 'Live & scheduled' },
  { value: 'paused', label: 'Paused' },
  { value: 'hidden_by_reports', label: 'Hidden by reports' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
  { value: 'draft', label: 'Drafts' },
  { value: 'all', label: 'All' },
] as const;
type Tab = (typeof TABS)[number]['value'];

function OffersModeration() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const initial = params.get('status');
  const [tab, setTab] = useState<Tab>(initial === 'pending' ? 'queue' : initial === 'active' ? 'active,scheduled' : ((initial as Tab) ?? 'queue'));
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ source: '', plan: '', city: '' });
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(params.get('open'));
  const [rulesOpen, setRulesOpen] = useState(false);
  const q = useDebounced(search);
  const city = useDebounced(filters.city);
  const query = { status: tab, q, source: filters.source, plan: filters.plan, city, page };
  const { data, error, loading, reload } = useApi<OfferList>(`/admin/offers${qs(query)}`);
  const selection = useSelection();
  const action = useAction();
  const [bulkReason, setBulkReason] = useState('other');

  const counts = data?.statusCounts ?? {};
  const tabCounts: Partial<Record<Tab, number>> = {
    queue: counts.pending,
    'active,scheduled': (counts.active ?? 0) + (counts.scheduled ?? 0),
    hidden_by_reports: counts.hidden_by_reports,
  };

  const bulk = async (kind: 'approve' | 'reject' | 'pause') => {
    const ids = [...selection.selected];
    if (!ids.length) return;
    const result = await action.run(
      'bulk',
      () => api<{ results: { id: string; ok: boolean; error?: string }[] }>('/admin/offers/bulk', { method: 'POST', body: JSON.stringify({ ids, action: kind, reasonCode: kind === 'reject' ? bulkReason : undefined }) }),
      (r) => {
        const failed = r.results.filter((x) => !x.ok);
        return `${r.results.length - failed.length} done${failed.length ? `, ${failed.length} failed: ${failed[0].error}` : ''}`;
      },
    );
    if (result) {
      selection.clear();
      await reload();
    }
  };

  const ids = data?.items.map((o) => o._id) ?? [];
  const allSelected = ids.length > 0 && ids.every((id) => selection.selected.has(id));

  return (
    <AdminPage
      title="Offer moderation"
      subtitle="Offers waiting for review, oldest first. Verified businesses on plans with auto-approve skip this queue unless a rule flags them."
      actions={
        <button className={btn.secondary} onClick={() => setRulesOpen(true)}>
          Moderation rules
        </button>
      }
    >
      <div className="mb-5">
        <Tabs
          tabs={TABS}
          active={tab}
          onChange={(v) => {
            setTab(v);
            setPage(1);
            selection.clear();
            router.replace('/admin/offers');
          }}
          counts={tabCounts}
        />
      </div>
      <ListToolbar
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Search offer titles"
        filters={[
          { key: 'source', label: 'Source', options: [{ value: 'merchant', label: 'Business' }, { value: 'scraper', label: 'Imported' }] },
          { key: 'plan', label: 'Plan', options: [{ value: 'free', label: 'Free' }, { value: 'standard', label: 'Standard' }, { value: 'professional', label: 'Professional' }] },
        ]}
        values={filters}
        onFilter={(k, v) => {
          setFilters({ ...filters, [k]: v });
          setPage(1);
        }}
        csvPath={`/admin/offers${qs({ ...query, page: undefined, format: 'csv' })}`}
        csvName="offers.csv"
      >
        <input
          aria-label="City"
          placeholder="City"
          value={filters.city}
          onChange={(e) => setFilters({ ...filters, city: e.target.value })}
          className="bg-surface border border-line rounded-xl px-3 py-2.5 text-sm font-bold outline-none w-32"
        />
      </ListToolbar>

      {selection.selected.size > 0 && (
        <div className="flex gap-2 flex-wrap items-center bg-tint-blue rounded-2xl px-4 py-3 mb-4">
          <span className="text-sm font-extrabold mr-2">{selection.selected.size} selected</span>
          <button className={btn.smallPrimary} disabled={!!action.busy} onClick={() => bulk('approve')}>
            Approve
          </button>
          <button className={btn.small} disabled={!!action.busy} onClick={() => bulk('pause')}>
            Pause
          </button>
          <select value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} className="bg-card border border-line rounded-full px-3 py-1.5 text-[13px] font-bold" aria-label="Reject reason">
            {Object.entries(REJECT_REASON_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button className={btn.smallDanger} disabled={!!action.busy} onClick={() => bulk('reject')}>
            Reject
          </button>
          <button className={btn.link + ' text-sm ml-auto'} onClick={selection.clear}>
            Clear
          </button>
        </div>
      )}
      <Feedback error={action.error ?? error} notice={action.notice} className="mb-4" />

      {!data && loading ? (
        <Spinner />
      ) : data && data.items.length === 0 ? (
        <EmptyState title={tab === 'queue' ? 'Queue is clear' : 'No offers'}>{tab === 'queue' ? 'Nothing is waiting for review.' : 'No offers match these filters.'}</EmptyState>
      ) : data ? (
        <>
          <Table minWidth={980}>
            <thead className="bg-surface">
              <tr>
                <Th className="w-10">
                  <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={(e) => selection.setAll(ids, e.target.checked)} />
                </Th>
                <Th>Offer</Th>
                <Th>Business</Th>
                <Th>Type</Th>
                <Th>Flags</Th>
                <Th>Dates</Th>
                <Th>Waiting</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((o) => (
                <tr key={o._id} className="border-t border-line hover:bg-surface/60 cursor-pointer" onClick={() => setOpenId(o._id)}>
                  <Td>
                    <input type="checkbox" aria-label={`Select ${o.title}`} checked={selection.selected.has(o._id)} onClick={(e) => e.stopPropagation()} onChange={() => selection.toggle(o._id)} />
                  </Td>
                  <Td>
                    <div className="font-extrabold">{o.title}</div>
                    <div className="text-[12.5px] text-muted">
                      {o.displayLabel}
                      {o.origin === 'scraper' && <Tag tone="neutral">Imported</Tag>}
                    </div>
                  </Td>
                  <Td>
                    <Link href={`/admin/businesses?open=${o.businessId?._id}`} onClick={(e) => e.stopPropagation()} className="font-bold hover:text-primary">
                      {o.businessId?.name}
                    </Link>
                    <div className="text-[12.5px] text-muted">
                      {o.businessId?.town} · level {o.businessId?.verificationLevel}
                    </div>
                  </Td>
                  <Td>{OFFER_TYPE_LABELS[o.discountType] ?? o.discountType}</Td>
                  <Td>
                    {o.flagLabels?.length ? (
                      <div className="flex flex-col gap-1">
                        {o.flagLabels.map((f) => (
                          <Tag key={f} tone="warn">
                            {f}
                          </Tag>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-[13px]">
                    {o.startsAt ? date(o.startsAt, { day: 'numeric', month: 'short' }) : 'Now'} – {o.endsAt ? date(o.endsAt, { day: 'numeric', month: 'short' }) : 'ongoing'}
                  </Td>
                  <Td className="whitespace-nowrap text-[13px]">{timeAgo(o.updatedAt)}</Td>
                  <Td>
                    <StatusPill status={o.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pager page={data.page} pages={data.pages} onChange={setPage} />
        </>
      ) : null}

      {openId && (
        <OfferDrawer
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => void reload()}
        />
      )}
      <RulesEditor open={rulesOpen} onClose={() => setRulesOpen(false)} canEdit={can(user, 'business.manage')} />
      {error && !data && <Alert tone="danger">{error}</Alert>}
    </AdminPage>
  );
}

export default function AdminOffersPage() {
  return (
    <RequireCapability capability="offers.moderate">
      <Suspense fallback={<Spinner />}>
        <OffersModeration />
      </Suspense>
    </RequireCapability>
  );
}
