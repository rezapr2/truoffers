import type { AdapterMatchResult, LoadedPage, OfferExtraction, PageRole, WebsiteContext } from '../adapter.types';
import { jsonObjectsStartingWith, jsonSnippet, jsonValuesForKey, nextFlightText } from '../embedded-data';
import { londonDate } from '../london-time';
import { collapse } from '../text';
import { PageExtraction } from './builtin-adapter';
import { embeddedOffer, setEmbeddedField } from './embedded-offer';
import { GenericHtmlAdapter } from './generic-html.adapter';
import { JsonLdAdapter } from './jsonld.adapter';
import { dealBenefitText, OFFER_CATEGORY } from './menu-deals';
import { PROVIDER_ADAPTER_PRIORITY } from './ordernest.adapter';

const MAX_OFFERS = 30;
const ITEM_KEYS = ['item_name', 'item_description', 'price_delivery', 'price_collection', 'only_collection', 'only_delivery', 'active_days'];

function priceOf(list: unknown): number | undefined {
  const price = Array.isArray(list) ? Number((list[0] as { price?: unknown })?.price) : NaN;
  return Number.isFinite(price) && price > 0 ? price : undefined;
}

/**
 * The benefit of a deal the takeaway files under an offers category but states only as a price: a multi-buy
 * ("Any 2 x 8" Pizzas"), a bundle, or a collection price. Undefined when the item has no price.
 */
export function dealBenefit(item: Record<string, unknown>, collectionCategory: boolean): { text: string; collectionOnly: boolean } | undefined {
  const collectionOnly = collectionCategory || String(item.only_collection) === '1';
  const price = collectionOnly ? (priceOf(item.price_collection) ?? priceOf(item.prices)) : (priceOf(item.price_delivery) ?? priceOf(item.prices));
  if (!price) return undefined;
  return { text: dealBenefitText(String(item.item_name ?? ''), plain(item.item_description), price), collectionOnly };
}

function plain(html: unknown): string {
  // "25 Sep,2029" -> "25 Sep, 2029", so the date reads like the text a customer sees.
  return collapse(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/,(\d{4})\b/g, ', $1');
}

function untilDate(text: string): string | undefined {
  const match = /\buntil\s+(\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{4})\b/i.exec(text);
  if (!match) return undefined;
  const date = new Date(`${match[1].replace(',', '')} 12:00 UTC`);
  return Number.isNaN(date.getTime()) ? undefined : londonDate(date);
}

/**
 * Code adapter for Grub24, a white-label ordering platform (spec §2.3). Grub24 sites are Next.js apps whose
 * content arrives in the page's streamed data (`self.__next_f`), not as HTML. This reads the offers list and
 * the deals in offer categories from that data, never Grub24's API, and runs only on websites whose Grub24
 * policy an admin has allowed: the crawl gate enforces that.
 */
export class Grub24Adapter extends GenericHtmlAdapter {
  readonly id: string = 'provider-grub24';
  readonly name: string = 'Grub24 provider';
  readonly version: string = '1.0.0';
  readonly priority: number = PROVIDER_ADAPTER_PRIORITY;
  private readonly structured = new JsonLdAdapter();

