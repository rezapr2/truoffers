import { createHash } from 'node:crypto';
import type { ExtractedOffer } from './adapter.types';

const STOPWORDS = new Set(
  'a an and the on off of for with to your all our in at when you get order orders every any this now just only is are be'.split(' '),
);

export function titleTokens(title: string): string[] {
  const tokens = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9£%.]+/g, ' ')
    .split(' ')
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t && !STOPWORDS.has(t));
  return [...new Set(tokens)].sort();
}

export function tokenSimilarity(a: string, b: string): number {
  const left = new Set(titleTokens(a));
  const right = new Set(titleTokens(b));
  if (left.size === 0 && right.size === 0) return 1;
  const shared = [...left].filter((t) => right.has(t)).length;
  return shared / (left.size + right.size - shared);
}

export type FingerprintInput = Pick<
  ExtractedOffer,
  'offerType' | 'discountPercentage' | 'discountAmount' | 'promotionalPrice' | 'freeItem' | 'promoCode' | 'minimumOrder' | 'applicableProducts' | 'title'
>;

// Spec §6: sha256 of normalised type|discount|code|minOrder|products|title-tokens.
export function contentFingerprint(offer: FingerprintInput): string {
  const discount =
    offer.discountPercentage ?? offer.discountAmount ?? offer.promotionalPrice ?? offer.freeItem?.trim().toLowerCase() ?? '';
  const products = [...(offer.applicableProducts ?? [])].map((p) => p.trim().toLowerCase()).sort().join(',');
  const parts = [
    offer.offerType,
    String(discount),
    (offer.promoCode ?? '').toUpperCase(),
    offer.minimumOrder === undefined ? '' : String(offer.minimumOrder),
    products,
    titleTokens(offer.title).join(' '),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}
