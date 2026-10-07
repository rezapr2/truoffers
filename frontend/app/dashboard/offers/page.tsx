'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api, API_URL, errorMessage } from '@/lib/api';
import { useBusiness } from '@/lib/business-context';
import { useApi } from '@/lib/hooks';
import { calendarDate } from '@/lib/dates';
import { isMirrored, type Offer, type OfferSource } from '@/lib/types';
import { Alert, btn, EmptyState, Feedback, Spinner, StatusPill, Tabs } from '@/components/ui';
import { MoreIcon, PlusIcon } from '@/components/icons';
import { DashboardPage, PlanUsage } from '../_components/shared';
import { flagText, OFFER_TYPE_LABELS, offerSummary, REJECT_REASON_LABELS } from '../_components/offer-meta';

const TABS = [
  { value: 'live', label: 'Live' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'pending', label: 'Pending review' },
  { value: 'draft', label: 'Drafts' },
  { value: 'paused', label: 'Paused' },
  { value: 'expired', label: 'Expired' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'hidden', label: 'Removed' },
] as const;
type Tab = (typeof TABS)[number]['value'];

// An offer found on the business's website that an admin asked it to confirm.
interface PendingImport {
  _id: string;
  domain: string;
  title: string;
  terms?: string;
  promoCode?: string;
  minimumOrder?: number;
  endDate?: string;
  sources: OfferSource[];
}

