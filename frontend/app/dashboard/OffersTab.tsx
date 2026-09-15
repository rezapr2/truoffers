'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, API_URL } from '@/lib/api';
import { track } from '@/lib/analytics';
import { calendarDate, ukDate, ukDateInputValue } from '@/lib/dates';
import type { Business, Offer, OfferCopy, OfferSource } from '@/lib/types';

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-verified/10 text-verified',
  pending: 'bg-star/10 text-star',
  paused: 'bg-page text-muted',
  rejected: 'bg-primary/10 text-primary',
  expired: 'bg-page text-muted',
  draft: 'bg-page text-muted',
};

const DISCOUNT_TYPES = [
  { value: 'percent', label: '% off' },
  { value: 'fixed', label: '£ off' },
  { value: 'free_delivery', label: 'Free delivery' },
  { value: 'bogof', label: '2 for 1' },
  { value: 'meal_deal', label: 'Meal deal / freebie' },
  { value: 'multi_buy', label: 'Multi-buy' },
  { value: 'free_item', label: 'Free item' },
  { value: 'collection_discount', label: 'Collection discount' },
  { value: 'delivery_discount', label: 'Delivery discount' },
  { value: 'custom', label: 'Other deal' },
];

const REDEMPTION_TYPES = [
  { value: 'code', label: 'Discount code' },
  { value: 'show_in_store', label: 'Show in store' },
  { value: 'direct_link', label: 'Order link' },
  { value: 'phone', label: 'Mention on phone' },
];

const EMPTY_FORM = {
  title: '',
  description: '',
  discountType: 'percent',
  value: 10,
  displayLabel: '',
  minOrder: 0,
  redemptionType: 'code',
  code: '',
  redemptionUrl: '',
  terms: '',
  endsAt: '',
  maxRedemptions: 0,
};

// An offer found on the business's website that an admin asked it to confirm.
interface PendingImport {
  _id: string;
  domain: string;
  title: string;
  shortDescription?: string;
  terms?: string;
  offerType: string;
  discountPercentage?: number;
  discountAmount?: number;
  promoCode?: string;
  minimumOrder?: number;
  endDate?: string;
  sources: OfferSource[];
  lastCheckedAt: string;
}

function formFromOffer(offer: Offer) {
  return {
    title: offer.title,
    description: offer.description ?? '',
    discountType: offer.discountType,
    value: offer.value ?? 0,
    displayLabel: offer.displayLabel,
    minOrder: offer.minOrder ?? 0,
    redemptionType: offer.redemptionType,
    code: offer.code ?? '',
    redemptionUrl: offer.redemptionUrl ?? '',
    terms: offer.terms ?? '',
    endsAt: offer.endsAt ? ukDateInputValue(offer.endsAt) : '',
    maxRedemptions: offer.maxRedemptions ?? 0,
  };
}

