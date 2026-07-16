'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, API_URL } from '@/lib/api';
import { track } from '@/lib/analytics';
import type { Business, Offer, OfferCopy } from '@/lib/types';

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

export default function OffersTab({ business }: { business: Business }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);

  const load = useCallback(() => {
    void api<Offer[]>(`/businesses/${business._id}/offers/manage`).then(setOffers).catch(() => {});
  }, [business._id]);

  useEffect(load, [load]);

  async function createOffer(e: React.FormEvent) {
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
      await api(`/businesses/${business._id}/offers`, {
        method: 'POST',
        body: JSON.stringify({
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
          endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : undefined,
          maxRedemptions: Number(form.maxRedemptions) || 0,
        }),
      });
      track('offer_created', { businessId: business._id });
      setForm({ ...EMPTY_FORM });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create offer');
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

  async function setStatus(offer: Offer, status: string) {
    await api(`/offers/${offer._id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }).catch(() => {});
    load();
  }

  async function remove(offer: Offer) {
    if (!confirm(`Delete "${offer.title}"?`)) return;
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

      {showForm && (
        <form onSubmit={createOffer} className="bg-card rounded-3xl p-7 flex flex-col gap-4">
          {error && (
            <div className="bg-peach-2/40 border border-primary/30 text-primary-dark text-sm font-bold rounded-xl px-4 py-3">
              {error}
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
          <button
            type="submit"
            disabled={busy}
            className="bg-ink text-surface font-bold py-3.5 rounded-full hover:bg-primary transition-colors cursor-pointer disabled:opacity-60"
          >
            {busy ? 'Publishing…' : 'Publish offer'}
          </button>
          <p className="text-[13px] text-muted font-semibold text-center">
            Verified businesses go live instantly; others enter the moderation queue.
          </p>
        </form>
      )}

      <div className="flex flex-col gap-3">
        {offers.map((offer) => (
          <div key={offer._id} className="bg-card rounded-2xl px-6 py-5 flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-display text-lg font-extrabold text-primary">{offer.displayLabel}</span>
                <span className="font-extrabold text-[15px]">{offer.title}</span>
                <span className={`text-[11px] font-extrabold uppercase px-2.5 py-1 rounded-full ${STATUS_STYLES[offer.status] || ''}`}>
                  {offer.status}
                </span>
              </div>
              <div className="text-[13px] font-semibold text-muted mt-1">
                {offer.impressions} impressions · {offer.flips} flips · {offer.orderClicks} order clicks ·{' '}
                {offer.redemptionCount} redeemed
                {offer.endsAt ? ` · ends ${new Date(offer.endsAt).toLocaleDateString('en-GB')}` : ''}
              </div>
              {offer.moderationNote && offer.status === 'rejected' && (
                <div className="text-[13px] font-bold text-primary mt-1">Moderator: {offer.moderationNote}</div>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
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
                Delete
              </button>
            </div>
          </div>
        ))}
        {offers.length === 0 && !showForm && (
          <div className="bg-card rounded-2xl p-10 text-center text-muted font-semibold">
            No offers yet. Your first offer is the fastest way to get found.
          </div>
        )}
      </div>
    </div>
  );
}
