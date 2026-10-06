'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, EmptyState, Pager, Spinner, StatusPill, Tabs, Tag } from '@/components/ui';
import { useApi, useDebounced } from '@/lib/hooks';
import { age, humanise } from '@/lib/format';
import { AdminPage, ListToolbar, qs, RequireCapability, Table, Td, Th } from '../_components/admin-ui';
import { ChangeRequests } from './ChangeRequests';
import { EvidenceChips, type Evidence } from './claim-ui';

interface ClaimRow {
  _id: string;
  kind: string;
  status: string;
  submittedAt?: string;
  ageHours: number | null;
  expiresAt?: string;
  businessId?: { _id: string; name: string; slug: string; town?: string; postcode?: string; verificationLevel: number; frozen?: boolean };
  userId?: { name: string; email: string };
  assignedTo?: { _id: string; name: string };
  evidence: Evidence;
  method?: string;
}

interface ClaimList {
  items: ClaimRow[];
  total: number;
  page: number;
  pages: number;
  counts: Record<string, number>;
}

const TABS = [
  { value: 'queue', label: 'To review' },
  { value: 'info_requested', label: 'Waiting on business' },
  { value: 'approved,rejected,expired,withdrawn', label: 'Decided' },
  { value: 'all', label: 'All' },
  { value: 'changes', label: 'Profile changes' },
] as const;
type Tab = (typeof TABS)[number]['value'];

function ClaimsQueue() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'queue';
  const [search, setSearch] = useState('');
  const [assigned, setAssigned] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const query = { status: tab, assigned, q, page };
  const { data, error, loading } = useApi<ClaimList>(tab === 'changes' ? null : `/admin/claims${qs(query)}`);
  const stats = useApi<{ waiting: number; infoRequested: number; pendingChanges: number }>('/admin/claims/stats');

  const setTab = (value: Tab) => {
    setPage(1);
    router.replace(`/admin/claims${value === 'queue' ? '' : `?tab=${value}`}`);
  };

  return (
    <AdminPage title="Verification queue" subtitle="Claims to check, oldest first, and changes to locked profile fields.">
      <div className="mb-5">
        <Tabs
          tabs={TABS}
          active={tab}
          onChange={setTab}
          counts={{ queue: stats.data?.waiting, info_requested: stats.data?.infoRequested, changes: stats.data?.pendingChanges }}
        />
      </div>

      {tab === 'changes' ? (
        <ChangeRequests onDecided={() => void stats.reload()} />
      ) : (
        <>
          <ListToolbar
            search={search}
            onSearch={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Business, postcode or claimant email"
            filters={[
              {
                key: 'assigned',
                label: 'Assigned',
                options: [
                  { value: 'me', label: 'Assigned to me' },
                  { value: 'unassigned', label: 'Unassigned' },
                ],
              },
            ]}
            values={{ assigned }}
            onFilter={(_, v) => {
              setAssigned(v);
              setPage(1);
            }}
            csvPath={`/admin/claims${qs({ status: tab, assigned, q, format: 'csv' })}`}
            csvName="claims.csv"
          />
          {error && <Alert tone="danger">{error}</Alert>}
          {!data && loading ? (
            <Spinner />
          ) : data && data.items.length === 0 ? (
            <EmptyState title="Nothing here">{tab === 'queue' ? 'No claims are waiting for review.' : 'No claims match.'}</EmptyState>
          ) : data ? (
            <>
              <Table minWidth={900}>
                <thead className="bg-surface">
                  <tr>
                    <Th>Business</Th>
                    <Th>Claimant</Th>
                    <Th>Type</Th>
                    <Th>Evidence</Th>
                    <Th>Age</Th>
                    <Th>Assigned</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((c) => (
                    <tr key={c._id} className="border-t border-line hover:bg-surface/60 cursor-pointer" onClick={() => router.push(`/admin/claims/${c._id}`)}>
                      <Td>
                        <Link href={`/admin/claims/${c._id}`} className="font-extrabold hover:text-primary" onClick={(e) => e.stopPropagation()}>
                          {c.businessId?.name ?? 'Deleted business'}
                        </Link>
                        <div className="text-[12.5px] text-muted">
                          {[c.businessId?.town, c.businessId?.postcode].filter(Boolean).join(' · ')}
                          {c.businessId?.frozen && <span className="text-danger font-bold"> · Frozen</span>}
                        </div>
                      </Td>
                      <Td>
                        <div className="font-bold">{c.userId?.name}</div>
                        <div className="text-[12.5px] text-muted">{c.userId?.email}</div>
                      </Td>
                      <Td>{c.kind === 'existing' ? 'Claim' : humanise(c.kind)}</Td>
                      <Td>{c.method ? <Tag>Older claim: {humanise(c.method)}</Tag> : <EvidenceChips evidence={c.evidence} />}</Td>
                      <Td className={c.ageHours !== null && c.ageHours >= 48 ? 'text-danger font-extrabold' : 'font-bold'}>{age(c.ageHours)}</Td>
                      <Td>{c.assignedTo?.name ?? <span className="text-muted">—</span>}</Td>
                      <Td>
                        <StatusPill status={c.status} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Pager page={data.page} pages={data.pages} onChange={setPage} />
            </>
          ) : null}
        </>
      )}
    </AdminPage>
  );
}

export default function AdminClaimsPage() {
  return (
    <RequireCapability capability="claims.review">
      <Suspense fallback={<Spinner />}>
        <ClaimsQueue />
      </Suspense>
    </RequireCapability>
  );
}
