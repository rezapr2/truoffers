import type { MouseEvent } from 'react';
import { track, type TrackPayload } from './analytics';

// Order links say where the visitor came from. Foodbell sites remember it and, once the order is done, report it
// back (backend src/foodbell) for the business's "Foodbell orders" insight; any other site simply sees TruOffers
// in its own analytics. Nothing about the visitor is passed on.
const SAFE = /^[A-Za-z0-9_-]{1,64}$/;

/** The order link with TruOffers' referral parameters; `campaign` is the offer id, or "listing". */
export function referralUrl(url: string, campaign: string, clickId?: string): string {
  try {
    const link = new URL(url);
    if (link.protocol !== 'https:' && link.protocol !== 'http:') return url;
    link.searchParams.set('utm_source', 'truoffers');
    link.searchParams.set('utm_medium', 'referral');
    link.searchParams.set('utm_campaign', SAFE.test(campaign) ? campaign : 'listing');
    if (clickId) link.searchParams.set('tro', clickId);
    return link.toString();
  } catch {
    return url;
  }
}

function newClickId(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return `c${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * onClick for an order link: stamps a fresh click id on the link the browser is about to open and tracks the click
 * with the same id, so an order reported back can be matched to it.
 */
export function trackOrderClick(event: MouseEvent<HTMLAnchorElement>, url: string, campaign: string, payload: TrackPayload) {
  const clickId = newClickId();
  event.currentTarget.href = referralUrl(url, campaign, clickId);
  track('order_click', { ...payload, metadata: { ...payload.metadata, clickId } });
}
