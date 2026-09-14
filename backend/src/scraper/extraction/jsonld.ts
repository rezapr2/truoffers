import type { CheerioAPI } from 'cheerio';
import { canonicalUkPostcode, normaliseUkPhone } from '../../common/business-identity';
import { siteDomainOf } from '../safety/url';
import type { ExtractedBusiness, FieldEvidence, LoadedPage, OfferExtraction } from './adapter.types';
import { contentFingerprint } from './content-fingerprint';
import { evidenceFor } from './evidence';
import { isIsoDate, londonDate } from './london-time';
import { BlockContext, parseOfferBlock } from './offer-text-parser';
import { collapse, parseMoney } from './text';

const MAX_BLOCK_CHARS = 256 * 1024;
const MAX_NODES = 2_000;
export const BUSINESS_TYPE = /^(?:Restaurant|FoodEstablishment|FastFoodRestaurant|CafeOrCoffeeShop|Bakery|BarOrPub|IceCreamShop|Brewery|Winery|Distillery|LocalBusiness|Store|TakeAway|Takeaway)$/i;
const OFFER_TYPE = /^(?:Offer|AggregateOffer)$/i;

export interface JsonLdNode {
  types: string[];
  data: Record<string, any>;
}

function typesOf(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return raw.map((t) => String(t).replace(/^https?:\/\/schema\.org\//i, ''));
}

export function jsonLdNodes($: CheerioAPI): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  const visit = (value: unknown, depth: number) => {
    if (nodes.length >= MAX_NODES || depth > 12 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((v) => visit(v, depth + 1));
      return;
    }
    const record = value as Record<string, any>;
    const types = typesOf(record['@type']);
    if (types.length) nodes.push({ types, data: record });
    for (const [key, child] of Object.entries(record)) {
      if (key !== '@context') visit(child, depth + 1);
    }
  };
  $('script[type="application/ld+json" i]').each((_, el) => {
    const raw = $(el).text().replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '').trim();
    if (!raw || raw.length > MAX_BLOCK_CHARS) return;
    try {
      visit(JSON.parse(raw), 0);
    } catch {
      // Malformed JSON-LD is ignored; visible content is still extracted.
    }
  });
  return nodes;
}

function snippet(data: Record<string, any>, keys: string[]): string {
  const picked = Object.fromEntries(keys.filter((k) => data[k] !== undefined).map((k) => [k, data[k]]));
  return JSON.stringify(picked);
}

