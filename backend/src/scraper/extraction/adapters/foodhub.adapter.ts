import { inflateSync } from 'node:zlib';
import { WEEKDAYS } from '../../../common/scraper.enums';
import type { AdapterMatchResult, LoadedPage, OfferExtraction, PageRole, WebsiteContext } from '../adapter.types';
import { foodhubPrerender, jsonSnippet } from '../embedded-data';
import { isIsoDate } from '../london-time';
import { collapse } from '../text';
import { PageExtraction } from './builtin-adapter';
import { embeddedOffer, setEmbeddedField } from './embedded-offer';
import { GenericHtmlAdapter } from './generic-html.adapter';
import { JsonLdAdapter } from './jsonld.adapter';
import { dealBenefitText, dealTitle, OFFER_CATEGORY } from './menu-deals';
import { PROVIDER_ADAPTER_PRIORITY } from './ordernest.adapter';

const MAX_DISCOUNTS = 20;
const MAX_DEALS = 40;
// A compressed menu may not expand past this.
const MAX_MENU_BYTES = 8 * 1024 * 1024;
const ALL_DAYS = '1,2,3,4,5,6,7';
const DISCOUNT_KEYS = ['type', 'value', 'amount', 'min_order', 'service_type', 'days', 'first_time_user', 'start_date', 'end_date', 'start_time', 'end_time', 'maximum_discount_value', 'menu_item_id'];
const DEAL_KEYS = ['name', 'description', 'price', 'collection', 'delivery'];
const DAY_FIELDS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

type Json = Record<string, unknown>;

const money = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));
const isRecord = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);
const switchedOff = (value: unknown) => value === 0 || value === '0' || value === false;
const shownOnline = (record: Json) => !switchedOff(record.show_online) && String(record.hidden ?? '0') !== '1';
const plain = (value: unknown) => collapse(String(value ?? '').replace(/<[^>]*>/g, ' '));
const clockTime = (value: unknown) => (typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d/.test(value) ? value.slice(0, 5) : undefined);

// Every advanced discount the page carries: in its prerender data, and in what its app loaded while rendering.
function advancedDiscounts(page: LoadedPage): Json[] {
  const lists: unknown[] = [foodhubPrerender(page.$)?.store.advanced_discounts];
  for (const { json } of page.dataResponses ?? []) {
    if (isRecord(json)) lists.push(json.advanced_discounts, isRecord(json.data) ? json.data.advanced_discounts : undefined);
  }
  const seen = new Set<string>();
  const out: Json[] = [];
  for (const list of lists) {
    for (const discount of Array.isArray(list) ? list : []) {
      const key = isRecord(discount) ? jsonSnippet(discount, DISCOUNT_KEYS) : '';
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(discount as Json);
    }
  }
  return out;
}