function FoundOnYourWebsite({ businessId, onChange }: { businessId: string; onChange: () => void }) {
  const { data: pending, reload } = useApi<PendingImport[]>(`/businesses/${businessId}/imported-offers/pending`);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function answer(item: PendingImport, action: 'confirm' | 'reject') {
    setBusy(item._id);
    setError(null);
    try {
      await api(`/businesses/${businessId}/imported-offers/${item._id}/${action}`, { method: 'POST', body: JSON.stringify({}) });
      await reload();
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (!pending?.length) return null;
  return (
    <div className="bg-peach-2/60 border border-primary/15 rounded-3xl p-6 flex flex-col gap-4 mb-6">
      <div>
        <h3 className="font-display text-lg font-extrabold">Offers found on your website</h3>
        <p className="text-[13px] text-ink-soft">Confirm the ones that are right and they’ll be published as yours; you can edit them afterwards.</p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {pending.map((item) => (
        <div key={item._id} className="bg-card border border-line rounded-2xl px-5 py-4 flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="font-extrabold">{item.title}</div>
            <div className="text-[13px] text-muted">
              {[item.promoCode && `Code ${item.promoCode}`, item.minimumOrder && `Min order £${item.minimumOrder}`, item.endDate && `Ends ${calendarDate(item.endDate)}`, item.terms]
                .filter(Boolean)
                .join(' · ')}
            </div>
            {item.sources[0] && (
              <a href={item.sources[0].url} target="_blank" rel="noopener noreferrer" className="text-[12px] font-bold text-primary break-all">
                Found on {item.sources[0].url}
              </a>
            )}
          </div>
          <div className="flex gap-2">
            <button disabled={busy === item._id} onClick={() => answer(item, 'confirm')} className={btn.smallPrimary}>
              Confirm
            </button>
            <button disabled={busy === item._id} onClick={() => answer(item, 'reject')} className={btn.smallDanger}>
              Not ours
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function RowMenu({ offer, qr, onAction }: { offer: Offer; qr: boolean; onAction: (action: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const item = 'w-full text-left px-4 py-2 text-sm font-bold hover:bg-surface cursor-pointer';
  const pick = (action: string) => {
    setOpen(false);
    onAction(action);
  };
  return (
    <div className="relative" ref={ref}>
      <button aria-label="More actions" aria-expanded={open} onClick={() => setOpen(!open)} className="w-9 h-9 rounded-full border border-line flex items-center justify-center hover:border-primary cursor-pointer">
        <MoreIcon className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-20 w-48 bg-card border border-line rounded-2xl shadow-lg py-2">
          {['active', 'scheduled'].includes(offer.status) && (
            <button className={item} onClick={() => pick('pause')}>
              Pause
            </button>
          )}
          {offer.status === 'paused' && (
            <button className={item} onClick={() => pick('resume')}>
              Resume
            </button>
          )}
          {['draft', 'rejected'].includes(offer.status) && (
            <button className={item} onClick={() => pick('submit')}>
              Submit for publishing
            </button>
          )}
          <button className={item} onClick={() => pick('duplicate')}>
            {offer.status === 'expired' ? 'Re-post as new draft' : 'Duplicate'}
          </button>
          {qr && offer.status === 'active' && (
            <a className={`${item} block`} href={`${API_URL}/qr/offer/${offer._id}.png?size=1024`} download={`offer-${offer._id}-qr.png`}>
              QR code
            </a>
          )}
          {offer.status === 'active' && (
            <Link className={`${item} block`} href={`/offer/${offer._id}`} target="_blank">
              View on site
            </Link>
          )}
          {!isMirrored(offer) && (
            <button className={`${item} text-danger`} onClick={() => pick('delete')}>
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function OffersInner() {
  const { business, manage, reload: reloadBusiness } = useBusiness();
  const params = useSearchParams();
  const router = useRouter();
  const tab = (TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'live') as Tab;
  const { data, reload } = useApi<{ offers: Offer[]; counts: Record<string, number> }>(business ? `/businesses/${business._id}/offers/manage?tab=${tab}` : null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    await reload();
    await reloadBusiness();
  }, [reload, reloadBusiness]);

  if (!business || !manage) return <Spinner />;
  const canPromote = manage.myRole === 'owner' && business.verificationLevel >= 2;

  async function act(offer: Offer, action: string) {
    setError(null);
    setNotice(null);
    try {
      if (action === 'delete') {
        if (!confirm(`Delete “${offer.title}”? This can’t be undone.`)) return;
        await api(`/offers/${offer._id}`, { method: 'DELETE' });
        setNotice('Offer deleted.');
      } else if (action === 'duplicate') {
        const copy = await api<Offer>(`/offers/${offer._id}/duplicate`, { method: 'POST' });
        router.push(`/dashboard/offers/${copy._id}/edit`);
        return;
      } else if (action === 'submit') {
        const res = await api<{ decision: { status: string } }>(`/offers/${offer._id}/submit`, { method: 'POST' });
        setNotice(res.decision.status === 'active' ? 'Your offer is live.' : res.decision.status === 'draft' ? 'Saved. It goes live once your business is verified.' : 'Sent for review. We’ll let you know when it’s approved.');
      } else {
        await api(`/offers/${offer._id}/${action}`, { method: 'POST' });
        setNotice(action === 'pause' ? 'Offer paused.' : 'Offer resumed.');
      }
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <DashboardPage
      title="My offers"
      subtitle={<PlanUsage manage={manage} />}
      actions={
        <Link href="/dashboard/offers/new" className={btn.primary}>
          <PlusIcon className="w-4 h-4" /> Post an offer
        </Link>
      }
    >
      <FoundOnYourWebsite businessId={business._id} onChange={refresh} />
      <div className="mb-5">
        <Tabs tabs={TABS} active={tab} counts={data?.counts as Partial<Record<Tab, number>>} onChange={(value) => router.replace(`/dashboard/offers?tab=${value}`)} />
      </div>
      <Feedback error={error} notice={notice} className="mb-4" />

      {!data ? (
        <Spinner />
      ) : data.offers.length === 0 ? (
        <EmptyState
          title={tab === 'live' ? 'No live offers yet' : 'Nothing here'}
          action={tab === 'live' ? <Link href="/dashboard/offers/new" className={btn.primary}>Post your first offer</Link> : undefined}
        >
          {tab === 'live' ? 'Your first offer is the fastest way to get found.' : 'Offers in this state will show up here.'}
        </EmptyState>
      ) : (
        <div className="border border-line rounded-3xl overflow-hidden">
          <div className="hidden md:grid grid-cols-[minmax(0,1fr)_110px_120px_150px] gap-4 px-5 py-3 bg-surface text-[12px] font-extrabold uppercase tracking-wide text-muted">
            <span>Offer</span>
            <span>Views / clicks</span>
            <span>Status</span>
            <span className="text-right">Actions</span>
          </div>
          {data.offers.map((offer) => (
            <div key={offer._id} className="grid md:grid-cols-[minmax(0,1fr)_110px_120px_150px] gap-3 md:gap-4 px-5 py-4 border-t border-line first:border-t-0 md:first:border-t items-center">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-display font-extrabold text-primary">{offer.displayLabel}</span>
                  <span className="font-extrabold truncate">{offer.title}</span>
                </div>
                <div className="text-[13px] text-muted mt-0.5">
                  {OFFER_TYPE_LABELS[offer.discountType] ?? offer.discountType} · {offerSummary(offer)}
                </div>
                {offer.status === 'rejected' && (
                  <div className="text-[13px] font-bold text-danger mt-1">
                    {REJECT_REASON_LABELS[offer.rejectReasonCode ?? ''] ?? 'Needs changes'}
                    {offer.moderationNote ? `: ${offer.moderationNote}` : ''}
                  </div>
                )}
                {offer.status === 'pending' && offer.moderationFlags?.length ? (
                  <div className="text-[13px] font-semibold text-[#7a5408] mt-1">A moderator checks it because the {offer.moderationFlags.map(flagText).join(' and ')}.</div>
                ) : null}
                {offer.status === 'draft' && offer.submitWhenVerified && <div className="text-[13px] font-semibold text-muted mt-1">Goes for publishing as soon as your business is verified.</div>}
                {offer.imported && (
                  <div className="text-[12.5px] text-muted mt-1">
                    From your website ({offer.imported.domain}){offer.imported.managedBy === 'merchant_managed' ? ' · managed by you' : ' · kept in sync until you edit or confirm it'}
                  </div>
                )}
                {isMirrored(offer) && (
                  <div className="text-[12.5px] text-muted mt-1">
                    From your Foodbell site · <Link href="/dashboard/foodbell" className="font-bold text-primary">change or switch it off in Foodbell</Link>
                  </div>
                )}
                {offer.sourceChanged && <div className="text-[13px] font-bold text-star mt-1">Your website now shows something different from this offer.</div>}
              </div>
              <div className="text-sm font-bold">
                {offer.impressions} <span className="text-muted font-semibold">/ {offer.orderClicks}</span>
              </div>
              <div>
                <StatusPill status={offer.status} />
              </div>
              <div className="flex md:justify-end items-center gap-2">
                {offer.status === 'active' && canPromote && (
                  <Link href={`/dashboard/promote?offer=${offer._id}`} className={btn.smallPrimary}>
                    Promote
                  </Link>
                )}
                {!['expired', 'removed', 'hidden_by_reports', 'possibly_removed', 'expiry_review'].includes(offer.status) && !isMirrored(offer) && (
                  <Link href={`/dashboard/offers/${offer._id}/edit`} className={btn.small}>
                    Edit
                  </Link>
                )}
                <RowMenu offer={offer} qr={!!manage.plan.flags.qrCodes} onAction={(action) => act(offer, action)} />
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[13px] text-muted mt-4">Rejected offers show the moderator’s reason. Promote unlocks once an offer is live and your business is verified.</p>
    </DashboardPage>
  );
}

export default function OffersPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <OffersInner />
    </Suspense>
  );
}