function addressOf(value: any): { text: string; postcode?: string; town?: string } | null {
  if (!value) return null;
  const address = Array.isArray(value) ? value[0] : value;
  if (typeof address === 'string') {
    const postcode = canonicalUkPostcode(/([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\s*$/i.exec(address)?.[1]);
    return { text: address, postcode: postcode ?? undefined };
  }
  const parts = [address.streetAddress, address.addressLocality, address.addressRegion].filter(Boolean).map(String);
  return {
    text: collapse(parts.join(', ')),
    postcode: canonicalUkPostcode(address.postalCode) ?? undefined,
    town: address.addressLocality ? String(address.addressLocality) : undefined,
  };
}

function branchPathFor(data: Record<string, any>, siteDomain: string, postcode?: string): string | undefined {
  if (typeof data.url === 'string') {
    try {
      const url = new URL(data.url);
      if (siteDomainOf(url.hostname) === siteDomain) return url.pathname.replace(/\/+$/, '') || '/';
    } catch {
      // fall through
    }
  }
  return postcode ? `/@${postcode.replace(/\s+/g, '')}` : undefined;
}

function businessFromNode(node: JsonLdNode, page: LoadedPage, branchPath: string): ExtractedBusiness {
  const { data } = node;
  const url = page.finalUrl;
  const type = node.types[0];
  const evidence: Record<string, FieldEvidence> = {};
  const business: ExtractedBusiness = { branchPath, sourceUrl: url, evidence };
  const cite = (field: string, keys: string[]) => {
    evidence[field] = evidenceFor(url, snippet(data, keys), `jsonld:${type}.${keys[0]}`);
  };
  if (data.name) {
    business.name = collapse(String(data.name));
    cite('name', ['name']);
  }
  const phone = normaliseUkPhone(typeof data.telephone === 'string' ? data.telephone : undefined);
  if (phone) {
    business.telephone = phone;
    cite('telephone', ['telephone']);
  }
  const address = addressOf(data.address);
  if (address) {
    business.address = address.text;
    cite('address', ['address']);
    if (address.postcode) {
      business.postcode = address.postcode;
      cite('postcode', ['address']);
    }
    if (address.town) {
      business.town = address.town;
      cite('town', ['address']);
    }
  }
  if (typeof data.url === 'string') {
    business.website = data.url;
    cite('website', ['url']);
  }
  const order = data.potentialAction?.target?.urlTemplate ?? data.potentialAction?.target;
  if (typeof order === 'string' && /^https?:\/\//.test(order)) {
    business.orderUrl = order;
    evidence.orderUrl = evidenceFor(url, JSON.stringify({ potentialAction: data.potentialAction }), `jsonld:${type}.potentialAction`);
  }
  return business;
}

export function businessesFromJsonLd(nodes: JsonLdNode[], page: LoadedPage): ExtractedBusiness[] {
  const siteDomain = siteDomainOf(new URL(page.finalUrl).hostname);
  const businessNodes = nodes.filter((n) => n.types.some((t) => BUSINESS_TYPE.test(t)));
  if (businessNodes.length === 0) return [];

  const childNodes = new Set<Record<string, any>>();
  for (const node of businessNodes) {
    for (const key of ['department', 'subOrganization', 'location', 'branch']) {
      const children = Array.isArray(node.data[key]) ? node.data[key] : node.data[key] ? [node.data[key]] : [];
      children.forEach((c: unknown) => c && typeof c === 'object' && childNodes.add(c as Record<string, any>));
    }
  }

  const results = new Map<string, ExtractedBusiness>();
  for (const node of businessNodes) {
    const isChild = childNodes.has(node.data);
    const address = addressOf(node.data.address);
    const hasChildren = businessNodes.some((n) => n !== node && childNodes.has(n.data));
    const branchPath = isChild
      ? branchPathFor(node.data, siteDomain, address?.postcode)
      : hasChildren && !address
        ? undefined
        : '/';
    if (!branchPath || results.has(branchPath)) continue;
    const business = businessFromNode(node, page, branchPath);
    if (isChild) business.branchLabel = address?.town ?? business.name;
    results.set(branchPath, business);
  }
  return [...results.values()];
}

export function offersFromJsonLd(nodes: JsonLdNode[], page: LoadedPage, ctx: Omit<BlockContext, 'methodPrefix' | 'structuredData' | 'offerContext'>): OfferExtraction[] {
  const extractions: OfferExtraction[] = [];
  for (const node of nodes.filter((n) => n.types.some((t) => OFFER_TYPE.test(t)))) {
    const { data } = node;
    const type = node.types[0];
    const text = [data.name, data.description, data.category, data.eligibleCustomerType?.name ?? data.eligibleCustomerType]
      .filter((v) => typeof v === 'string' && v.trim())
      .join('. ');
    if (!text) continue;
    // Plain menu prices have no promotional wording, so the parser finds no benefit and they are skipped.
    const parsed = parseOfferBlock(String(data.name ?? text), text, {
      ...ctx,
      methodPrefix: `jsonld:${type}`,
      structuredData: true,
      offerContext: true,
    });
    for (const extraction of parsed) {
      const { offer } = extraction;
      const cite = (field: string, keys: string[]) => {
        offer.evidence[field] = evidenceFor(page.finalUrl, snippet(data, keys), `jsonld:${type}.${keys[0]}`);
      };
      const validFrom = typeof data.validFrom === 'string' ? toLondonDate(data.validFrom) : undefined;
      if (validFrom) {
        offer.startDate = validFrom;
        cite('startDate', ['validFrom']);
      }
      const until = data.validThrough ?? data.priceValidUntil;
      const validThrough = typeof until === 'string' ? toLondonDate(until) : undefined;
      if (validThrough) {
        offer.endDate = validThrough;
        cite('endDate', [data.validThrough ? 'validThrough' : 'priceValidUntil']);
      }
      const minPrice = parseMoney(String(data.eligibleTransactionVolume?.minPrice ?? data.eligibleTransactionVolume?.price ?? ''));
      if (minPrice && !offer.minimumOrder) {
        offer.minimumOrder = minPrice;
        cite('minimumOrder', ['eligibleTransactionVolume']);
      }
      offer.contentFingerprint = contentFingerprint(offer);
      extraction.signals.datesIdentified = !!(offer.startDate || offer.endDate);
      extraction.signals.stale = extraction.signals.stale || (!!offer.endDate && offer.endDate < londonDate(ctx.checkedAt));
      extractions.push(extraction);
    }
  }
  return extractions;
}

function toLondonDate(value: string): string | undefined {
  if (isIsoDate(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : londonDate(date);
}
