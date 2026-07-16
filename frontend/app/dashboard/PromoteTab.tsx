'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, API_URL } from '@/lib/api';
import { track } from '@/lib/analytics';
import type { Business, Offer, Promotion, Wallet, WalletTransaction } from '@/lib/types';

const PROMO_STATUS_STYLES: Record<string, string> = {
  active: 'bg-verified/10 text-verified',
  paused: 'bg-star/10 text-star',
  ended: 'bg-page text-muted',
};

export default function PromoteTab({ business }: { business: Business }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [topupAmount, setTopupAmount] = useState(20);
  const [dailyRate, setDailyRate] = useState(5);
  const [promoOfferId, setPromoOfferId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => {
    void api<{ wallet: Wallet; transactions: WalletTransaction[] }>(
      `/ads/wallet/${business._id}`,
    )
      .then((res) => {
        setWallet(res.wallet);
        setTransactions(res.transactions);
      })
      .catch(() => {});
    void api<Promotion[]>(`/ads/promotions/${business._id}`).then(setPromotions).catch(() => {});
    void api<Offer[]>(`/businesses/${business._id}/offers/manage`).then(setOffers).catch(() => {});
  }, [business._id]);

  useEffect(load, [load]);

  async function topup(e: React.FormEvent) {
    e.preventDefault();
    setBusy('topup');
    setError(null);
    setMessage(null);
    try {
      const res = await api<{ mode: string; url?: string }>(
        `/ads/wallet/${business._id}/topup`,
        { method: 'POST', body: JSON.stringify({ amount: topupAmount }) },
      );
      if (res.mode === 'stripe' && res.url) {
        window.location.href = res.url;
        return;
      }
      track('wallet_topup', { businessId: business._id, metadata: { amount: topupAmount } });
      setMessage(`Wallet topped up by £${topupAmount}. (Demo mode — Stripe payment in production.)`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Top-up failed');
    } finally {
      setBusy(null);
    }
  }

  async function createPromotion(e: React.FormEvent) {
    e.preventDefault();
    setBusy('promote');
    setError(null);
    setMessage(null);
    try {
      await api('/ads/promotions', {
        method: 'POST',
        body: JSON.stringify({
          businessId: business._id,
          offerId: promoOfferId || undefined,
          dailyRate,
        }),
      });
      track('promotion_created', { businessId: business._id, metadata: { dailyRate } });
      setMessage('Promotion is live — you now appear as Sponsored in local searches.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start promotion');
    } finally {
      setBusy(null);
    }
  }

  async function setPromotionStatus(promo: Promotion, status: string) {
    await api(`/ads/promotions/${promo._id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }).catch(() => {});
    load();
  }

  async function syncReviews() {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api<{ mode: string; message?: string; reviews: { rating: number; count: number } }>(
        `/businesses/${business._id}/sync-reviews`,
        { method: 'POST' },
      );
      setMessage(
        res.mode === 'google'
          ? `Google reviews synced: ${res.reviews.rating}★ from ${res.reviews.count} reviews.`
          : res.message || 'Review sync is not configured yet.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  const activeOffers = offers.filter((o) => o.status === 'active');
  const businessQrUrl = `${API_URL}/qr/business/${business.slug}.png`;

  return (
    <div className="flex flex-col gap-6">
      {message && (
        <div className="bg-verified/10 border border-verified/30 text-verified font-bold rounded-2xl px-6 py-4">
          {message}
        </div>
      )}
      {error && (
        <div className="bg-peach-2/40 border border-primary/30 text-primary-dark font-bold rounded-2xl px-6 py-4">
          {error}
        </div>
      )}

      {/* Ad wallet */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-card rounded-3xl p-7">
          <h2 className="font-display text-xl font-extrabold mb-1">Ad wallet</h2>
          <p className="text-[13px] font-semibold text-muted mb-4">
            Prepaid balance that funds your promoted placements.
          </p>
          <div className="font-display text-4xl font-extrabold">
            £{(wallet?.balance ?? 0).toFixed(2)}
          </div>
          <div className="text-[13px] font-semibold text-muted mt-1 mb-5">
            £{(wallet?.totalSpent ?? 0).toFixed(2)} spent all-time
          </div>
          <form onSubmit={topup} className="flex gap-2">
            <input
              type="number"
              min={5}
              max={1000}
              value={topupAmount}
              onChange={(e) => setTopupAmount(Number(e.target.value))}
              className="border border-line rounded-xl px-4 py-3 font-semibold outline-none bg-surface w-28"
            />
            <button
              type="submit"
              disabled={busy !== null}
              className="bg-ink text-surface font-bold px-6 py-3 rounded-full hover:bg-primary transition-colors cursor-pointer disabled:opacity-60"
            >
              {busy === 'topup' ? 'Processing…' : 'Top up'}
            </button>
          </form>
        </div>

        {/* Start a promotion */}
        <div className="bg-card rounded-3xl p-7">
          <h2 className="font-display text-xl font-extrabold mb-1">Promoted placement</h2>
          <p className="text-[13px] font-semibold text-muted mb-4">
            Boost your ranking in local searches with a Sponsored tag. Charged daily from your
            wallet; auto-pauses when the balance runs out.
          </p>
          <form onSubmit={createPromotion} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-extrabold">What to promote</span>
              <select
                value={promoOfferId}
                onChange={(e) => setPromoOfferId(e.target.value)}
                className="border border-line rounded-xl px-4 py-3 font-semibold outline-none bg-surface"
              >
                <option value="">Whole business (all offers)</option>
                {activeOffers.map((o) => (
                  <option key={o._id} value={o._id}>
                    Offer: {o.displayLabel} — {o.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-extrabold">Daily budget (£, min 2)</span>
              <input
                type="number"
                min={2}
                max={100}
                value={dailyRate}
                onChange={(e) => setDailyRate(Number(e.target.value))}
                className="border border-line rounded-xl px-4 py-3 font-semibold outline-none bg-surface w-28"
              />
            </label>
            <button
              type="submit"
              disabled={busy !== null}
              className="bg-primary text-cream font-bold py-3 rounded-full hover:bg-primary-dark transition-colors cursor-pointer disabled:opacity-60"
            >
              {busy === 'promote' ? 'Starting…' : 'Start promotion'}
            </button>
          </form>
        </div>
      </div>

      {/* Active promotions */}
      {promotions.length > 0 && (
        <div className="bg-card rounded-3xl p-7">
          <h2 className="font-display text-xl font-extrabold mb-4">Your promotions</h2>
          <div className="flex flex-col gap-3">
            {promotions.map((p) => (
              <div key={p._id} className="flex flex-col md:flex-row md:items-center gap-3 border border-line rounded-2xl px-5 py-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-extrabold text-[15px]">
                      {p.offerId && typeof p.offerId === 'object'
                        ? `Offer: ${p.offerId.displayLabel} — ${p.offerId.title}`
                        : 'Whole business'}
                    </span>
                    <span className={`text-[11px] font-extrabold uppercase px-2.5 py-1 rounded-full ${PROMO_STATUS_STYLES[p.status] || ''}`}>
                      {p.status}
                    </span>
                  </div>
                  <div className="text-[13px] font-semibold text-muted mt-1">
                    £{p.dailyRate}/day · £{p.totalSpent.toFixed(2)} spent · started{' '}
                    {new Date(p.startedAt).toLocaleDateString('en-GB')}
                  </div>
                </div>
                <div className="flex gap-2">
                  {p.status === 'active' && (
                    <button onClick={() => setPromotionStatus(p, 'paused')} className="text-[13px] font-bold border border-line px-4 py-2 rounded-full hover:border-primary cursor-pointer">
                      Pause
                    </button>
                  )}
                  {p.status === 'paused' && (
                    <button onClick={() => setPromotionStatus(p, 'active')} className="text-[13px] font-bold border border-line px-4 py-2 rounded-full hover:border-primary cursor-pointer">
                      Resume
                    </button>
                  )}
                  {p.status !== 'ended' && (
                    <button onClick={() => setPromotionStatus(p, 'ended')} className="text-[13px] font-bold text-primary border border-primary/40 px-4 py-2 rounded-full hover:bg-primary hover:text-cream transition-colors cursor-pointer">
                      End
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Marketing tools: QR + review sync */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-card rounded-3xl p-7">
          <h2 className="font-display text-xl font-extrabold mb-1">Your QR code</h2>
          <p className="text-[13px] font-semibold text-muted mb-4">
            Print it on menus, flyers and window stickers — it opens your TruOffers profile.
          </p>
          <div className="flex items-center gap-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${businessQrUrl}?size=256`}
              alt={`QR code for ${business.name}`}
              className="w-32 h-32 rounded-xl border border-line bg-white"
            />
            <a
              href={`${businessQrUrl}?size=1024`}
              download={`${business.slug}-qr.png`}
              className="bg-ink text-surface text-sm font-bold px-5 py-3 rounded-full hover:bg-primary transition-colors"
            >
              Download print size
            </a>
          </div>
        </div>

        <div className="bg-card rounded-3xl p-7">
          <h2 className="font-display text-xl font-extrabold mb-1">Google reviews</h2>
          <p className="text-[13px] font-semibold text-muted mb-4">
            Your public rating: {business.reviews?.rating || '—'}★ from {business.reviews?.count || 0}{' '}
            reviews. Pull the latest from Google.
          </p>
          <button
            onClick={syncReviews}
            disabled={syncing}
            className="bg-ink text-surface text-sm font-bold px-5 py-3 rounded-full hover:bg-primary transition-colors cursor-pointer disabled:opacity-60"
          >
            {syncing ? 'Syncing…' : 'Sync Google reviews'}
          </button>
        </div>
      </div>

      {/* Recent transactions */}
      {transactions.length > 0 && (
        <div className="bg-card rounded-3xl p-7">
          <h2 className="font-display text-xl font-extrabold mb-4">Recent wallet activity</h2>
          <div className="flex flex-col divide-y divide-line">
            {transactions.map((t) => (
              <div key={t._id} className="flex items-center gap-3 py-3">
                <span className="flex-1 text-sm font-semibold">{t.note || t.type}</span>
                <span className="text-[13px] font-semibold text-muted">
                  {new Date(t.createdAt).toLocaleDateString('en-GB')}
                </span>
                <span className={`font-extrabold ${t.amount >= 0 ? 'text-verified' : 'text-primary'}`}>
                  {t.amount >= 0 ? '+' : ''}£{Math.abs(t.amount).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
