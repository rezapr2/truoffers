'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Offer, Business } from '@/lib/types';
import { track } from '@/lib/analytics';
import { api } from '@/lib/api';
import VerifiedBadge from './VerifiedBadge';

function offerBusiness(offer: Offer): Partial<Business> {
  if (offer.business) return offer.business;
  if (typeof offer.businessId === 'object') return offer.businessId as Partial<Business>;
  return {};
}

/**
 * The blueprint's signature interaction: offer card front shows the deal,
 * tapping flips it to reveal how to redeem (section 20 wireframe).
 */
export default function OfferFlipCard({ offer }: { offer: Offer }) {
  const [flipped, setFlipped] = useState(false);
  const [copied, setCopied] = useState(false);
  const seenRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const business = offerBusiness(offer);
  const businessId = typeof offer.businessId === 'string' ? offer.businessId : business._id;

  // offer_impression when the card enters the viewport
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !seenRef.current) {
          seenRef.current = true;
          track('offer_impression', { offerId: offer._id, businessId });
          obs.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [offer._id, businessId]);

  function flip() {
    if (!flipped) track('offer_flip', { offerId: offer._id, businessId });
    setFlipped(!flipped);
  }

  async function copyCode(e: React.MouseEvent) {
    e.stopPropagation();
    if (!offer.code) return;
    track('redeem_click', { offerId: offer._id, businessId, metadata: { type: 'code_copy' } });
    void api(`/offers/${offer._id}/redeem`, {
      method: 'POST',
      body: JSON.stringify({ sessionId: sessionStorage.getItem('truoffers_sid'), channel: 'code_copy' }),
    }).catch(() => {});
    try {
      await navigator.clipboard.writeText(offer.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  }

  function orderClick(e: React.MouseEvent) {
    e.stopPropagation();
    track('order_click', { offerId: offer._id, businessId });
  }

  const endsLabel = offer.endsAt
    ? `Ends ${new Date(offer.endsAt).toLocaleDateString('en-GB', { weekday: 'long' })}`
    : offer.maxRedemptions > 0
      ? `First ${offer.maxRedemptions} customers`
      : 'Ongoing offer';

  return (
    <div ref={cardRef} className="flip-scene h-56">
      <div className={`flip-inner h-full ${flipped ? 'flipped' : ''}`}>
        {/* FRONT */}
        <div
          onClick={flip}
          className="flip-face h-full bg-card rounded-2xl p-6 flex flex-col cursor-pointer shadow-sm hover:shadow-lg transition-shadow"
        >
          <div className="font-display text-3xl font-extrabold text-primary">{offer.displayLabel}</div>
          <div className="mt-2 text-base font-extrabold">
            {business.name}{' '}
            <VerifiedBadge status={business.verificationStatus} className="text-[12px]" />
          </div>
          <div className="text-[13px] font-semibold text-muted mt-0.5 line-clamp-2">
            {offer.title}
            {business.town ? ` · ${business.town} ${business.postcodeArea ?? ''}` : ''}
            {business.distanceMiles != null ? ` · ${business.distanceMiles} mi` : ''}
          </div>
          <div className="mt-auto flex items-center justify-between">
            <span className="text-[13px] font-bold text-primary">{endsLabel}</span>
            <span className="text-[13px] font-bold text-ink-soft border-[1.5px] border-ink rounded-full px-4 py-2">
              Tap to redeem
            </span>
          </div>
        </div>

        {/* BACK */}
        <div
          onClick={flip}
          className="flip-face flip-back h-full bg-ink text-surface rounded-2xl p-6 flex flex-col cursor-pointer"
        >
          <div className="text-[13px] font-bold text-peach uppercase tracking-wide">How to redeem</div>
          {offer.redemptionType === 'code' && offer.code ? (
            <button
              onClick={copyCode}
              className="mt-2 inline-flex items-center gap-2 self-start bg-surface text-ink font-display font-extrabold text-xl px-4 py-1.5 rounded-xl cursor-pointer hover:bg-peach-2 transition-colors"
            >
              {offer.code}
              <span className="text-[11px] font-sans font-bold text-muted-2">
                {copied ? 'Copied!' : 'tap to copy'}
              </span>
            </button>
          ) : (
            <div className="mt-2 text-[15px] font-bold">
              {offer.redemptionType === 'show_in_store' && 'Show this screen in store'}
              {offer.redemptionType === 'direct_link' && 'Order via the link — discount auto-applied'}
              {offer.redemptionType === 'phone' && 'Mention TruOffers when you call'}
            </div>
          )}
          <div className="mt-2 text-[13px] font-semibold text-peach-2/80 line-clamp-2">
            {offer.terms || offer.description}
            {offer.minOrder > 0 ? ` · Min order £${offer.minOrder}` : ''}
          </div>
          <div className="mt-auto flex gap-2 flex-wrap">
            {(offer.redemptionUrl || business.orderUrl) && (
              <a
                href={offer.redemptionUrl || business.orderUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={orderClick}
                className="bg-primary text-cream text-[13px] font-bold px-4 py-2 rounded-full hover:bg-primary-dark transition-colors"
              >
                Order now
              </a>
            )}
            {business.slug && (
              <Link
                href={`/takeaway/${business.slug}`}
                onClick={(e) => e.stopPropagation()}
                className="border-[1.5px] border-surface text-surface text-[13px] font-bold px-4 py-2 rounded-full hover:bg-surface hover:text-ink transition-colors"
              >
                View profile
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
