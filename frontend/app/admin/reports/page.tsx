'use client';

import { useState } from 'react';
import { Alert, btn, Detail, Drawer, EmptyState, Feedback, Field, inputClass, Pager, SectionTitle, Spinner, StatusPill, Tabs, Tag } from '@/components/ui';
import { api, download, errorMessage } from '@/lib/api';
import { useAction, useApi, useDebounced } from '@/lib/hooks';
import { dateTime, humanise, timeAgo } from '@/lib/format';
import { AdminPage, AuditTrail, ListToolbar, qs, RequireCapability, Table, Td, Th, useSelection, type AuditEntry } from '../_components/admin-ui';

const REASONS: Record<string, string> = {
  not_honoured: 'Offer not honoured',
  ended: 'Offer has ended',
  wrong_terms: 'Wrong price or terms',
  closed_or_fake: 'Business closed or fake',
  misleading: 'Misleading or offensive',
  other: 'Other',
};

interface CaseRow {
  _id: string;
  status: string;
  reportCount: number;
  firstReportAt?: string;
  latestReportAt?: string;
  autoHidden: boolean;
  infoDeadline?: string;
  deadlinePassed: boolean;
  appeal?: { status: string; message: string; at: string };
  offerId?: { _id: string; title: string; status: string; displayLabel: string };
  businessId?: { _id: string; name: string; slug: string; town?: string };
  reasons: { reason: string; label: string; count: number }[];
}

interface CaseDetail {
  case: Omit<CaseRow, 'reasons' | 'deadlinePassed'> & {
    offerId: { _id: string; title: string; status: string; displayLabel: string; terms?: string; redemptionUrl?: string };
    businessId: { _id: string; name: string; slug: string; town?: string; phone?: string; verificationLevel: number; status: string; suspensionReview?: { flaggedAt?: string; reason?: string; resolvedAt?: string } };
    decisionReason?: string;
    decisionNote?: string;
    decidedAt?: string;
    decidedBy?: { name: string };
    infoMessage?: string;
    businessReplies: { message: string; at: string }[];
    appeal?: { status: string; message: string; at: string; response?: string; decidedAt?: string };
  };
  reports: { _id: string; reason: string; reasonLabel: string; note?: string; reporterEmail?: string; reporterId?: { name: string; email: string }; hasPhoto: boolean; status: string; createdAt: string }[];
  strikesInWindow: number;
  strikeThreshold: number;
  offerHistory: AuditEntry[];
}