  static recognises(page: LoadedPage): string[] {
    const reasons: string[] = [];
    if (/\/\/(?:[a-z0-9-]+\.)*grub24\.co\.uk\//i.test(page.html)) reasons.push('assets from grub24.co.uk');
    if (reasons.length && page.html.includes('__next_f')) reasons.push('Grub24 page data');
    return reasons;
  }

  async canHandle(ctx: WebsiteContext): Promise<AdapterMatchResult> {
    const homepage = await ctx.loadPage(ctx.site.homepageUrl);
    if (!homepage) return { canHandle: false, score: 0, reasons: ['homepage unavailable'] };
    const reasons = Grub24Adapter.recognises(homepage);
    return reasons.length ? { canHandle: true, score: 100, reasons } : { canHandle: false, score: 0, reasons: ['not a Grub24 site'] };
  }

  extractFromPage(page: LoadedPage, roles: PageRole[], ctx: Pick<WebsiteContext, 'checkedAt'>): PageExtraction {
    const base = this.structured.extractFromPage(page, roles, ctx);
    const flight = nextFlightText(page.$);
    const offers = flight ? [...this.offersList(page, roles, ctx, flight), ...this.offerCategories(page, roles, ctx, flight)].slice(0, MAX_OFFERS) : [];
    const known = new Set(offers.map((o) => o.offer.contentFingerprint));
    return { businesses: base.businesses, offers: [...offers, ...base.offers.filter((o) => !known.has(o.offer.contentFingerprint))] };
  }

  // The store's own offers list: [{ "msg": "15% Off over £20.00 if delivery", "details": "...", "value": {...} }]
  private offersList(page: LoadedPage, roles: PageRole[], ctx: Pick<WebsiteContext, 'checkedAt'>, flight: string): OfferExtraction[] {
    const prefix = `provider:${this.id}@${this.version}`;
    const seen = new Set<string>();
    const out: OfferExtraction[] = [];
    for (const list of jsonValuesForKey(flight, 'offers')) {
      if (!Array.isArray(list)) continue;
      for (const entry of list as Record<string, unknown>[]) {
        const msg = typeof entry?.msg === 'string' ? collapse(entry.msg) : '';
        if (!msg || seen.has(msg)) continue;
        seen.add(msg);
        const details = plain(entry.details);
        const sourceText = JSON.stringify({ msg, details, value: entry.value });
        const extraction = embeddedOffer({ page, roles, ctx, adapterId: this.id, adapterVersion: this.version, headline: msg, description: details, sourceText });
        if (!extraction) continue;
        const text = `${msg} ${details}`;
        if (/\b(?:if|on|for)\s+delivery\b/i.test(text) && !/\bcollection\b/i.test(text)) {
          setEmbeddedField(extraction, 'deliveryEligible', true, sourceText, prefix);
          setEmbeddedField(extraction, 'collectionEligible', false, sourceText, prefix);
        } else if (/\b(?:if|on|for)\s+collection\b/i.test(text) && !/\bdelivery\b/i.test(text)) {
          setEmbeddedField(extraction, 'collectionEligible', true, sourceText, prefix);
          setEmbeddedField(extraction, 'deliveryEligible', false, sourceText, prefix);
        }
        const until = untilDate(details);
        if (until && !extraction.offer.endDate) setEmbeddedField(extraction, 'endDate', until, sourceText, prefix);
        out.push(extraction);
      }
    }
    return out;
  }

  // Deals the takeaway lists as menu items in an offers category.
  private offerCategories(page: LoadedPage, roles: PageRole[], ctx: Pick<WebsiteContext, 'checkedAt'>, flight: string): OfferExtraction[] {
    const prefix = `provider:${this.id}@${this.version}`;
    const seen = new Set<string>();
    const out: OfferExtraction[] = [];
    for (const category of jsonObjectsStartingWith(flight, 'category_id')) {
      if (typeof category.category_name !== 'string' || !OFFER_CATEGORY.test(category.category_name)) continue;
      const collectionCategory = /\bcollection\b/i.test(category.category_name);
      const items = Array.isArray(category.item) ? (category.item as Record<string, unknown>[]) : [];
      for (const item of items) {
        const key = String(item.item_id ?? item.item_name);
        const name = typeof item.item_name === 'string' ? collapse(item.item_name) : '';
        if (!name || seen.has(key)) continue;
        seen.add(key);
        const sourceText = jsonSnippet(item, ITEM_KEYS);
        const input = { page, roles, ctx, adapterId: this.id, adapterVersion: this.version, headline: name, description: plain(item.item_description), sourceText };
        // The item's own wording first ("Buy one 16inch pizza get one 8inch free"); else the deal its price makes.
        let extraction = embeddedOffer(input);
        const deal = extraction ? undefined : dealBenefit(item, collectionCategory);
        if (!extraction && deal) extraction = embeddedOffer({ ...input, benefitText: deal.text });
        if (!extraction) continue;
        if (deal?.collectionOnly || String(item.only_collection) === '1') {
          setEmbeddedField(extraction, 'collectionEligible', true, sourceText, prefix);
          setEmbeddedField(extraction, 'deliveryEligible', false, sourceText, prefix);
        } else if (String(item.only_delivery) === '1') {
          setEmbeddedField(extraction, 'deliveryEligible', true, sourceText, prefix);
          setEmbeddedField(extraction, 'collectionEligible', false, sourceText, prefix);
        }
        out.push(extraction);
      }
    }
    return out;
  }
}
