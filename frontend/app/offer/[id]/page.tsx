'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { track } from '@/lib/analytics';
import type { Offer, Business } from '@/lib/types';
import VerifiedBadge from '@/components/VerifiedBadge';
import FollowButton from '@/components/FollowButton';

export default function OfferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api<Offer>(`/offers/${id}`)
      .then((o) => {
        setOffer(o);
        const businessId = typeof o.businessId === 'object' ? (o.businessId as Business)._id : o.businessId;
        track('offer_detail_view', { offerId: o._id, businessId });
      })
      .catch(() => setNotFound(true));
  }, [id]);

  if (notFound) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-20 text-center">
        <h1 className="font-display text-3xl font-extrabold mb-3">Offer not found</h1>
        <p className="text-muted font-semibold mb-6">It may have expired or been removed.</p>
        <Link href="/offers" className="bg-ink text-surface font-bold px-6 py-3 rounded-full">
          Browse live offers
        </Link>
      </div>
    );
  }
  if (!offer) return <div className="py-24 text-center text-muted font-bold">Loading…</div>;

  const business = (typeof offer.businessId === 'object' ? offer.businessId : {}) as Partial<Business>;

  async function redeem() {
    if (!offer) return;
    track('redeem_click', { offerId: offer._id, businessId: business._id });
    void api(`/offers/${offer._id}/redeem`, {
      method: 'POST',
      body: JSON.stringify({
        sessionId: sessionStorage.getItem('truoffers_sid'),
        channel: offer.redemptionType === 'code' ? 'code_copy' : offer.redemptionType,
      }),
    }).catch(() => {});
    if (offer.code) {
      try {
        await navigator.clipboard.writeText(offer.code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch { /* ignore */ }
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-5 md:px-10 py-10">
      <div className="bg-primary text-cream rounded-3xl px-7 py-10 md:px-12 mb-6">
        <div className="font-display text-5xl md:text-6xl font-extrabold mb-3">{offer.displayLabel}</div>
        <h1 className="font-display text-2xl md:text-3xl font-extrabold tracking-tight mb-2">
          {offer.title}
        </h1>
        {offer.description && (
          <p className="text-peach font-medium max-w-xl leading-relaxed">{offer.description}</p>
        )}
      </div>

      <div className="grid md:grid-cols-[1fr_320px] gap-5">
        {/* Redemption */}
        <div className="bg-card rounded-3xl p-7">
          <h2 className="font-display text-xl font-extrabold mb-4">How to redeem</h2>
          {offer.redemptionType === 'code' && offer.code && (
            <button
              onClick={redeem}
              className="inline-flex items-center gap-3 bg-ink text-surface font-display font-extrabold text-2xl px-6 py-3 rounded-2xl cursor-pointer hover:bg-primary transition-colors mb-4"
            >
              {offer.code}
              <span className="text-xs font-sans font-bold opacity-70">
                {copied ? 'Copied!' : 'tap to copy'}
              </span>
            </button>
          )}
          {offer.redemptionType === 'show_in_store' && (
            <p className="font-bold mb-4">Show this screen in store to claim the offer.</p>
          )}
          {offer.redemptionType === 'phone' && (
            <p className="font-bold mb-4">
              Mention <span className="text-primary">TruOffers</span> when you call
              {business.phone ? ` ${business.phone}` : ''}.
            </p>
          )}
          {offer.redemptionType === 'direct_link' && (
            <p className="font-bold mb-4">Order through the link below — the discount is applied automatically.</p>
          )}

          <dl className="text-sm font-semibold text-ink-soft space-y-2 mb-6">
            {offer.minOrder > 0 && (
              <div><dt className="inline font-extrabold">Minimum order: </dt><dd className="inline">£{offer.minOrder}</dd></div>
            )}
            <div>
              <dt className="inline font-extrabold">Available for: </dt>
              <dd className="inline">
                {[offer.collection && 'collection', offer.delivery && 'delivery'].filter(Boolean).join(' & ') || '—'}
              </dd>
            </div>
            {offer.endsAt && (
              <div>
                <dt className="inline font-extrabold">Valid until: </dt>
                <dd className="inline">{new Date(offer.endsAt).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</dd>
              </div>
            )}
            {offer.maxRedemptions > 0 && (
              <div>
                <dt className="inline font-extrabold">Limited: </dt>
                <dd className="inline">{Math.max(0, offer.maxRedemptions - offer.redemptionCount)} of {offer.maxRedemptions} remaining</dd>
              </div>
            )}
            {offer.terms && (
              <div><dt className="inline font-extrabold">Terms: </dt><dd className="inline">{offer.terms}</dd></div>
            )}
          </dl>

          <div className="flex gap-3 flex-wrap">
            {(offer.redemptionUrl || business.orderUrl) && (
              <a
                href={offer.redemptionUrl || business.orderUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track('order_click', { offerId: offer._id, businessId: business._id })}
                className="bg-primary text-cream font-bold px-7 py-3.5 rounded-full hover:bg-primary-dark transition-colors"
              >
                Order now
              </a>
            )}
            {business.phone && (
              <a
                href={`tel:${business.phone}`}
                onClick={() => track('call_click', { businessId: business._id })}
                className="border-[1.5px] border-ink font-bold px-7 py-3.5 rounded-full hover:bg-ink hover:text-surface transition-colors"
              >
                Call {business.phone}
              </a>
            )}
          </div>
        </div>

        {/* Business card */}
        <aside className="bg-card rounded-3xl p-7 h-fit">
          <div className="w-16 h-16 rounded-full bg-page flex items-center justify-center font-display font-extrabold text-2xl text-primary mb-3">
            {business.name?.charAt(0)}
          </div>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Link
              href={`/takeaway/${business.slug}`}
              className="text-lg font-extrabold hover:text-primary transition-colors"
            >
              {business.name}
            </Link>
            {business._id && <FollowButton businessId={business._id} />}
          </div>
          <VerifiedBadge status={business.verificationStatus} className="text-[13px]" />
          <div className="text-sm font-semibold text-muted mt-2">
            {business.town} {business.postcode}
          </div>
          {business.reviews && business.reviews.rating > 0 && (
            <div className="text-sm font-bold text-star mt-1">
              ★ {business.reviews.rating.toFixed(1)}{' '}
              <span className="text-muted font-semibold">({business.reviews.count} reviews)</span>
            </div>
          )}
          <Link
            href={`/takeaway/${business.slug}`}
            className="mt-5 block text-center border-[1.5px] border-ink font-bold px-5 py-3 rounded-full hover:bg-ink hover:text-surface transition-colors"
          >
            View full profile
          </Link>
        </aside>
      </div>
    </div>
  );
}
