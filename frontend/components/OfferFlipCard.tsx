'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Offer, Business } from '@/lib/types';
import { track } from '@/lib/analytics';
import { api } from '@/lib/api';
import { endsLabel as formatEnds } from '@/lib/dates';
import { offerHref } from '@/lib/offer-url';
import VerifiedBadge, { FoodbellTag } from './VerifiedBadge';
import ReportOffer from './ReportOffer';

function offerBusiness(offer: Offer): Partial<Business> {
  if (offer.business) return offer.business;
  if (typeof offer.businessId === 'object') return offer.businessId as Partial<Business>;
  return {};
}

function sessionId() {
  try {
    return sessionStorage.getItem('truoffers_sid');
  } catch {
    return null;
  }
}

/**
 * The offer card: the front shows the deal; "Tap to redeem" turns it over to the redeem method (order online,
 * copy code, call, or show in store). Every tap is logged and shows in the business's Insights.
 */
export default function OfferFlipCard({ offer }: { offer: Offer }) {
  const [flipped, setFlipped] = useState(false);
  const [copied, setCopied] = useState(false);
  const seenRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const business = offerBusiness(offer);
  const businessId = typeof offer.businessId === 'string' ? offer.businessId : business._id;
  const orderUrl = offer.redemptionUrl || business.orderUrl;

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

  function redeemed(channel: string) {
    void api(`/offers/${offer._id}/redeem`, { method: 'POST', body: JSON.stringify({ sessionId: sessionId(), channel }) }).catch(() => {});
  }

  async function copyCode(e: React.MouseEvent) {
    e.stopPropagation();
    if (!offer.code) return;
    track('code_copy', { offerId: offer._id, businessId });
    redeemed('code_copy');
    try {
      await navigator.clipboard.writeText(offer.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  }

  const endsLabel = offer.endsAt ? formatEnds(offer.endsAt) : offer.maxRedemptions > 0 ? `First ${offer.maxRedemptions} customers` : 'Ongoing offer';

  return (
    <div ref={cardRef} className="flip-scene h-60">
      <div className={`flip-inner h-full ${flipped ? 'flipped' : ''}`}>
        {/* FRONT */}
        <div onClick={flip} className="flip-face h-full bg-card border border-line rounded-3xl p-6 flex flex-col cursor-pointer shadow-sm hover:shadow-lg transition-shadow">
          <div className="flex items-start justify-between gap-2">
            <div className="font-display text-3xl font-extrabold text-brand-deep">{offer.displayLabel}</div>
            {offer.promoted && <span className="text-[10px] font-extrabold uppercase tracking-wide text-muted bg-page px-2 py-1 rounded-full">Promoted</span>}
          </div>
          <div className="mt-2 text-base font-extrabold flex items-center gap-2 flex-wrap">
            <span>{business.name}</span>
            <VerifiedBadge level={business.verificationLevel} className="text-[12px]" quiet />
            <FoodbellTag show={business.isFoodbellClient} />
          </div>
          <div className="text-[13px] font-semibold text-muted mt-0.5 line-clamp-2">
            {offer.title}
            {business.town ? ` · ${business.town} ${business.postcodeArea ?? ''}` : ''}
            {business.distanceMiles != null ? ` · ${business.distanceMiles} mi` : ''}
          </div>
          <div className="mt-auto flex items-center justify-between gap-2">
            <span className="text-[13px] font-bold text-primary">{endsLabel}</span>
            <span className="text-[13px] font-extrabold text-white bg-brand rounded-full px-4 py-2">Tap to redeem</span>
          </div>
        </div>

        {/* BACK */}
        <div onClick={flip} className="flip-face flip-back h-full bg-brand-deep text-white rounded-3xl p-6 flex flex-col cursor-pointer">
          <div className="text-[13px] font-bold text-sun uppercase tracking-wide">How to redeem</div>
          {offer.redemptionType === 'code' && offer.code ? (
            <button onClick={copyCode} className="mt-2 inline-flex items-center gap-2 self-start bg-white text-ink font-display font-extrabold text-xl px-4 py-1.5 rounded-xl cursor-pointer hover:bg-sun-soft transition-colors">
              {offer.code}
              <span className="text-[11px] font-sans font-bold text-muted-2">{copied ? 'Copied!' : 'tap to copy'}</span>
            </button>
          ) : (
            <div className="mt-2 text-[15px] font-bold">
              {offer.redemptionType === 'show_in_store' && 'Show this screen in store'}
              {offer.redemptionType === 'direct_link' && 'Order online — the discount is applied for you'}
              {offer.redemptionType === 'phone' && `Call${business.phone ? ` ${business.phone}` : ''} and mention TruOffers`}
            </div>
          )}
          <div className="mt-2 text-[13px] font-semibold text-leaf-soft/80 line-clamp-2">
            {offer.terms || offer.description}
            {offer.minOrder > 0 ? ` · Min order £${offer.minOrder}` : ''}
          </div>
          <div className="mt-auto flex gap-2 flex-wrap items-center">
            {orderUrl && offer.redemptionType !== 'phone' && (
              <a
                href={orderUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.stopPropagation();
                  track('order_click', { offerId: offer._id, businessId });
                  if (offer.redemptionType === 'direct_link') redeemed('order_link');
                }}
                className="btn-sun text-[13px] font-extrabold px-4 py-2 rounded-full"
              >
                Order online
              </a>
            )}
            {business.phone && (offer.redemptionType === 'phone' || offer.redemptionType === 'code') && (
              <a
                href={`tel:${business.phone.replace(/\s+/g, '')}`}
                onClick={(e) => {
                  e.stopPropagation();
                  track('call_click', { offerId: offer._id, businessId });
                  if (offer.redemptionType === 'phone') redeemed('call');
                }}
                className="btn-sun text-[13px] font-extrabold px-4 py-2 rounded-full"
              >
                Call
              </a>
            )}
            <Link href={offerHref(offer)} onClick={(e) => e.stopPropagation()} className="border-[1.5px] border-white/50 text-white text-[13px] font-bold px-4 py-2 rounded-full hover:bg-white hover:text-brand-deep transition-colors">
              Details
            </Link>
            <span onClick={(e) => e.stopPropagation()} className="ml-auto">
              <ReportOffer offerId={offer._id} offerTitle={offer.title} tone="dark" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
