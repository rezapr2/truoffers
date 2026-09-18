import type { AdapterMatchResult, LoadedPage, OfferExtraction, PageRole, WebsiteContext } from '../adapter.types';
import { foodhubPrerender, jsonSnippet } from '../embedded-data';
import { isIsoDate } from '../london-time';
import { PageExtraction } from './builtin-adapter';
import { embeddedOffer, setEmbeddedField } from './embedded-offer';
import { GenericHtmlAdapter } from './generic-html.adapter';
import { JsonLdAdapter } from './jsonld.adapter';
import { PROVIDER_ADAPTER_PRIORITY } from './ordernest.adapter';

const MAX_DISCOUNTS = 20;
const ALL_DAYS = '1,2,3,4,5,6,7';
const DISCOUNT_KEYS = ['type', 'value', 'amount', 'min_order', 'service_type', 'days', 'first_time_user', 'start_date', 'end_date', 'maximum_discount_value'];

const money = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));

/**
 * Code adapter for Foodhub, a white-label ordering platform (spec §2.3). Foodhub pages are built in the
 * browser, so their HTML holds no offer text; the store's discounts are in base64 JSON the page embeds for
 * its own script (`#prerender-data`). This reads that data, never Foodhub's API, and runs only on websites
 * whose Foodhub policy an admin has allowed: the crawl gate enforces that.
 *
 * Foodhub marks each discount with a numeric service type but the page doesn't say which is collection and
 * which is delivery, so those offers are flagged `order_type_unconfirmed` for the reviewer to set.
 */
export class FoodhubAdapter extends GenericHtmlAdapter {
  readonly id: string = 'provider-foodhub';
  readonly name: string = 'Foodhub provider';
  readonly version: string = '1.0.0';
  readonly priority: number = PROVIDER_ADAPTER_PRIORITY;
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
    const data = foodhubPrerender(page.$);
    const discounts = data ? this.discountsOn(page, roles, ctx, data.store) : [];
    const known = new Set(discounts.map((d) => d.offer.contentFingerprint));
    return { businesses: base.businesses, offers: [...discounts, ...base.offers.filter((o) => !known.has(o.offer.contentFingerprint))] };
  }

  private discountsOn(page: LoadedPage, roles: PageRole[], ctx: Pick<WebsiteContext, 'checkedAt'>, store: Record<string, unknown>): OfferExtraction[] {
    if (store.offer_status !== undefined && store.offer_status !== 'ACTIVE') return [];
    const discounts = Array.isArray(store.advanced_discounts) ? (store.advanced_discounts as Record<string, unknown>[]) : [];
    const prefix = `provider:${this.id}@${this.version}`;
    const out: OfferExtraction[] = [];
    for (const discount of discounts.slice(0, MAX_DISCOUNTS)) {
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
      const cap = Number(discount.maximum_discount_value);
      if (cap > 0) setEmbeddedField(extraction, 'terms', `Up to £${money(cap)} off`, sourceText, prefix);

      // Collection or delivery: stated only as a number the page doesn't explain.
      if (discount.service_type !== undefined && discount.service_type !== null) extraction.flags.push('order_type_unconfirmed');
      // Which number is which weekday isn't stated either; only "every day" is certain.
      if (discount.days && String(discount.days).replace(/\s/g, '') !== ALL_DAYS) extraction.flags.push('weekdays_unconfirmed');
      out.push(extraction);
    }
    return out;
  }
}
