'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { btn, EmptyState, Feedback, Pager, Spinner, StatusPill, Tag } from '@/components/ui';
import { PlusIcon } from '@/components/icons';
import { can, useAuth } from '@/lib/auth-context';
import { useApi, useDebounced } from '@/lib/hooks';
import { date, humanise } from '@/lib/format';
import { AdminPage, ListToolbar, qs, Table, Td, Th } from '../_components/admin-ui';
import { BusinessDrawer, CreateBusinessModal } from './BusinessDrawer';

interface BusinessRow {
  _id: string;
  name: string;
  slug: string;
  town?: string;
  postcode: string;
  verificationLevel: number;
  status: string;
  plan: string;
  subscriptionStatus?: string;
  source?: string;
  isFoodbellClient?: boolean;
  featured?: boolean;
  frozen?: boolean;
  activeOfferCount: number;
  orderLinkCheck: string;
  ownerId?: { name: string; email: string };
  suspensionReview?: { flaggedAt?: string; resolvedAt?: string };
  createdAt: string;
}

const LEVEL_LABELS = ['Unclaimed', 'Claim pending', 'Verified', 'Verified+'];

function BusinessesList() {
  const { user } = useAuth();
  const params = useSearchParams();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({
    level: params.get('level') ?? '',
    status: params.get('status') ?? '',
    plan: params.get('plan') ?? '',
    source: '',
    flag: params.get('flag') ?? '',
  });
  const [city, setCity] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(params.get('open'));
  const [creating, setCreating] = useState(false);
  const q = useDebounced(search);
  const cityQ = useDebounced(city);
  const query = { ...filters, q, city: cityQ, page };
  const { data, error, loading, reload } = useApi<{ items: BusinessRow[]; total: number; page: number; pages: number }>(`/admin/businesses${qs(query)}`);

  return (
    <AdminPage
      title="Businesses"
      subtitle={data ? `${data.total.toLocaleString('en-GB')} listings` : 'Every listing, claimed or not.'}
      actions={
        can(user, 'business.manage') && (
          <button className={btn.primary} onClick={() => setCreating(true)}>
            <PlusIcon className="w-4 h-4" /> Add business
          </button>
        )
      }
    >
      <ListToolbar
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Name, postcode, slug or phone"
        filters={[
          { key: 'level', label: 'Level', options: LEVEL_LABELS.map((label, i) => ({ value: String(i), label: `${i} · ${label}` })) },
          { key: 'status', label: 'Status', options: ['active', 'pending', 'suspended', 'closed', 'archived'].map((s) => ({ value: s, label: humanise(s) })) },
          { key: 'plan', label: 'Plan', options: ['free', 'standard', 'professional', 'starter', 'premium'].map((s) => ({ value: s, label: humanise(s) })) },
          { key: 'source', label: 'Source', options: [{ value: 'owner', label: 'Added by owner' }, { value: 'admin', label: 'Added by admin' }, { value: 'import', label: 'Imported' }] },
          {
            key: 'flag',
            label: 'Flag',
            options: [
              { value: 'suspension_review', label: 'Suspension review' },
              { value: 'frozen', label: 'Frozen (dispute)' },
              { value: 'foodbell', label: 'Foodbell partner' },
              { value: 'order_link', label: 'Order link problem' },
            ],
          },
        ]}
        values={filters}
        onFilter={(k, v) => {
          setFilters({ ...filters, [k]: v });
          setPage(1);
        }}
        csvPath={`/admin/businesses${qs({ ...query, page: undefined, format: 'csv' })}`}
        csvName="businesses.csv"
      >
        <input
          aria-label="City"
          placeholder="City"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className="bg-surface border border-line rounded-xl px-3 py-2.5 text-sm font-bold outline-none w-32"
        />
      </ListToolbar>
      <Feedback error={error} className="mb-4" />
      {!data && loading ? (
        <Spinner />
      ) : data && data.items.length === 0 ? (
        <EmptyState title="No businesses">No listings match these filters.</EmptyState>
      ) : data ? (
        <>
          <Table minWidth={1000}>
            <thead className="bg-surface">
              <tr>
                <Th>Business</Th>
                <Th>Level</Th>
                <Th>Owner</Th>
                <Th>Plan</Th>
                <Th>Live offers</Th>
                <Th>Flags</Th>
                <Th>Added</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((b) => (
                <tr key={b._id} className="border-t border-line hover:bg-surface/60 cursor-pointer" onClick={() => setOpenId(b._id)}>
                  <Td>
                    <div className="font-extrabold">{b.name}</div>
                    <div className="text-[12.5px] text-muted">{[b.town, b.postcode].filter(Boolean).join(' · ')}</div>
                  </Td>
                  <Td>
                    <Tag tone={b.verificationLevel >= 2 ? 'good' : b.verificationLevel === 1 ? 'warn' : 'neutral'}>
                      {b.verificationLevel} · {LEVEL_LABELS[b.verificationLevel]}
                    </Tag>
                  </Td>
                  <Td>{b.ownerId ? <span className="text-[13px]">{b.ownerId.email}</span> : <span className="text-muted">—</span>}</Td>
                  <Td>
                    {humanise(b.plan)}
                    {b.subscriptionStatus === 'past_due' && <Tag tone="bad">Past due</Tag>}
                  </Td>
                  <Td className="font-bold">{b.activeOfferCount}</Td>
                  <Td>
                    <div className="flex gap-1 flex-wrap">
                      {b.isFoodbellClient && <Tag tone="info">Foodbell</Tag>}
                      {b.featured && <Tag tone="info">Featured</Tag>}
                      {b.frozen && <Tag tone="bad">Frozen</Tag>}
                      {b.suspensionReview?.flaggedAt && !b.suspensionReview.resolvedAt && <Tag tone="bad">Review</Tag>}
                      {(b.orderLinkCheck === 'mismatch' || b.orderLinkCheck === 'invalid') && <Tag tone="warn">Order link</Tag>}
                      {b.source === 'import' && <Tag>Imported</Tag>}
                    </div>
                  </Td>
                  <Td className="text-[13px] whitespace-nowrap">{date(b.createdAt)}</Td>
                  <Td>
                    <StatusPill status={b.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pager page={data.page} pages={data.pages} onChange={setPage} />
        </>
      ) : null}
      {openId && <BusinessDrawer id={openId} onClose={() => setOpenId(null)} onChanged={() => void reload()} onOpen={setOpenId} />}
      <CreateBusinessModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          void reload();
          setOpenId(id);
        }}
      />
    </AdminPage>
  );
}

export default function AdminBusinessesPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <BusinessesList />
    </Suspense>
  );
}
