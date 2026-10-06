'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { Alert, btn, Card, Detail, Feedback, Field, inputClass, Modal, SectionTitle, Spinner, StatusPill, Tag, Toggle } from '@/components/ui';
import { CheckIcon, CloseIcon, FileIcon } from '@/components/icons';
import { api, download, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAction, useApi } from '@/lib/hooks';
import { age, date, dateTime, humanise } from '@/lib/format';
import { AdminPage, RequireCapability } from '../../_components/admin-ui';
import { EvidenceChips, type Evidence } from '../claim-ui';

interface ClaimDetail {
  claim: {
    _id: string;
    kind: string;
    status: string;
    submittedAt?: string;
    expiresAt?: string;
    decidedAt?: string;
    ageHours: number | null;
    reasonCode?: string;
    notes?: string;
    shopPhotoCode?: string;
    phoneOtpPassed: boolean;
    domainCheckPassed: boolean;
    fhrsMatch: boolean;
    phoneCheck: { phone?: string; channel?: string; mode?: string; sentAt?: string; attempts?: number; sends?: number; passedAt?: string };
    domainCheck: { domain?: string; method?: string; email?: string; passedAt?: string; lastError?: string };
    fhrs?: { fhrsId?: string; name?: string; address?: string; postcode?: string; rating?: string; nameMatches: boolean; postcodeMatches: boolean; checkedAt?: string };
    checklist: Record<ChecklistKey, boolean>;
    messages: { _id: string; from: string; userId?: { name: string }; body: string; createdAt?: string }[];
    userId: { _id: string; name: string; email: string; phone?: string; emailVerifiedAt?: string; createdAt: string; status: string; role: string };
    assignedTo?: { _id: string; name: string; email: string };
    disputedOwnerIds?: string[];
    method?: string;
    evidence?: string;
  };
  business: {
    _id: string;
    name: string;
    slug: string;
    address?: string;
    postcode: string;
    town?: string;
    phone?: string;
    email?: string;
    website?: string;
    orderUrl?: string;
    verificationLevel: number;
    status: string;
    frozen?: boolean;
    source?: string;
    categories?: { name: string }[];
    members: { userId: string; role: string; user?: { name: string; email: string } }[];
  };
  documents: { _id: string; type: string; originalName?: string; size?: number; mime?: string; status: string; uploadedAt?: string }[];
  evidence: Evidence;
  signals: {
    listingPhoneMatchesCheck: boolean;
    orderLink: string;
    otherOwners: number;
    suspendedLinks: { bannedAccounts: { name: string; email: string }[]; suspendedBusinesses: { name: string; slug: string }[] };
    previousRejectedClaims: number;
  };
  otherClaims: { _id: string; status: string; kind: string; userId?: { name: string; email: string }; createdAt: string; reasonCode?: string }[];
}

type ChecklistKey = 'detailsMatch' | 'documentValid' | 'orderLinkOk' | 'noOtherOwner' | 'notLinkedToSuspended';

// Spec T2.5: the five things a moderator confirms before approving.
const CHECKLIST: { key: ChecklistKey; label: string; hint: (d: ClaimDetail) => string }[] = [
  { key: 'detailsMatch', label: 'Business name and address match the listing', hint: (d) => (d.claim.fhrs ? `FHRS: name ${d.claim.fhrs.nameMatches ? 'matches' : 'differs'}, postcode ${d.claim.fhrs.postcodeMatches ? 'matches' : 'differs'}` : 'Compare with the evidence on the right') },
  { key: 'documentValid', label: 'The document is valid and recent', hint: (d) => (d.documents.length ? `${d.documents.length} document(s) uploaded` : 'No document uploaded: rely on the other evidence') },
  { key: 'orderLinkOk', label: 'The order link domain belongs to the business or a known ordering provider', hint: (d) => `Automatic check: ${humanise(d.signals.orderLink)}` },
  { key: 'noOtherOwner', label: 'No other verified owner', hint: (d) => (d.signals.otherOwners ? `${d.signals.otherOwners} other owner(s) on this listing` : 'Nobody else owns this listing') },
  {
    key: 'notLinkedToSuspended',
    label: 'Email or phone not linked to a suspended business',
    hint: (d) => {
      const n = d.signals.suspendedLinks.bannedAccounts.length + d.signals.suspendedLinks.suspendedBusinesses.length;
      return n ? `${n} link(s) found: see Signals` : 'No links found';
    },
  },
];