function OfferForm({ business, offer, onDone }: { business: Business; offer?: Offer; onDone: () => void }) {
  const [form, setForm] = useState(() => (offer ? formFromOffer(offer) : { ...EMPTY_FORM }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const label =
        form.displayLabel ||
        (form.discountType === 'percent'
          ? `${form.value}% off`
          : form.discountType === 'fixed'
            ? `£${form.value} off`
            : form.discountType === 'free_delivery'
              ? 'Free del.'
              : form.discountType === 'bogof'
                ? '2 for 1'
                : 'Deal');
      const body = JSON.stringify({
        title: form.title,
        description: form.description || undefined,
        discountType: form.discountType,
        value: Number(form.value) || 0,
        displayLabel: label,
        minOrder: Number(form.minOrder) || 0,
        redemptionType: form.redemptionType,
        code: form.redemptionType === 'code' ? form.code || undefined : undefined,
        redemptionUrl: form.redemptionType === 'direct_link' ? form.redemptionUrl || undefined : undefined,
        terms: form.terms || undefined,
        // A calendar day: the API ends the offer at the end of that day, UK time.
        endsAt: form.endsAt || undefined,
        maxRedemptions: Number(form.maxRedemptions) || 0,
      });
      if (offer) {
        await api(`/offers/${offer._id}`, { method: 'PATCH', body });
      } else {
        await api(`/businesses/${business._id}/offers`, { method: 'POST', body });
        track('offer_created', { businessId: business._id });
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : offer ? 'Could not save the offer' : 'Could not create offer');
    } finally {
      setBusy(false);
    }
  }

  // AI offer writer: drafts title/description/terms from the deal settings.
  // Uses the current title (if any) as a brief for the model.
  async function writeWithAi() {
    setWriting(true);
    setError(null);
    try {
      const res = await api<{ mode: string; copy: OfferCopy }>('/ai/offer-writer', {
        method: 'POST',
        body: JSON.stringify({
          businessId: business._id,
          discountType: form.discountType,
          value: Number(form.value) || undefined,
          minOrder: Number(form.minOrder) || undefined,
          brief: form.title || undefined,
        }),
      });
      setForm({
        ...form,
        title: res.copy.title,
        description: res.copy.description,
        terms: res.copy.terms,
        displayLabel: res.copy.displayLabel,
      });
      track('ai_offer_writer', { businessId: business._id, metadata: { mode: res.mode } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI writer unavailable');
    } finally {
      setWriting(false);
    }
  }

  return (
    <form onSubmit={submit} className="bg-card rounded-3xl p-7 flex flex-col gap-4">
      {error && (
        <div className="bg-peach-2/40 border border-primary/30 text-primary-dark text-sm font-bold rounded-xl px-4 py-3">
          {error}
        </div>
      )}
      {offer?.imported && (
        <div className="bg-page rounded-xl px-4 py-3 text-[13px] font-semibold text-ink-soft">
          This offer was imported from {offer.imported.domain}. Once you save, it’s yours: TruOffers won’t change it when your
          website changes, but will let you know.
        </div>
      )}
      <label className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-extrabold">Offer title *</span>
          <button
            type="button"
            onClick={writeWithAi}
            disabled={writing}
            className="text-[13px] font-bold text-primary border border-primary/40 px-3 py-1.5 rounded-full hover:bg-primary hover:text-cream transition-colors cursor-pointer disabled:opacity-60"
          >
            {writing ? 'Writing…' : '✨ Write it for me'}
          </button>
        </div>
        <input
          required
          minLength={4}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="e.g. 20% off orders over £15"
          className="border border-line rounded-xl px-4 py-3 font-semibold outline-none focus:border-primary bg-surface"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-extrabold">Description</span>
        <input
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="A sentence or two selling the offer"
          className="border border-line rounded-xl px-4 py-3 font-semibold outline-none focus:border-primary bg-surface"
        />
      </label>
      <div className="grid md:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-extrabold">Type</span>
          <select
            value={form.discountType}
            onChange={(e) => setForm({ ...form, discountType: e.target.value })}
            className="border border-line rounded-xl px-4 py-3 font-semibold outline-none bg-surface"
          >
            {DISCOUNT_TYPES.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </label>
        {(form.discountType === 'percent' || form.discountType === 'fixed') && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-extrabold">
              {form.discountType === 'percent' ? 'Percent' : 'Amount (£)'}
            </span>
            <input
              type="number"
              min={1}
              value={form.value}
              onChange={(e) => setForm({ ...form, value: Number(e.target.value) })}
              className="border border-line rounded-xl px-4 py-3 font-semibold outline-none bg-surface"
            />
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-extrabold">Min order (£, 0 = none)</span>
          <input
            type="number"
            min={0}
            value={form.minOrder}
            onChange={(e) => setForm({ ...form, minOrder: Number(e.target.value) })}
            className="border border-line rounded-xl px-4 py-3 font-semibold outline-none bg-surface"
          />
        </label>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-extrabold">How customers redeem</span>
          <select
            value={form.redemptionType}
            onChange={(e) => setForm({ ...form, redemptionType: e.target.value })}
            className="border border-line rounded-xl px-4 py-3 font-semibold outline-none bg-surface"
          >
            {REDEMPTION_TYPES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </label>
        {form.redemptionType === 'code' && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-extrabold">Code</span>
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="TRU20"
              className="border border-line rounded-xl px-4 py-3 font-semibold outline-none bg-surface"
            />
          </label>
        )}
        {form.redemptionType === 'direct_link' && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-extrabold">Order URL</span>
            <input
              value={form.redemptionUrl}
              onChange={(e) => setForm({ ...form, redemptionUrl: e.target.value })}
              placeholder="https://…"
              className="border border-line rounded-xl px-4 py-3 font-semibold outline-none bg-surface"
            />
          </label>
        )}
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-extrabold">Ends (optional)</span>
          <input
            type="date"
            value={form.endsAt}
            onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
            className="border border-line rounded-xl px-4 py-3 font-semibold outline-none bg-surface"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-extrabold">Redemption cap (0 = unlimited)</span>
          <input
            type="number"
            min={0}
            value={form.maxRedemptions}
            onChange={(e) => setForm({ ...form, maxRedemptions: Number(e.target.value) })}
            className="border border-line rounded-xl px-4 py-3 font-semibold outline-none bg-surface"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-extrabold">Terms</span>
        <input
          value={form.terms}
          onChange={(e) => setForm({ ...form, terms: e.target.value })}
          placeholder="e.g. Not valid with other offers"
          className="border border-line rounded-xl px-4 py-3 font-semibold outline-none bg-surface"
        />
      </label>
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={busy}
          className="flex-1 bg-ink text-surface font-bold py-3.5 rounded-full hover:bg-primary transition-colors cursor-pointer disabled:opacity-60"
        >
          {busy ? 'Saving…' : offer ? 'Save changes' : 'Publish offer'}
        </button>
        {offer && (
          <button type="button" onClick={onDone} className="border border-line font-bold px-6 py-3.5 rounded-full hover:border-primary cursor-pointer">
            Cancel
          </button>
        )}
      </div>
      {!offer && (
        <p className="text-[13px] text-muted font-semibold text-center">
          Verified businesses go live instantly; others enter the moderation queue.
        </p>
      )}
    </form>
  );
}

function FoundOnYourWebsite({ business, onChange }: { business: Business; onChange: () => void }) {
  const [pending, setPending] = useState<PendingImport[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void api<PendingImport[]>(`/businesses/${business._id}/imported-offers/pending`).then(setPending).catch(() => {});
  }, [business._id]);
  useEffect(load, [load]);

  async function answer(item: PendingImport, action: 'confirm' | 'reject') {
    const reason = action === 'reject' ? prompt('Anything we should know? (optional)') : undefined;
    if (reason === null) return;
    setBusyId(item._id);
    setError(null);
    try {
      await api(`/businesses/${business._id}/imported-offers/${item._id}/${action}`, {
        method: 'POST',
        body: JSON.stringify(action === 'reject' ? { reason: reason || undefined } : {}),
      });
      load();
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the offer');
    } finally {
      setBusyId(null);
    }
  }

  if (pending.length === 0) return null;
  return (
    <div className="bg-peach-2/30 border border-primary/20 rounded-3xl p-6 flex flex-col gap-4">
      <div>
        <h3 className="font-display text-lg font-extrabold">Offers found on your website</h3>
        <p className="text-[13px] font-semibold text-ink-soft">
          We found these on your website. Confirm the ones that are right and they’ll be published as yours; you can edit them afterwards.
        </p>
      </div>
      {error && <div className="text-sm font-bold text-primary-dark">{error}</div>}
      {pending.map((item) => (
        <div key={item._id} className="bg-card rounded-2xl px-5 py-4 flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="font-extrabold">{item.title}</div>
            <div className="text-[13px] font-semibold text-muted">
              {[
                item.promoCode && `Code ${item.promoCode}`,
                item.minimumOrder && `Min order £${item.minimumOrder}`,
                item.endDate && `Ends ${calendarDate(item.endDate)}`,
                item.terms,
              ]
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
            <button
              disabled={busyId === item._id}
              onClick={() => answer(item, 'confirm')}
              className="bg-verified text-white text-[13px] font-bold px-4 py-2 rounded-full hover:opacity-90 cursor-pointer disabled:opacity-60"
            >
              Confirm
            </button>
            <button
              disabled={busyId === item._id}
              onClick={() => answer(item, 'reject')}
              className="text-[13px] font-bold text-primary border border-primary/40 px-4 py-2 rounded-full hover:bg-primary hover:text-cream transition-colors cursor-pointer disabled:opacity-60"
            >
              Not ours
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function OffersTab({ business }: { business: Business }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(() => {
    void api<Offer[]>(`/businesses/${business._id}/offers/manage`).then(setOffers).catch(() => {});
  }, [business._id]);

  useEffect(load, [load]);

  async function setStatus(offer: Offer, status: string) {
    await api(`/offers/${offer._id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }).catch(() => {});
    load();
  }

  async function confirmImported(offer: Offer) {
    await api(`/offers/${offer._id}/confirm`, { method: 'POST' }).catch(() => {});
    load();
  }

  async function remove(offer: Offer) {
    const question = offer.imported
      ? `Remove "${offer.title}"? It will be taken down, and we won’t import it from your website again.`
      : `Delete "${offer.title}"?`;
    if (!confirm(question)) return;
    await api(`/offers/${offer._id}`, { method: 'DELETE' }).catch(() => {});
    load();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-display text-xl font-extrabold">Your offers ({offers.length})</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-primary text-cream text-sm font-bold px-6 py-3 rounded-full hover:bg-primary-dark transition-colors cursor-pointer"
        >
          {showForm ? 'Close' : '+ Create offer'}
        </button>
      </div>

      <FoundOnYourWebsite business={business} onChange={load} />

      {showForm && (
        <OfferForm
          business={business}
          onDone={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      <div className="flex flex-col gap-3">
        {offers.map((offer) =>
          editingId === offer._id ? (
            <OfferForm
              key={offer._id}
              business={business}
              offer={offer}
              onDone={() => {
                setEditingId(null);
                load();
              }}
            />
          ) : (
            <div key={offer._id} className="bg-card rounded-2xl px-6 py-5 flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-display text-lg font-extrabold text-primary">{offer.displayLabel}</span>
                  <span className="font-extrabold text-[15px]">{offer.title}</span>
                  <span className={`text-[11px] font-extrabold uppercase px-2.5 py-1 rounded-full ${STATUS_STYLES[offer.status] || ''}`}>
                    {offer.status}
                  </span>
                  {offer.imported && (
                    <span className="text-[11px] font-extrabold uppercase px-2.5 py-1 rounded-full bg-page text-ink-soft">
                      {offer.imported.verification === 'merchant_verified' ? 'Imported · confirmed' : 'Imported'}
                    </span>
                  )}
                </div>
                <div className="text-[13px] font-semibold text-muted mt-1">
                  {offer.impressions} impressions · {offer.flips} flips · {offer.orderClicks} order clicks ·{' '}
                  {offer.redemptionCount} redeemed
                  {offer.endsAt ? ` · ends ${ukDate(offer.endsAt)}` : ''}
                </div>
                {offer.imported && (
                  <div className="text-[13px] font-semibold text-ink-soft mt-1">
                    From {offer.imported.domain}
                    {offer.imported.managedBy === 'merchant_managed'
                      ? ' · managed by you'
                      : ' · kept in sync with your website until you edit or confirm it'}
                  </div>
                )}
                {offer.sourceChanged && (
                  <div className="text-[13px] font-bold text-star mt-1">This offer has changed on your website since you took it over.</div>
                )}
                {offer.moderationNote && offer.status === 'rejected' && (
                  <div className="text-[13px] font-bold text-primary mt-1">Moderator: {offer.moderationNote}</div>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                {offer.imported && offer.imported.verification !== 'merchant_verified' && (
                  <button onClick={() => confirmImported(offer)} className="text-[13px] font-bold bg-verified text-white px-4 py-2 rounded-full hover:opacity-90 cursor-pointer">
                    Confirm
                  </button>
                )}
                {!['pending', 'rejected'].includes(offer.status) && (
                  <button onClick={() => setEditingId(offer._id)} className="text-[13px] font-bold border border-line px-4 py-2 rounded-full hover:border-primary cursor-pointer">
                    Edit
                  </button>
                )}
                {offer.status === 'active' && (
                  <button onClick={() => setStatus(offer, 'paused')} className="text-[13px] font-bold border border-line px-4 py-2 rounded-full hover:border-primary cursor-pointer">
                    Pause
                  </button>
                )}
                {offer.status === 'paused' && (
                  <button onClick={() => setStatus(offer, 'active')} className="text-[13px] font-bold border border-line px-4 py-2 rounded-full hover:border-primary cursor-pointer">
                    Resume
                  </button>
                )}
                {offer.status === 'active' && (
                  <a
                    href={`${API_URL}/qr/offer/${offer._id}.png?size=1024`}
                    download={`offer-${offer._id}-qr.png`}
                    className="text-[13px] font-bold border border-line px-4 py-2 rounded-full hover:border-primary cursor-pointer"
                  >
                    QR code
                  </a>
                )}
                <button onClick={() => remove(offer)} className="text-[13px] font-bold text-primary border border-primary/40 px-4 py-2 rounded-full hover:bg-primary hover:text-cream transition-colors cursor-pointer">
                  {offer.imported ? 'Remove' : 'Delete'}
                </button>
              </div>
            </div>
          ),
        )}
        {offers.length === 0 && !showForm && (
          <div className="bg-card rounded-2xl p-10 text-center text-muted font-semibold">
            No offers yet. Your first offer is the fastest way to get found.
          </div>
        )}
      </div>
    </div>
  );
}