// The menu the app loaded while rendering: categories > subcat > item, often zlib-compressed and base64-encoded.
function menuCategories(page: LoadedPage): Json[] {
  const out: Json[] = [];
  for (const { url, json } of page.dataResponses ?? []) {
    if (!/\/menu\//i.test(new URL(url).pathname)) continue;
    const entries = Array.isArray(json) ? json : isRecord(json) && Array.isArray(json.data) ? json.data : [];
    for (const entry of entries) {
      const decoded = typeof entry === 'string' ? inflated(entry) : entry;
      for (const category of Array.isArray(decoded) ? decoded : [decoded]) {
        if (isRecord(category) && Array.isArray(category.subcat)) out.push(category);
      }
    }
  }
  return out;
}

function inflated(encoded: string): unknown {
  try {
    return JSON.parse(inflateSync(Buffer.from(encoded, 'base64'), { maxOutputLength: MAX_MENU_BYTES }).toString('utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Code adapter for Foodhub, a white-label ordering platform (spec §2.3). Foodhub pages are built in the
 * browser, so their HTML holds no offer text. It reads, and never calls Foodhub's API for:
 * - the store's discounts, from base64 JSON the page embeds for its own script (`#prerender-data`), or from
 *   the store data the page's app loaded when the page was rendered;
 * - the deals in the menu's offer categories ("Meal Deals", "Collection Offers"), which the app only loads in
 *   the browser, so they are read from a render.
 *
 * Foodhub marks each discount with a numeric service type but the page doesn't say which is collection and
 * which is delivery, so those offers are flagged `order_type_unconfirmed` for the reviewer to set. The store's
 * `offer_status` isn't a guide: a live site showed its discount to visitors while that said INACTIVE.
 */
export class FoodhubAdapter extends GenericHtmlAdapter {
  readonly id: string = 'provider-foodhub';
  readonly name: string = 'Foodhub provider';
  readonly version: string = '1.1.0';
  readonly priority: number = PROVIDER_ADAPTER_PRIORITY;
  readonly menuNeedsRendering: boolean = true;
  private readonly structured = new JsonLdAdapter();

  static recognises(page: LoadedPage): string[] {
    const reasons: string[] = [];
    if (foodhubPrerender(page.$)) reasons.push('Foodhub page data');
    if (/\/\/assets\.foodhub\.co(?:m|\.uk)\//i.test(page.html)) reasons.push('assets from assets.foodhub.com');
    return reasons;
  }

  async canHandle(ctx: WebsiteContext): Promise<AdapterMatchResult> {
    const homepage = await ctx.loadPage(ctx.site.homepageUrl);
    if (!homepage) return { canHandle: false, score: 0, reasons: ['homepage unavailable'] };
    const reasons = FoodhubAdapter.recognises(homepage);
    return reasons.length ? { canHandle: true, score: 100, reasons } : { canHandle: false, score: 0, reasons: ['not a Foodhub site'] };
  }

  extractFromPage(page: LoadedPage, roles: PageRole[], ctx: Pick<WebsiteContext, 'checkedAt'>): PageExtraction {
    const base = this.structured.extractFromPage(page, roles, ctx);
    const offers = [...this.discounts(page, roles, ctx), ...this.menuDeals(page, roles, ctx)];
    const known = new Set(offers.map((d) => d.offer.contentFingerprint));
    return { businesses: base.businesses, offers: [...offers, ...base.offers.filter((o) => !known.has(o.offer.contentFingerprint))] };
  }

  private discounts(page: LoadedPage, roles: PageRole[], ctx: Pick<WebsiteContext, 'checkedAt'>): OfferExtraction[] {
    const prefix = `provider:${this.id}@${this.version}`;
    const out: OfferExtraction[] = [];
    for (const discount of advancedDiscounts(page).slice(0, MAX_DISCOUNTS)) {
      const type = String(discount.type ?? '').toUpperCase();
      const percent = type === 'PERCENTAGE' ? Number(discount.value) : undefined;
      const amount = type === 'PERCENTAGE' ? undefined : Number(discount.amount) || Number(discount.value);
      if (!(percent && percent > 0 && percent <= 100) && !(amount && amount > 0)) continue;
      const minOrder = Number(discount.min_order) || 0;
      const headline = `${percent ? `${percent}%` : `£${money(amount!)}`} off${minOrder > 0 ? ` orders over £${money(minOrder)}` : ''}`;
      const sourceText = jsonSnippet(discount, DISCOUNT_KEYS);
      const extraction = embeddedOffer({ page, roles, ctx, adapterId: this.id, adapterVersion: this.version, headline, sourceText });
      if (!extraction) continue;

      if (minOrder > 0 && !extraction.offer.minimumOrder) setEmbeddedField(extraction, 'minimumOrder', minOrder, sourceText, prefix);
      if (discount.first_time_user === 'YES') setEmbeddedField(extraction, 'newCustomersOnly', true, sourceText, prefix);
      if (typeof discount.start_date === 'string' && isIsoDate(discount.start_date)) setEmbeddedField(extraction, 'startDate', discount.start_date, sourceText, prefix);
      if (typeof discount.end_date === 'string' && isIsoDate(discount.end_date)) setEmbeddedField(extraction, 'endDate', discount.end_date, sourceText, prefix);
      const from = clockTime(discount.start_time);
      const until = clockTime(discount.end_time);
      if (from && until) {
        setEmbeddedField(extraction, 'dailyStartTime', from, sourceText, prefix);
        setEmbeddedField(extraction, 'dailyEndTime', until, sourceText, prefix);
      }
      const cap = Number(discount.maximum_discount_value);
      if (cap > 0) setEmbeddedField(extraction, 'terms', `Up to £${money(cap)} off`, sourceText, prefix);

      // Collection or delivery: stated only as a number the page doesn't explain.
      if (discount.service_type !== undefined && discount.service_type !== null) extraction.flags.push('order_type_unconfirmed');
      // Which number is which weekday isn't stated either; only "every day" is certain.
      if (discount.days && String(discount.days).replace(/\s/g, '') !== ALL_DAYS) extraction.flags.push('weekdays_unconfirmed');
      // Tied to one menu item, which the discount doesn't name.
      if (discount.menu_item_id !== undefined && discount.menu_item_id !== null) extraction.flags.push('single_item_unconfirmed');
      out.push(extraction);
    }
    return out;
  }

  // Deals the takeaway lists as menu items under an offers category, with the days and order types the menu states.
  private menuDeals(page: LoadedPage, roles: PageRole[], ctx: Pick<WebsiteContext, 'checkedAt'>): OfferExtraction[] {
    const prefix = `provider:${this.id}@${this.version}`;
    const seen = new Set<string>();
    const out: OfferExtraction[] = [];
    for (const category of menuCategories(page)) {
      if (!shownOnline(category)) continue;
      for (const subcat of category.subcat as unknown[]) {
        if (!isRecord(subcat) || !shownOnline(subcat)) continue;
        const heading = `${plain(category.name)} ${plain(subcat.name)}`;
        if (!OFFER_CATEGORY.test(heading)) continue;
        for (const item of Array.isArray(subcat.item) ? subcat.item : []) {
          if (out.length >= MAX_DEALS) return out;
          if (!isRecord(item) || !shownOnline(item)) continue;
          const name = plain(item.name);
          const price = Number(item.price);
          const key = String(item.id ?? name);
          if (!name || !(price > 0) || seen.has(key)) continue;
          seen.add(key);

          const chain = [category, subcat, item];
          const collection = chain.every((r) => !switchedOff(r.collection));
          const delivery = chain.every((r) => !switchedOff(r.delivery));
          const days = WEEKDAYS.filter((_, i) => chain.every((r) => !switchedOff(r[DAY_FIELDS[i]])));
          if ((!collection && !delivery) || days.length === 0) continue;

          const description = plain(item.description);
          const sourceText = jsonSnippet(item, days.length < WEEKDAYS.length ? [...DEAL_KEYS, ...DAY_FIELDS] : DEAL_KEYS);
          const input = { page, roles, ctx, adapterId: this.id, adapterVersion: this.version, headline: dealTitle(name, description), description, sourceText };
          // The item's own wording first ("Buy one get one free"); else the deal its price makes.
          const extraction = embeddedOffer(input) ?? embeddedOffer({ ...input, benefitText: dealBenefitText(name, description, price) });
          if (!extraction) continue;
          if (!delivery || /\bcollection\b/i.test(heading)) {
            setEmbeddedField(extraction, 'collectionEligible', true, sourceText, prefix);
            setEmbeddedField(extraction, 'deliveryEligible', false, sourceText, prefix);
          } else if (!collection) {
            setEmbeddedField(extraction, 'deliveryEligible', true, sourceText, prefix);
            setEmbeddedField(extraction, 'collectionEligible', false, sourceText, prefix);
          }
          if (days.length < WEEKDAYS.length) setEmbeddedField(extraction, 'eligibleWeekdays', [...days], sourceText, prefix);
          out.push(extraction);
        }
      }
    }
    return out;
  }
}