const REJECT_REASONS = [
  { value: 'mismatch', label: 'Details or evidence do not match' },
  { value: 'fake_document', label: 'Document looks altered or fake' },
  { value: 'duplicate', label: 'Duplicate: already listed and claimed' },
  { value: 'not_a_takeaway', label: 'Not a takeaway we can list' },
  { value: 'other', label: 'Other' },
];

const ORDER_LINK_TONE: Record<string, 'good' | 'warn' | 'bad' | 'neutral'> = { own_domain: 'good', ordering_provider: 'good', mismatch: 'bad', invalid: 'bad', none: 'neutral' };

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-none mt-0.5 ${ok ? 'bg-verified/15 text-verified' : 'bg-danger/10 text-danger'}`}>
        {ok ? <CheckIcon className="w-3.5 h-3.5" /> : <CloseIcon className="w-3.5 h-3.5" />}
      </span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function ClaimReview({ id }: { id: string }) {
  const { user } = useAuth();
  const { data, error, reload, setData } = useApi<ClaimDetail>(`/admin/claims/${id}`);
  const action = useAction();
  const [message, setMessage] = useState('');
  const [modal, setModal] = useState<'approve' | 'info' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('mismatch');

  if (error) {
    return (
      <AdminPage title="Claim">
        <Alert tone="danger">{error}</Alert>
      </AdminPage>
    );
  }
  if (!data) return <Spinner />;
  const { claim, business, documents, evidence, signals } = data;
  const open = ['pending', 'info_requested', 'disputed'].includes(claim.status);
  const checklistDone = CHECKLIST.every((c) => claim.checklist?.[c.key]);

  const setCheck = async (key: ChecklistKey, value: boolean) => {
    setData({ ...data, claim: { ...claim, checklist: { ...claim.checklist, [key]: value } } });
    await action.run('check', () => api(`/admin/claims/${id}/checklist`, { method: 'PATCH', body: JSON.stringify({ [key]: value }) }));
  };

  const assign = (userId: string | null) =>
    action.run('assign', () => api(`/admin/claims/${id}/assign`, { method: 'PATCH', body: JSON.stringify({ userId }) }), userId ? 'Assigned to you' : 'Unassigned').then(() => reload());

  const decide = async () => {
    const path = modal === 'approve' ? 'approve' : modal === 'info' ? 'request-info' : 'reject';
    const body = modal === 'approve' ? { note: note || undefined } : modal === 'info' ? { message: note } : { reasonCode: reason, note };
    const done = await action.run(
      'decide',
      () => api(`/admin/claims/${id}/${path}`, { method: 'POST', body: JSON.stringify(body) }),
      modal === 'approve' ? `${business.name} is now verified` : modal === 'info' ? 'Request sent. The claim closes in 14 days without a reply.' : 'Claim rejected and the claimant told why',
    );
    if (done !== undefined) {
      setModal(null);
      setNote('');
      await reload();
    }
  };

  const sendMessage = async () => {
    if (!message.trim()) return;
    const done = await action.run('message', () => api(`/admin/claims/${id}/messages`, { method: 'POST', body: JSON.stringify({ body: message.trim() }) }));
    if (done !== undefined) {
      setMessage('');
      await reload();
    }
  };

  const setDocStatus = async (docId: string, status: string) => {
    await action.run('doc', () => api(`/admin/claims/${id}/documents/${docId}`, { method: 'PATCH', body: JSON.stringify({ status }) }));
    await reload();
  };

  const viewDoc = async (doc: ClaimDetail['documents'][number]) => {
    try {
      await download(`/admin/claims/${id}/documents/${doc._id}`, doc.originalName ?? doc.type, true);
    } catch (err) {
      action.setError(errorMessage(err));
    }
  };

  return (
    <AdminPage
      title={business.name}
      subtitle={
        <span className="flex items-center gap-2 flex-wrap">
          <Link href="/admin/claims" className="hover:text-primary">
            ← Verification queue
          </Link>
          <span>·</span>
          <span>{claim.kind === 'existing' ? 'Claim of an existing listing' : claim.kind === 'new' ? 'New business' : 'Re-verification'}</span>
          <span>·</span>
          <span>Submitted {dateTime(claim.submittedAt)} ({age(claim.ageHours)} ago)</span>
        </span>
      }
      actions={<StatusPill status={claim.status} />}
    >
      <Feedback error={action.error} notice={action.notice} className="mb-5" />

      {claim.status === 'disputed' && (
        <Alert tone="danger" title="Dispute" className="mb-5">
          Someone else already owns this listing. It is frozen until you decide. Approving makes this claimant the owner and removes the current owner(s).
        </Alert>
      )}
      {claim.status === 'info_requested' && claim.expiresAt && (
        <Alert tone="warning" className="mb-5">
          Waiting on the business. The claim closes on {date(claim.expiresAt)} if they don’t reply.
        </Alert>
      )}
      {claim.method && (
        <Alert tone="info" className="mb-5">
          Filed before the new verification flow ({humanise(claim.method)}). {claim.evidence}
        </Alert>
      )}

      <div className="flex gap-3 flex-wrap items-center mb-6">
        <span className="text-sm font-bold text-muted">Assigned: {claim.assignedTo?.name ?? 'nobody'}</span>
        {claim.assignedTo?._id !== user?.id && (
          <button className={btn.small} disabled={!!action.busy} onClick={() => assign(user?.id ?? null)}>
            Assign to me
          </button>
        )}
        {claim.assignedTo && (
          <button className={btn.small} disabled={!!action.busy} onClick={() => assign(null)}>
            Unassign
          </button>
        )}
        <div className="flex-1" />
        {open && (
          <>
            <button className={btn.good} disabled={!!action.busy || !claim.phoneOtpPassed} onClick={() => setModal('approve')} title={claim.phoneOtpPassed ? undefined : 'The phone check has not been passed'}>
              <CheckIcon className="w-4 h-4" /> Approve
            </button>
            {claim.status !== 'info_requested' && (
              <button className={btn.secondary} disabled={!!action.busy} onClick={() => setModal('info')}>
                Request more info
              </button>
            )}
            <button className={btn.danger} disabled={!!action.busy} onClick={() => setModal('reject')}>
              Reject
            </button>
          </>
        )}
      </div>

      <div className="grid xl:grid-cols-2 gap-6 mb-6">
        <Card>
          <SectionTitle aside={<Link href={`/admin/businesses?open=${business._id}`} className={btn.link + ' text-sm'}>Open business</Link>}>The listing</SectionTitle>
          <dl>
            <Detail label="Name">{business.name}</Detail>
            <Detail label="Address">{[business.address, business.town, business.postcode].filter(Boolean).join(', ')}</Detail>
            <Detail label="Phone">
              {business.phone ?? '—'}{' '}
              {claim.phoneCheck.phone && <Tag tone={signals.listingPhoneMatchesCheck ? 'good' : 'bad'}>{signals.listingPhoneMatchesCheck ? 'Code sent to this number' : 'Code went to another number'}</Tag>}
            </Detail>
            <Detail label="Website">{business.website ?? '—'}</Detail>
            <Detail label="Order link">
              <span className="break-all">{business.orderUrl ?? '—'}</span> <Tag tone={ORDER_LINK_TONE[signals.orderLink] ?? 'neutral'}>{humanise(signals.orderLink)}</Tag>
            </Detail>
            <Detail label="Categories">{business.categories?.map((c) => c.name).join(', ') || '—'}</Detail>
            <Detail label="Level">
              {business.verificationLevel} · {humanise(business.status)}
              {business.frozen && <span className="text-danger"> · Frozen</span>}
            </Detail>
            <Detail label="Source">{humanise(business.source) || '—'}</Detail>
            <Detail label="Team">
              {business.members.length ? business.members.map((m) => `${m.user?.name ?? 'Unknown'} (${m.role})`).join(', ') : 'Nobody yet'}
            </Detail>
          </dl>
        </Card>

        <Card>
          <SectionTitle aside={<EvidenceChips evidence={evidence} />}>The evidence</SectionTitle>
          <div className="flex flex-col gap-4">
            <Check ok={claim.phoneOtpPassed}>
              <div className="font-bold">Phone check</div>
              <div className="text-muted text-[13px]">
                {claim.phoneCheck.phone ? `${claim.phoneCheck.phone} by ${claim.phoneCheck.channel ?? 'sms'}` : 'Not started'}
                {claim.phoneCheck.passedAt ? ` · passed ${dateTime(claim.phoneCheck.passedAt)}` : claim.phoneCheck.attempts ? ` · ${claim.phoneCheck.attempts} wrong attempt(s)` : ''}
                {claim.phoneCheck.mode === 'mock' ? ' · test mode (no SMS sent)' : ''}
              </div>
            </Check>
            <Check ok={claim.domainCheckPassed}>
              <div className="font-bold">Website or email domain</div>
              <div className="text-muted text-[13px]">
                {claim.domainCheck.passedAt
                  ? `${claim.domainCheck.domain} via ${humanise(claim.domainCheck.method)}${claim.domainCheck.email ? ` (${claim.domainCheck.email})` : ''}`
                  : claim.domainCheck.lastError ?? 'Not attempted'}
              </div>
            </Check>
            <Check ok={claim.fhrsMatch}>
              <div className="font-bold">Food hygiene register (FHRS)</div>
              <div className="text-muted text-[13px]">
                {claim.fhrs ? `${claim.fhrs.name}, ${claim.fhrs.address ?? ''} ${claim.fhrs.postcode ?? ''} · rating ${claim.fhrs.rating ?? '—'}` : 'Not attempted'}
              </div>
            </Check>
            <Check ok={documents.some((d) => d.type === 'shop_photo')}>
              <div className="font-bold">Shop-front photo</div>
              <div className="text-muted text-[13px]">{claim.shopPhotoCode ? `The code on paper should read ${claim.shopPhotoCode}` : 'Not uploaded'}</div>
            </Check>
            <div>
              <div className="font-bold text-sm mb-2">Documents</div>
              {documents.length === 0 ? (
                <p className="text-sm text-muted">None uploaded.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {documents.map((d) => (
                    <li key={d._id} className="flex items-center gap-3 flex-wrap bg-surface rounded-2xl px-4 py-3 text-sm">
                      <FileIcon className="w-5 h-5 text-muted" />
                      <div className="flex-1 min-w-0">
                        <div className="font-bold">{humanise(d.type)}</div>
                        <div className="text-[12px] text-muted truncate">
                          {d.originalName} · {d.size ? `${Math.round(d.size / 1024)} KB` : ''} · {date(d.uploadedAt)}
                        </div>
                      </div>
                      <button className={btn.small} onClick={() => viewDoc(d)}>
                        View
                      </button>
                      <select
                        aria-label="Document status"
                        value={d.status}
                        onChange={(e) => setDocStatus(d._id, e.target.value)}
                        className="bg-card border border-line rounded-xl px-2 py-1.5 text-[13px] font-bold"
                      >
                        <option value="pending">Not checked</option>
                        <option value="accepted">Accepted</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[12px] text-muted mt-2">Documents are private. Each view is logged; files are deleted 90 days after the decision.</p>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid xl:grid-cols-2 gap-6">
        <div className="flex flex-col gap-6">
          <Card>
            <SectionTitle aside={checklistDone ? <Tag tone="good">All checked</Tag> : undefined}>Checklist</SectionTitle>
            <div className="flex flex-col gap-4">
              {CHECKLIST.map((c) => (
                <Toggle key={c.key} checked={!!claim.checklist?.[c.key]} onChange={(v) => setCheck(c.key, v)} label={c.label} hint={c.hint(data)} disabled={!open} />
              ))}
            </div>
          </Card>

          <Card>
            <SectionTitle>Signals</SectionTitle>
            <dl>
              <Detail label="Claimant">
                {claim.userId.name} · {claim.userId.email}
                {claim.userId.phone ? ` · ${claim.userId.phone}` : ''}
              </Detail>
              <Detail label="Account">
                Joined {date(claim.userId.createdAt)} · {claim.userId.emailVerifiedAt ? 'email verified' : 'email not verified'} · {humanise(claim.userId.status)}
              </Detail>
              <Detail label="Rejected before">{signals.previousRejectedClaims}</Detail>
              <Detail label="Banned look-alikes">
                {signals.suspendedLinks.bannedAccounts.length ? signals.suspendedLinks.bannedAccounts.map((u) => u.email).join(', ') : 'None'}
              </Detail>
              <Detail label="Suspended businesses">
                {signals.suspendedLinks.suspendedBusinesses.length ? signals.suspendedLinks.suspendedBusinesses.map((b) => b.name).join(', ') : 'None'}
              </Detail>
            </dl>
            {data.otherClaims.length > 0 && (
              <>
                <div className="font-bold text-sm mt-5 mb-2">Other claims on this listing</div>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {data.otherClaims.map((o) => (
                    <li key={o._id} className="flex items-center gap-2">
                      <Link href={`/admin/claims/${o._id}`} className="font-bold hover:text-primary flex-1 truncate">
                        {o.userId?.name ?? 'Unknown'} · {date(o.createdAt)}
                      </Link>
                      <StatusPill status={o.status} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </div>

        <Card>
          <SectionTitle>Messages</SectionTitle>
          <div className="flex flex-col gap-3 mb-4 max-h-[460px] overflow-y-auto">
            {claim.messages.length === 0 && <p className="text-sm text-muted">No messages yet. The claimant sees these in their dashboard and gets an email.</p>}
            {claim.messages.map((m) => (
              <div key={m._id} className={`rounded-2xl px-4 py-3 text-sm max-w-[90%] ${m.from === 'owner' ? 'bg-surface self-start' : m.from === 'system' ? 'bg-page self-center text-muted' : 'bg-tint-blue self-end'}`}>
                <div className="text-[12px] font-bold text-muted mb-1">
                  {m.from === 'owner' ? claim.userId.name : m.from === 'system' ? 'TruOffers' : (m.userId?.name ?? 'Moderator')} · {dateTime(m.createdAt)}
                </div>
                <div className="whitespace-pre-wrap">{m.body}</div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} placeholder="Write to the claimant…" className={`${inputClass} flex-1`} />
            <button className={btn.primary} disabled={!message.trim() || action.busy === 'message'} onClick={sendMessage}>
              Send
            </button>
          </div>
          {claim.reasonCode && (
            <Alert tone="danger" className="mt-4" title={`Rejected: ${REJECT_REASONS.find((r) => r.value === claim.reasonCode)?.label ?? claim.reasonCode}`}>
              {claim.notes}
            </Alert>
          )}
        </Card>
      </div>

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal === 'approve' ? `Verify ${business.name}?` : modal === 'info' ? 'Ask for more information' : 'Reject this claim'}
        footer={
          <>
            <button className={btn.secondary} onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className={modal === 'reject' ? btn.danger : modal === 'approve' ? btn.good : btn.primary}
              disabled={action.busy === 'decide' || (modal === 'info' && note.trim().length < 5) || (modal === 'reject' && note.trim().length < 3)}
              onClick={decide}
            >
              {modal === 'approve' ? 'Approve and verify' : modal === 'info' ? 'Send request' : 'Reject'}
            </button>
          </>
        }
      >
        {modal === 'approve' && (
          <div className="flex flex-col gap-4">
            {!checklistDone && <Alert tone="warning">Not every checklist item is ticked.</Alert>}
            <p className="text-sm text-muted">
              The listing becomes level 2 (verified), the badge shows, the claimant becomes owner, and offers they saved while unverified are submitted.
            </p>
            <Field label="Note (optional, kept in the audit log)">
              <textarea rows={3} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        )}
        {modal === 'info' && (
          <Field label="What do you need?" hint="The claimant has 14 days to reply before the claim closes." required>
            <textarea rows={4} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
        {modal === 'reject' && (
          <div className="flex flex-col gap-4">
            <Field label="Reason" required>
              <select className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)}>
                {REJECT_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Note to the claimant" required>
              <textarea rows={4} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>
    </AdminPage>
  );
}

export default function AdminClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireCapability capability="claims.review">
      <ClaimReview id={id} />
    </RequireCapability>
  );
}
