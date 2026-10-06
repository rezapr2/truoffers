'use client';

import { useState } from 'react';
import { EmptyState, Feedback, Pager, Spinner, Tag } from '@/components/ui';
import { useApi, useDebounced } from '@/lib/hooks';
import { dateTime, humanise } from '@/lib/format';
import { actorName, AdminPage, AuditDiff, ListToolbar, qs, RequireCapability, Table, Td, Th, type AuditEntry } from '../_components/admin-ui';

// The families of actions, matched by prefix ("offer." = every offer action).
const ACTIONS = ['business.', 'claim.', 'offer.', 'menu.', 'report.', 'user.', 'team.', 'billing.', 'plan.', 'coupon.', 'promotion.', 'promotion_product.', 'settings.', 'moderation_rules.', 'content.', 'taxonomy.', 'email_template.'];
const ENTITIES = ['Business', 'Claim', 'Offer', 'User', 'Payment', 'Plan', 'Coupon', 'Promotion', 'PromotionProduct', 'Report', 'SiteSettings', 'SiteContent', 'HelpPage', 'Category', 'Area', 'OfferType', 'EmailTemplate', 'ScrapedWebsite', 'ExtractedOfferCandidate'];

function AuditLog() {
  const [filters, setFilters] = useState({ action: '', targetType: '', actorKind: '' });
  const [targetId, setTargetId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const target = useDebounced(targetId.trim());
  const query = { ...filters, targetId: target, from, to, page };
  const { data, error, loading } = useApi<{ items: AuditEntry[]; total: number; page: number; pages: number }>(`/admin/audit${qs(query)}`);
  const reset = () => setPage(1);

  return (
    <AdminPage title="Audit log" subtitle="Every admin, moderator and owner action, with what changed. Entries can’t be edited or deleted.">
      <ListToolbar
        filters={[
          { key: 'action', label: 'Action', options: ACTIONS.map((a) => ({ value: a, label: humanise(a.replace(/\.$/, '')) })) },
          { key: 'targetType', label: 'Entity', options: ENTITIES.map((e) => ({ value: e, label: e })) },
          { key: 'actorKind', label: 'Who', options: ['admin', 'merchant', 'system', 'public'].map((k) => ({ value: k, label: k === 'merchant' ? 'Business owner/staff' : humanise(k) })) },
        ]}
        values={filters}
        onFilter={(k, v) => {
          setFilters({ ...filters, [k]: v });
          reset();
        }}
        csvPath={`/admin/audit${qs({ ...query, page: undefined, format: 'csv' })}`}
        csvName="audit-log.csv"
      >
        <input
          aria-label="Entity ID"
          placeholder="Entity ID"
          value={targetId}
          onChange={(e) => {
            setTargetId(e.target.value);
            reset();
          }}
          className="bg-surface border border-line rounded-xl px-3 py-2.5 text-sm font-bold outline-none w-56"
        />
        <label className="flex items-center gap-2 text-sm font-bold text-muted">
          From
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} className="bg-surface border border-line rounded-xl px-3 py-2 text-sm font-bold" />
        </label>
        <label className="flex items-center gap-2 text-sm font-bold text-muted">
          To
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} className="bg-surface border border-line rounded-xl px-3 py-2 text-sm font-bold" />
        </label>
      </ListToolbar>
      <Feedback error={error} className="mb-4" />
      {!data && loading ? (
        <Spinner />
      ) : data && data.items.length === 0 ? (
        <EmptyState title="No entries">Nothing matches these filters.</EmptyState>
      ) : data ? (
        <>
          <Table minWidth={980}>
            <thead className="bg-surface">
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th>Change</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((e) => (
                <tr key={e._id} className="border-t border-line align-top">
                  <Td className="whitespace-nowrap text-[13px]">{dateTime(e.createdAt)}</Td>
                  <Td>
                    <div className="font-bold">{actorName(e.actor)}</div>
                    <div className="text-[12px] text-muted">
                      {humanise(e.actor.role ?? e.actor.kind)}
                      {e.actor.ip ? ` · ${e.actor.ip}` : ''}
                    </div>
                  </Td>
                  <Td>
                    <Tag tone="info">{e.action}</Tag>
                  </Td>
                  <Td>
                    <button
                      className="text-left cursor-pointer hover:text-primary"
                      title="Show everything about this entity"
                      onClick={() => {
                        setTargetId(e.targetId ?? '');
                        setFilters({ ...filters, targetType: e.targetType ?? '' });
                        reset();
                      }}
                    >
                      <div className="font-bold">{e.targetType}</div>
                      <div className="text-[12px] text-muted font-mono">{e.targetId}</div>
                    </button>
                  </Td>
                  <Td className="max-w-[420px]">
                    {e.note && <div className="text-[13px]">“{e.note}”</div>}
                    <AuditDiff before={e.before} after={e.after} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pager page={data.page} pages={data.pages} onChange={setPage} />
        </>
      ) : null}
    </AdminPage>
  );
}

export default function AdminAuditPage() {
  return (
    <RequireCapability capability="audit.view">
      <AuditLog />
    </RequireCapability>
  );
}