const TABS = [
  { value: 'open', label: 'Open' },
  { value: 'appeals', label: 'Appeals' },
  { value: 'upheld', label: 'Upheld' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
] as const;
type Tab = (typeof TABS)[number]['value'];

function CaseDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, error, reload } = useApi<CaseDetail>(`/admin/reports/${id}`);
  const action = useAction();
  const [mode, setMode] = useState<'view' | 'uphold' | 'reject' | 'ask' | 'appeal'>('view');
  const [text, setText] = useState('');
  const [reason, setReason] = useState('other');
  const [accept, setAccept] = useState(true);

  const submit = async () => {
    const calls: Record<string, [string, object, string]> = {
      uphold: ['uphold', { reason, note: text }, 'Upheld: the offer is removed and the business has a strike'],
      reject: ['reject', { note: text }, 'Rejected: the offer is back on the site'],
      ask: ['ask-business', { message: text }, 'Sent: the business has 48 hours to reply'],
      appeal: ['appeal', { accept, response: text }, accept ? 'Appeal accepted' : 'Appeal declined'],
    };
    const [path, body, success] = calls[mode];
    const result = await action.run(mode, () => api(`/admin/reports/${id}/${path}`, { method: 'POST', body: JSON.stringify(body) }), success);
    if (result !== undefined) {
      setMode('view');
      setText('');
      await reload();
      onChanged();
    }
  };

  const block = async (reportId: string) => {
    const why = window.prompt('Why block this reporter? Their future reports will be ignored.');
    if (!why || why.trim().length < 3) return;
    await action.run('block', () => api(`/admin/reports/reports/${reportId}/block`, { method: 'POST', body: JSON.stringify({ message: why.trim() }) }), 'Reporter blocked');
  };

  const photo = async (reportId: string) => {
    try {
      await download(`/admin/reports/photos/${reportId}`, 'report-photo', true);
    } catch (err) {
      action.setError(errorMessage(err));
    }
  };

  const c = data?.case;
  const open = c && ['open', 'info_requested'].includes(c.status);

  return (
    <Drawer
      open
      onClose={onClose}
      title={c?.offerId?.title ?? 'Report'}
      subtitle={c && `${c.businessId?.name} · ${c.reportCount} report${c.reportCount === 1 ? '' : 's'}`}
      footer={
        c &&
        mode === 'view' && (
          <>
            {open && (
              <>
                <button className={btn.danger} onClick={() => setMode('uphold')}>
                  Uphold
                </button>
                <button className={btn.secondary} onClick={() => setMode('reject')}>
                  Reject reports
                </button>
                {c.status === 'open' && (
                  <button className={btn.secondary} onClick={() => setMode('ask')}>
                    Ask the business
                  </button>
                )}
              </>
            )}
            {c.appeal?.status === 'open' && (
              <button className={btn.primary} onClick={() => setMode('appeal')}>
                Decide appeal
              </button>
            )}
          </>
        )
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {!data || !c ? (
        !error && <Spinner />
      ) : (
        <div className="flex flex-col gap-6">
          <Feedback error={action.error} notice={action.notice} />
          {c.autoHidden && c.status !== 'upheld' && <Alert tone="warning">Hidden automatically after reports from different people. It stays off the site until you decide.</Alert>}

          {mode !== 'view' && (
            <div className="bg-surface rounded-3xl p-5 flex flex-col gap-4">
              {mode === 'uphold' && (
                <Field label="Reason" required>
                  <select className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)}>
                    {Object.entries(REASONS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {mode === 'appeal' && (
                <div className="flex gap-2">
                  <button className={accept ? btn.smallPrimary : btn.small} onClick={() => setAccept(true)}>
                    Accept (restore offer, revoke strike)
                  </button>
                  <button className={!accept ? btn.smallPrimary : btn.small} onClick={() => setAccept(false)}>
                    Decline
                  </button>
                </div>
              )}
              <Field
                label={mode === 'ask' ? 'Message to the business' : mode === 'appeal' ? 'Reply to the business' : 'Note to the business'}
                hint={mode === 'uphold' ? 'The offer is removed and the business gets a strike. Three strikes in 90 days flags it for suspension.' : mode === 'ask' ? 'They get 48 hours to reply.' : undefined}
                required
              >
                <textarea rows={3} className={inputClass} value={text} onChange={(e) => setText(e.target.value)} />
              </Field>
              <div className="flex gap-3">
                <button className={mode === 'uphold' ? btn.danger : btn.primary} disabled={text.trim().length < 3 || !!action.busy} onClick={submit}>
                  {mode === 'uphold' ? 'Uphold and remove offer' : mode === 'reject' ? 'Reject reports' : mode === 'ask' ? 'Send' : 'Save decision'}
                </button>
                <button className={btn.secondary} onClick={() => setMode('view')}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <dl>
            <Detail label="Status">
              <StatusPill status={c.status} />
            </Detail>
            <Detail label="Offer">
              {c.offerId.displayLabel} · <StatusPill status={c.offerId.status} />
            </Detail>
            <Detail label="Terms">{c.offerId.terms || '—'}</Detail>
            <Detail label="Business">
              {c.businessId.name} · {c.businessId.town} · level {c.businessId.verificationLevel}
            </Detail>
            <Detail label="Strikes">
              {data.strikesInWindow} of {data.strikeThreshold} in the window
              {c.businessId.suspensionReview?.flaggedAt && !c.businessId.suspensionReview.resolvedAt && <Tag tone="bad">Flagged for suspension review</Tag>}
            </Detail>
            {c.infoDeadline && <Detail label="Reply due">{dateTime(c.infoDeadline)}</Detail>}
            {c.decisionNote && (
              <Detail label="Decision">
                {humanise(c.status)} by {c.decidedBy?.name ?? 'staff'} · {dateTime(c.decidedAt)} · “{c.decisionNote}”
              </Detail>
            )}
          </dl>

          {(c.infoMessage || c.businessReplies.length > 0 || c.appeal) && (
            <div>
              <SectionTitle>Conversation with the business</SectionTitle>
              <div className="flex flex-col gap-2 text-sm">
                {c.infoMessage && <div className="bg-tint-blue rounded-2xl px-4 py-3">We asked: {c.infoMessage}</div>}
                {c.businessReplies.map((r, i) => (
                  <div key={i} className="bg-surface rounded-2xl px-4 py-3">
                    <div className="text-[12px] text-muted font-bold">Business · {dateTime(r.at)}</div>
                    {r.message}
                  </div>
                ))}
                {c.appeal && (
                  <div className="bg-sun-soft/60 rounded-2xl px-4 py-3">
                    <div className="text-[12px] font-bold">Appeal · {dateTime(c.appeal.at)} · {humanise(c.appeal.status)}</div>
                    {c.appeal.message}
                    {c.appeal.response && <div className="mt-2 text-muted">Our reply: {c.appeal.response}</div>}
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <SectionTitle>Reports</SectionTitle>
            <ul className="flex flex-col gap-2">
              {data.reports.map((r) => (
                <li key={r._id} className="bg-surface rounded-2xl px-4 py-3 text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-extrabold flex-1">{r.reasonLabel}</span>
                    <span className="text-[12px] text-muted">{dateTime(r.createdAt)}</span>
                  </div>
                  {r.note && <p className="mt-1">{r.note}</p>}
                  <div className="flex items-center gap-3 mt-2 text-[12.5px] text-muted flex-wrap">
                    <span>{r.reporterId ? `${r.reporterId.name} (${r.reporterId.email})` : (r.reporterEmail ?? 'Guest')}</span>
                    {r.hasPhoto && (
                      <button className={btn.link} onClick={() => photo(r._id)}>
                        View photo
                      </button>
                    )}
                    <button className={`${btn.link} text-danger`} onClick={() => block(r._id)}>
                      Block reporter
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <SectionTitle>Offer history</SectionTitle>
            <AuditTrail entries={data.offerHistory} />
          </div>
        </div>
      )}
    </Drawer>
  );
}

function ReportsQueue() {
  const [tab, setTab] = useState<Tab>('open');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const { data, error, loading, reload } = useApi<{ items: CaseRow[]; total: number; page: number; pages: number }>(`/admin/reports${qs({ status: tab, q, page })}`);
  const selection = useSelection();
  const action = useAction();
  const [bulkNote, setBulkNote] = useState('');

  const bulkReject = async () => {
    const result = await action.run(
      'bulk',
      () => api<{ results: { ok: boolean }[] }>('/admin/reports/bulk-reject', { method: 'POST', body: JSON.stringify({ ids: [...selection.selected], note: bulkNote }) }),
      (r) => `${r.results.filter((x) => x.ok).length} rejected`,
    );
    if (result) {
      selection.clear();
      setBulkNote('');
      await reload();
    }
  };

  const ids = data?.items.map((c) => c._id) ?? [];

  return (
    <AdminPage title="Reports & flags" subtitle="Reports from customers, grouped by offer. Most-reported first.">
      <div className="mb-5">
        <Tabs
          tabs={TABS}
          active={tab}
          onChange={(v) => {
            setTab(v);
            setPage(1);
            selection.clear();
          }}
        />
      </div>
      <ListToolbar
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Offer title or business name"
        csvPath={`/admin/reports${qs({ status: tab, q, format: 'csv' })}`}
        csvName="reports.csv"
      />
      {selection.selected.size > 0 && (
        <div className="flex gap-2 flex-wrap items-center bg-tint-blue rounded-2xl px-4 py-3 mb-4">
          <span className="text-sm font-extrabold mr-2">{selection.selected.size} selected</span>
          <input className={`${inputClass} flex-1 min-w-[200px] !py-1.5`} placeholder="Note to the business (required)" value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} />
          <button className={btn.smallPrimary} disabled={bulkNote.trim().length < 3 || !!action.busy} onClick={bulkReject}>
            Reject all as unfounded
          </button>
        </div>
      )}
      <Feedback error={action.error ?? error} notice={action.notice} className="mb-4" />
      {!data && loading ? (
        <Spinner />
      ) : data && data.items.length === 0 ? (
        <EmptyState title="No reports">{tab === 'open' ? 'Nothing waiting. Nice.' : 'Nothing here.'}</EmptyState>
      ) : data ? (
        <>
          <Table minWidth={900}>
            <thead className="bg-surface">
              <tr>
                <Th className="w-10">
                  <input type="checkbox" aria-label="Select all" checked={ids.length > 0 && ids.every((id) => selection.selected.has(id))} onChange={(e) => selection.setAll(ids, e.target.checked)} />
                </Th>
                <Th>Offer</Th>
                <Th>Business</Th>
                <Th>Reasons</Th>
                <Th>Reports</Th>
                <Th>Latest</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c._id} className="border-t border-line hover:bg-surface/60 cursor-pointer" onClick={() => setOpenId(c._id)}>
                  <Td>
                    <input type="checkbox" aria-label="Select" checked={selection.selected.has(c._id)} onClick={(e) => e.stopPropagation()} onChange={() => selection.toggle(c._id)} />
                  </Td>
                  <Td>
                    <div className="font-extrabold">{c.offerId?.title ?? 'Deleted offer'}</div>
                    <div className="text-[12.5px] text-muted">{c.offerId?.displayLabel}</div>
                  </Td>
                  <Td>
                    <div className="font-bold">{c.businessId?.name}</div>
                    <div className="text-[12.5px] text-muted">{c.businessId?.town}</div>
                  </Td>
                  <Td>
                    <div className="flex gap-1 flex-wrap">
                      {c.reasons.map((r) => (
                        <Tag key={r.reason} tone="warn">
                          {r.label} ×{r.count}
                        </Tag>
                      ))}
                    </div>
                  </Td>
                  <Td className="font-extrabold">{c.reportCount}</Td>
                  <Td className="text-[13px] whitespace-nowrap">{timeAgo(c.latestReportAt)}</Td>
                  <Td>
                    <div className="flex flex-col gap-1 items-start">
                      <StatusPill status={c.status} />
                      {c.autoHidden && c.status !== 'upheld' && <Tag tone="bad">Auto-hidden</Tag>}
                      {c.appeal?.status === 'open' && <Tag tone="info">Appeal</Tag>}
                      {c.deadlinePassed && c.status === 'info_requested' && <Tag tone="bad">No reply in 48 h</Tag>}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pager page={data.page} pages={data.pages} onChange={setPage} />
        </>
      ) : null}
      {openId && <CaseDrawer id={openId} onClose={() => setOpenId(null)} onChanged={() => void reload()} />}
    </AdminPage>
  );
}

export default function AdminReportsPage() {
  return (
    <RequireCapability capability="reports.review">
      <ReportsQueue />
    </RequireCapability>
  );
}
