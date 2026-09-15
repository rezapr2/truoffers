import type { AdapterMatchResult, FieldEvidence, LoadedPage, OfferExtraction, PageRole, WebsiteContext } from '../adapter.types';
import { contentFingerprint } from '../content-fingerprint';
import { evidenceFor } from '../evidence';
import { parseOfferBlock } from '../offer-text-parser';
import { applyParser } from '../selector-config';
import { collapse, truncate } from '../text';
import { PageExtraction } from './builtin-adapter';
import { branchPathOf, GenericHtmlAdapter } from './generic-html.adapter';
import { JsonLdAdapter } from './jsonld.adapter';

export const PROVIDER_ADAPTER_PRIORITY = 400;

const normalised = (text = '') => collapse(text).toLowerCase();

// A fallback extraction is the widget's promotion if it carries the same fingerprint or promo code, or is the
// same kind of offer and quotes the widget's headline.
function describesSamePromotion(fallback: OfferExtraction, promo: OfferExtraction): boolean {
  const a = fallback.offer;
  const b = promo.offer;
  if (a.contentFingerprint === b.contentFingerprint) return true;
  if (a.promoCode && a.promoCode === b.promoCode) return true;
  if (a.offerType !== b.offerType) return false;
  const headline = normalised(b.title);
  return normalised(a.title).includes(headline) || a.sources.some((s) => normalised(s.excerpt).includes(headline));
}

/**
 * Code adapter for OrderNest, a (fictional) ordering platform whose client sites share one template.
 * It reads OrderNest's promotion widgets directly and falls back to JSON-LD and visible text for the rest.
 * Provider adapters run only where the provider's policy allows crawling; the crawl gate enforces that.
 */
export class OrderNestAdapter extends GenericHtmlAdapter {
  readonly id: string = 'provider-ordernest';
  readonly name: string = 'OrderNest provider';
  readonly version: string = '1.0.0';
  readonly priority: number = PROVIDER_ADAPTER_PRIORITY;
  private readonly structured = new JsonLdAdapter();

  static recognises(page: LoadedPage): string[] {
    const reasons: string[] = [];
    const generator = page.$('meta[name="generator" i]').attr('content') ?? '';
    if (/\bordernest sites\b/i.test(generator)) reasons.push(`generator "${generator}"`);
    if (page.$('[data-on-store]').length > 0) reasons.push('OrderNest store widget');
    return reasons;
  }

  async canHandle(ctx: WebsiteContext): Promise<AdapterMatchResult> {
    const homepage = await ctx.loadPage(ctx.site.homepageUrl);
    if (!homepage) return { canHandle: false, score: 0, reasons: ['homepage unavailable'] };
    const reasons = OrderNestAdapter.recognises(homepage);
    return reasons.length ? { canHandle: true, score: 100, reasons } : { canHandle: false, score: 0, reasons: ['not an OrderNest site'] };
  }

  extractFromPage(page: LoadedPage, roles: PageRole[], ctx: Pick<WebsiteContext, 'checkedAt'>): PageExtraction {
    const base = this.structured.extractFromPage(page, roles, ctx);
    const promos = this.promotionsOn(page, roles, ctx);
    // The fallback extractors read the same widgets as visible text, with different title wording, so a
    // content fingerprint alone doesn't recognise them as the same offer.
    const fallback = base.offers.filter((o) => !promos.some((promo) => describesSamePromotion(o, promo)));
    return { businesses: base.businesses, offers: [...promos, ...fallback] };
  }

  private promotionsOn(page: LoadedPage, roles: PageRole[], ctx: Pick<WebsiteContext, 'checkedAt'>): OfferExtraction[] {
    const { $ } = page;
    const method = (field: string) => `provider:${this.id}@${this.version}:${field}`;
    const out: OfferExtraction[] = [];
    $('[data-on-promo-id]').each((_, node) => {
      const widget = $(node);
      const headline = collapse(widget.find('.on-promo-headline').text());
      const rules = collapse(widget.find('.on-promo-rules').text());
      const codeText = collapse(widget.find('.on-promo-code').text());
      if (!headline) return;
      const [parsed] = parseOfferBlock(headline, [headline, rules, codeText].filter(Boolean).join('. '), {
        sourceUrl: page.finalUrl,
        pageTitle: page.title,
        checkedAt: ctx.checkedAt,
        adapterId: this.id,
        adapterVersion: this.version,
        extractionMethod: 'provider',
        methodPrefix: `provider:${this.id}@${this.version}`,
        offerContext: true,
        lastModified: page.lastModified,
      });
      if (!parsed) return;
      const evidence: Record<string, FieldEvidence> = {};
      for (const [field, entry] of Object.entries(parsed.offer.evidence)) evidence[field] = { ...entry, method: method(field) };
      const offer = { ...parsed.offer, title: truncate(headline, 120), evidence };
      evidence.title = evidenceFor(page.finalUrl, headline, method('title'));
      const code = codeText ? applyParser('promo_code', codeText, { checkedAt: ctx.checkedAt, pageUrl: page.finalUrl }) : { kind: 'none' as const };
      if (code.kind === 'text') {
        offer.promoCode = code.value;
        evidence.promoCode = evidenceFor(page.finalUrl, codeText, method('promoCode'));
      }
      offer.contentFingerprint = contentFingerprint(offer);
      out.push({ ...parsed, offer, signals: { ...parsed.signals, promoCodeFound: !!offer.promoCode }, pageUrl: page.finalUrl, branchPath: branchPathOf(page, roles) });
    });
    return out;
  }
}
