'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, assetUrl } from '@/lib/api';
import { track } from '@/lib/analytics';
import { ukDate } from '@/lib/dates';
import { offerHref } from '@/lib/offer-url';
import type { Business, Offer } from '@/lib/types';
import Countdown from '@/components/Countdown';
import FollowButton from '@/components/FollowButton';
import ReportOffer from '@/components/ReportOffer';
import VerifiedBadge, { ClaimAction, FoodbellTag } from '@/components/VerifiedBadge';
import { CopyIcon, ShareIcon } from '@/components/icons';
import { Modal } from '@/components/ui';

const WEEKDAYS: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

function sessionId() {
  try {
    return sessionStorage.getItem('truoffers_sid');
  } catch {
    return null;
  }
}

function ShareButtons({ offer, business }: { offer: Offer; business: Partial<Business> }) {
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the page's own address is only known in the browser
    setUrl(`${window.location.origin}${offerHref(offer)}`);
  }, [offer]);
  const text = `${offer.displayLabel} at ${business.name}: ${offer.title}`;
  const shared = (network: string) => track('share_offer', { offerId: offer._id, businessId: business._id, metadata: { network } });
  const link = 'w-10 h-10 rounded-full border border-line bg-card flex items-center justify-center text-[13px] font-extrabold hover:border-primary hover:text-primary transition-colors';
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm font-bold text-muted mr-1">Share</span>
      {typeof navigator !== 'undefined' && 'share' in navigator && (
        <button
          aria-label="Share"
          className={`${link} cursor-pointer`}
          onClick={() => {
            shared('native');
            void navigator.share({ title: text, url }).catch(() => {});
          }}
        >
          <ShareIcon className="w-4 h-4" />
        </button>
      )}
      <a aria-label="Share on WhatsApp" className={link} target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`} onClick={() => shared('whatsapp')}>
        WA
      </a>
      <a aria-label="Share on Facebook" className={link} target="_blank" rel="noopener noreferrer" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`} onClick={() => shared('facebook')}>
        f
      </a>
      <a aria-label="Share on X" className={link} target="_blank" rel="noopener noreferrer" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`} onClick={() => shared('x')}>
        X
      </a>
      <button
        aria-label="Copy link"
        className={`${link} cursor-pointer`}
        onClick={async () => {
          shared('copy');
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          } catch {
            /* clipboard unavailable */
          }
        }}
      >
        <CopyIcon className="w-4 h-4" />
      </button>
      {copied && <span className="text-[12px] font-bold text-verified">Link copied</span>}
    </div>
  );
}

export default function OfferDetail({ offer }: { offer: Offer }) {
  const business = (typeof offer.businessId === 'object' ? offer.businessId : {}) as Partial<Business>;
  const [copied, setCopied] = useState(false);
  const [showScreen, setShowScreen] = useState(false);
  const orderUrl = offer.redemptionUrl || business.orderUrl;

  useEffect(() => {
    track('offer_detail_view', { offerId: offer._id, businessId: business._id });
  }, [offer._id, business._id]);

  function redeemed(channel: string) {
    track('redeem_click', { offerId: offer._id, businessId: business._id, metadata: { channel } });
    void api(`/offers/${offer._id}/redeem`, { method: 'POST', body: JSON.stringify({ sessionId: sessionId(), channel }) }).catch(() => {});
  }

  async function copyCode() {
    if (!offer.code) return;
    track('code_copy', { offerId: offer._id, businessId: business._id });
    redeemed('code_copy');
    try {
      await navigator.clipboard.writeText(offer.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  const when = [
    offer.eligibleWeekdays?.length && offer.eligibleWeekdays.length < 7 ? offer.eligibleWeekdays.map((d) => WEEKDAYS[d] ?? d).join(', ') : null,
    offer.dailyStartTime && offer.dailyEndTime ? `${offer.dailyStartTime}–${offer.dailyEndTime}` : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-5xl px-5 md:px-10 py-10">
      <div className="relative overflow-hidden bg-sun-soft rounded-3xl px-7 py-10 md:px-12 mb-6">
        {offer.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetUrl(offer.imageUrl)} alt="" className="absolute inset-y-0 right-0 w-1/2 h-full object-cover hidden md:block [mask-image:linear-gradient(to_right,transparent,black_35%)]" />
        )}
        <div className="relative max-w-xl">
          <div className="font-display text-5xl md:text-6xl font-extrabold text-primary mb-3">{offer.displayLabel}</div>
          <h1 className="font-display text-2xl md:text-3xl font-extrabold tracking-tight mb-2">{offer.title}</h1>
          {offer.description && <p className="text-muted-2 leading-relaxed">{offer.description}</p>}
          {offer.endsAt && (
            <div className="mt-5 flex items-center gap-3 flex-wrap">
              <span className="text-sm font-extrabold">Ends in</span>
              <Countdown endsAt={offer.endsAt} size="lg" />
            </div>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-[1fr_320px] gap-5">
        <div className="bg-card border border-line rounded-3xl p-7">
          <h2 className="font-display text-xl font-extrabold mb-4">How to redeem</h2>
          {offer.redemptionType === 'code' && offer.code && (
            <div className="mb-5">
              <button onClick={copyCode} className="inline-flex items-center gap-3 bg-brand-deep text-white font-display font-extrabold text-2xl px-6 py-3 rounded-2xl cursor-pointer hover:bg-brand transition-colors">
                {offer.code}
                <span className="text-xs font-sans font-bold opacity-70">{copied ? 'Copied!' : 'tap to copy'}</span>
              </button>
              <p className="text-sm text-muted mt-2">Copy the code, then order online or call.</p>
            </div>
          )}
          {offer.redemptionType === 'show_in_store' && (
            <div className="mb-5">
              <button
                onClick={() => {
                  redeemed('show_in_store');
                  setShowScreen(true);
                }}
                className="btn-soft font-bold px-6 py-3 rounded-2xl cursor-pointer"
              >
                Show this in store
              </button>
              <p className="text-sm text-muted mt-2">Opens a full-screen card to show at the counter.</p>
            </div>
          )}
          {offer.redemptionType === 'phone' && (
            <p className="font-bold mb-4">
              Call {business.name}
              {business.phone ? ` on ${business.phone}` : ''} and mention <span className="text-primary">TruOffers</span>.
            </p>
          )}
          {offer.redemptionType === 'direct_link' && <p className="font-bold mb-4">Order through the button below; the discount is applied on the takeaway’s own site.</p>}

          <dl className="text-sm font-semibold text-ink-soft space-y-2 mb-6">
            {offer.minOrder > 0 && (
              <div>
                <dt className="inline font-extrabold">Minimum order: </dt>
                <dd className="inline">£{offer.minOrder}</dd>
              </div>
            )}
            <div>
              <dt className="inline font-extrabold">Available for: </dt>
              <dd className="inline">{[offer.collection && 'collection', offer.delivery && 'delivery'].filter(Boolean).join(' & ') || '—'}</dd>
            </div>
            {when.length > 0 && (
              <div>
                <dt className="inline font-extrabold">When: </dt>
                <dd className="inline">{when.join(', ')}</dd>
              </div>
            )}
            {offer.newCustomersOnly && <div className="font-extrabold">New customers only</div>}
            {offer.endsAt && (
              <div>
                <dt className="inline font-extrabold">Valid until: </dt>
                <dd className="inline">{ukDate(offer.endsAt, { weekday: 'long', day: 'numeric', month: 'long' })}</dd>
              </div>
            )}
            {offer.maxRedemptions > 0 && (
              <div>
                <dt className="inline font-extrabold">Limited: </dt>
                <dd className="inline">
                  {Math.max(0, offer.maxRedemptions - offer.redemptionCount)} of {offer.maxRedemptions} remaining
                </dd>
              </div>
            )}
            {offer.terms && (
              <div>
                <dt className="inline font-extrabold">Terms: </dt>
                <dd className="inline">{offer.terms}</dd>
              </div>
            )}
          </dl>

          <div className="flex gap-3 flex-wrap">
            {orderUrl && offer.redemptionType !== 'phone' && (
              <a
                href={orderUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  track('order_click', { offerId: offer._id, businessId: business._id });
                  if (offer.redemptionType === 'direct_link') redeemed('order_link');
                }}
                className="btn-soft font-bold px-7 py-3.5 rounded-2xl"
              >
                Order online
              </a>
            )}
            {business.phone && (
              <a
                href={`tel:${business.phone.replace(/\s+/g, '')}`}
                onClick={() => {
                  track('call_click', { offerId: offer._id, businessId: business._id });
                  if (offer.redemptionType === 'phone') redeemed('call');
                }}
                className="border border-line bg-card font-bold px-7 py-3.5 rounded-full hover:border-primary hover:text-primary transition-colors"
              >
                Call {business.phone}
              </a>
            )}
          </div>

          <div className="mt-8 pt-5 border-t border-line flex items-center justify-between gap-4 flex-wrap">
            <ShareButtons offer={offer} business={business} />
            <ReportOffer offerId={offer._id} offerTitle={offer.title} />
          </div>
        </div>

        <aside className="bg-card border border-line rounded-3xl p-7 h-fit">
          <div className="w-16 h-16 rounded-full bg-sun-soft flex items-center justify-center font-display font-extrabold text-2xl text-brand-deep mb-3 overflow-hidden">
            {business.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={assetUrl(business.logoUrl)} alt="" className="w-full h-full object-cover" />
            ) : (
              business.name?.charAt(0)
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Link href={`/takeaway/${business.slug}`} className="text-lg font-extrabold hover:text-primary transition-colors">
              {business.name}
            </Link>
            {business._id && <FollowButton businessId={business._id} />}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <VerifiedBadge level={business.verificationLevel} className="text-[13px]" />
            <FoodbellTag show={business.isFoodbellClient} />
          </div>
          <div className="text-sm font-semibold text-muted mt-2">
            {business.town} {business.postcode}
          </div>
          {business.reviews && business.reviews.rating > 0 && (
            <div className="text-sm font-bold text-star mt-1">
              ★ {business.reviews.rating.toFixed(1)} <span className="text-muted font-semibold">({business.reviews.count} reviews)</span>
            </div>
          )}
          {business._id && business.name && <ClaimAction business={{ _id: business._id, name: business.name, verificationLevel: business.verificationLevel }} className="mt-3 inline-block" />}
          <Link href={`/takeaway/${business.slug}`} className="mt-5 block text-center border border-line bg-card font-bold px-5 py-3 rounded-full hover:border-primary hover:text-primary transition-colors">
            View full profile
          </Link>
        </aside>
      </div>

      <Modal open={showScreen} onClose={() => setShowScreen(false)} title="Show this at the counter">
        <div className="bg-brand-deep text-white rounded-3xl p-8 text-center">
          <div className="text-sun text-sm font-extrabold uppercase tracking-wide">{business.name}</div>
          <div className="font-display text-5xl font-extrabold my-3">{offer.displayLabel}</div>
          <div className="text-lg font-bold">{offer.title}</div>
          {offer.terms && <div className="text-leaf-soft/85 text-sm mt-3">{offer.terms}</div>}
          <div className="text-[12px] text-leaf-soft/70 mt-5">TruOffers · {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
        </div>
      </Modal>
    </div>
  );
}
