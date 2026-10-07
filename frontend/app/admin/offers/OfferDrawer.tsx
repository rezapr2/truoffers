'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, btn, Detail, Drawer, Feedback, Field, inputClass, SectionTitle, Spinner, StatusPill, Tag, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { dateTime, humanise } from '@/lib/format';
import type { Offer } from '@/lib/types';
import { offerHref } from '@/lib/offer-url';
import { flagText, OFFER_TYPE_LABELS, offerSummary, REDEEM_LABELS, REJECT_REASON_LABELS } from '@/app/dashboard/_components/offer-meta';
import { AuditTrail, type AuditEntry } from '../_components/admin-ui';

export type AdminOffer = Omit<Offer, 'businessId'> & {
  businessId?: { _id: string; name: string; slug: string; town?: string; postcode?: string; verificationLevel: number; website?: string; orderUrl?: string; phone?: string; status: string };
  // Only in list rows; the drawer reads moderationFlags
  flagLabels?: string[];
  approvedBy?: { name: string };
};

type Mode = 'view' | 'edit' | 'reject';

const toDateInput = (value?: string) => (value ? new Date(value).toISOString().slice(0, 10) : '');

/** Detail drawer for one offer: everything a moderator needs, edit before approve, and the audit trail. */
export function OfferDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, error, reload } = useApi<{ offer: AdminOffer; history: AuditEntry[] }>(`/admin/offers/${id}`);
  const action = useAction();
  const [mode, setMode] = useState<Mode>('view');
  const [edit, setEdit] = useState<Partial<AdminOffer>>({});
  const [reason, setReason] = useState('misleading');
  const [note, setNote] = useState('');
  const [endsAt, setEndsAt] = useState('');

  const offer = data?.offer;

  const done = async (result: unknown) => {
    if (result === undefined) return;
    setMode('view');
    await reload();
    onChanged();
  };

  const post = (path: string, body: object, success: string) =>
    action.run(path, () => api(`/admin/offers/${id}${path}`, { method: 'POST', body: JSON.stringify(body) }), success).then(done);

  const save = (approve: boolean) =>
    action
      .run(
        'edit',
        () =>
          api(`/admin/offers/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              title: edit.title,
              displayLabel: edit.displayLabel,
              description: edit.description || undefined,
              terms: edit.terms ?? '',
              discountType: offer!.discountType,
              redemptionType: offer!.redemptionType,
              redemptionUrl: edit.redemptionUrl || undefined,
              code: offer!.redemptionType === 'code' ? edit.code : undefined,
              approve,
            }),
          }),
        approve ? 'Edited and approved' : 'Saved',
      )
      .then(done);

  const startEdit = () => {
    if (!offer) return;
    setEdit({ title: offer.title, displayLabel: offer.displayLabel, description: offer.description, terms: offer.terms, redemptionUrl: offer.redemptionUrl, code: offer.code });
    setMode('edit');
  };

  const imported = offer?.origin === 'scraper';
  const canApprove = offer && ['pending', 'paused', 'rejected', 'hidden_by_reports', 'draft'].includes(offer.status);
  const canPause = offer && ['active', 'scheduled'].includes(offer.status);

  return (
    <Drawer
      open
      onClose={onClose}
      title={offer?.title ?? 'Offer'}
      subtitle={
        offer && (
          <span className="flex items-center gap-2 flex-wrap">
            <StatusPill status={offer.status} />
            <span>{offer.businessId?.name}</span>
            {imported && <Tag>Imported</Tag>}
          </span>
        )
      }
      footer={
        offer &&
        mode === 'view' && (
          <>
            {canApprove && (
              <button className={btn.good} disabled={!!action.busy} onClick={() => post('/approve', {}, offer.startsAt && new Date(offer.startsAt) > new Date() ? 'Approved: scheduled' : 'Approved: live now')}>
                Approve
              </button>
            )}
            <button className={btn.secondary} onClick={startEdit}>
              {offer.status === 'pending' ? 'Edit before approving' : 'Edit'}
            </button>
            {canPause && (
              <button className={btn.secondary} disabled={!!action.busy} onClick={() => post('/pause', {}, 'Paused')}>
                Pause
              </button>
            )}
            {!imported && !['removed', 'expired', 'rejected'].includes(offer.status) && (
              <button className={btn.danger} onClick={() => setMode('reject')}>
                Reject
              </button>
            )}
          </>
        )
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {!offer ? (
        !error && <Spinner />
      ) : (
        <div className="flex flex-col gap-6">
          <Feedback error={action.error} notice={action.notice} />
          {(offer.moderationFlags?.length ?? 0) > 0 && (
            <Alert tone="warning" title="Held by the moderation rules">
              {offer.moderationFlags?.map(flagText).join('; ')}
            </Alert>
          )}
          {offer.moderationNote && offer.status === 'rejected' && (
            <Alert tone="danger" title={`Rejected: ${REJECT_REASON_LABELS[offer.rejectReasonCode ?? 'other'] ?? offer.rejectReasonCode}`}>
              {offer.moderationNote}
            </Alert>
          )}
          {imported && (
            <Alert tone="info">
              Imported by the robot. Source changes and expiry checks are handled in{' '}
              <Link className={btn.link} href={`/admin/scraper/offers`}>
                Import robot → Imported offers
              </Link>
              .
            </Alert>
          )}

          {mode === 'edit' && (
            <div className="flex flex-col gap-4">
              <Field label="Title" required>
                <input className={inputClass} value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
              </Field>
              <Field label="Label on the card" hint="e.g. 20% off, 2 for 1">
                <input className={inputClass} value={edit.displayLabel ?? ''} onChange={(e) => setEdit({ ...edit, displayLabel: e.target.value })} />
              </Field>
              <Field label="Description">
                <textarea rows={3} className={inputClass} value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
              </Field>
              <Field label="Terms">
                <textarea rows={3} className={inputClass} value={edit.terms ?? ''} onChange={(e) => setEdit({ ...edit, terms: e.target.value })} />
              </Field>
              <Field label="Order link">
                <input className={inputClass} value={edit.redemptionUrl ?? ''} onChange={(e) => setEdit({ ...edit, redemptionUrl: e.target.value })} />
              </Field>
              {offer.redemptionType === 'code' && (
                <Field label="Coupon code">
                  <input className={inputClass} value={edit.code ?? ''} onChange={(e) => setEdit({ ...edit, code: e.target.value })} />
                </Field>
              )}
              <div className="flex gap-3 flex-wrap">
                <button className={btn.primary} disabled={!!action.busy || !edit.title} onClick={() => save(false)}>
                  Save
                </button>
                {canApprove && (
                  <button className={btn.good} disabled={!!action.busy || !edit.title} onClick={() => save(true)}>
                    Save and approve
                  </button>
                )}
                <button className={btn.secondary} onClick={() => setMode('view')}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {mode === 'reject' && (
            <div className="flex flex-col gap-4 bg-surface rounded-3xl p-5">
              <Field label="Reason" required>
                <select className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)}>
                  {Object.entries(REJECT_REASON_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Note to the business" hint="Say what to change so it can be approved." required>
                <textarea rows={3} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <div className="flex gap-3">
                <button className={btn.danger} disabled={note.trim().length < 3 || !!action.busy} onClick={() => post('/reject', { reasonCode: reason, note: note.trim() }, 'Rejected; the business was told why')}>
                  Reject offer
                </button>
                <button className={btn.secondary} onClick={() => setMode('view')}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {mode === 'view' && (
            <>
              <dl>
                <Detail label="Label">{offer.displayLabel}</Detail>
                <Detail label="Type">{OFFER_TYPE_LABELS[offer.discountType] ?? offer.discountType}</Detail>
                <Detail label="How to redeem">{REDEEM_LABELS[offer.redemptionType] ?? offer.redemptionType}</Detail>
                <Detail label="Summary">{offerSummary(offer as unknown as Offer)}</Detail>
                {offer.description && <Detail label="Description">{offer.description}</Detail>}
                <Detail label="Terms">{offer.terms || '—'}</Detail>
                <Detail label="Order link">
                  {offer.redemptionUrl ? (
                    <a href={offer.redemptionUrl} target="_blank" rel="noopener noreferrer" className="text-primary break-all">
                      {offer.redemptionUrl}
                    </a>
                  ) : (
                    '—'
                  )}
                </Detail>
                <Detail label="Min order">{offer.minOrder ? `£${offer.minOrder}` : 'None'}</Detail>
                <Detail label="Business">
                  <Link href={`/admin/businesses?open=${offer.businessId?._id}`} className="text-primary">
                    {offer.businessId?.name}
                  </Link>{' '}
                  · level {offer.businessId?.verificationLevel} · {humanise(offer.businessId?.status)}
                </Detail>
                <Detail label="Business website">{offer.businessId?.website ?? '—'}</Detail>
                <Detail label="Created">{dateTime(offer.createdAt)}</Detail>
                {offer.publishedAt && <Detail label="Published">{dateTime(offer.publishedAt)}</Detail>}
                <Detail label="Performance">
                  {offer.impressions} views · {offer.detailViews} opens · {offer.orderClicks} order clicks
                </Detail>
                {['active', 'scheduled'].includes(offer.status) && (
                  <Detail label="Public page">
                    <Link href={offerHref(offer)} target="_blank" className="text-primary">
                      Open
                    </Link>
                  </Detail>
                )}
              </dl>

              <div className="bg-surface rounded-3xl p-5 flex flex-col gap-4">
                <Toggle
                  checked={!!offer.featured}
                  onChange={(v) => post('/feature', { featured: v }, v ? 'Featured on the homepage' : 'No longer featured')}
                  label="Featured"
                  hint="Shown in the homepage’s featured offers"
                  disabled={!!action.busy}
                />
                <div className="flex gap-3 items-end flex-wrap">
                    <Field label="End date" hint="Leave empty for ongoing" className="flex-1 min-w-[180px]">
                      <input type="date" className={inputClass} value={endsAt || toDateInput(offer.endsAt)} onChange={(e) => setEndsAt(e.target.value)} />
                    </Field>
                    <button className={btn.secondary} disabled={!!action.busy} onClick={() => post('/expiry', { endsAt: endsAt }, 'End date saved')}>
                      Set end date
                    </button>
                </div>
              </div>

              <div>
                <SectionTitle>History</SectionTitle>
                <AuditTrail entries={data.history} />
              </div>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}
