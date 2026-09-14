import type { CheerioAPI } from 'cheerio';
import type { AdapterMatchResult, LoadedPage, OfferExtraction, PageRole, WebsiteContext } from '../adapter.types';
import { branchPageLinks, extractBusinessesFromHtml } from '../business-extractor';
import { offerTextBlocks } from '../html-blocks';
import { parseOfferBlock } from '../offer-text-parser';
import { collapse } from '../text';
import { BuiltinAdapter, PageExtraction } from './builtin-adapter';

const EMBEDDED_JSON_MAX_CHARS = 512 * 1024;
const EMBEDDED_OFFER_KEY = /offer|promo|deal|discount|voucher|coupon/i;
const TEXT_KEYS = /^(?:title|name|label|heading|headline|text|description|summary|details|terms|subtitle|body)$/i;

/**
 * Keyword and pattern detection over visible text, plus offer-like objects in embedded public JSON
 * (e.g. __NEXT_DATA__). The fallback adapter: it can read any site.
 */
export class GenericHtmlAdapter extends BuiltinAdapter {
  readonly id: string = 'generic-html';
  readonly name: string = 'Generic HTML';
  readonly version: string = '1.0.0';
  readonly priority: number = 100;

  async canHandle(ctx: WebsiteContext): Promise<AdapterMatchResult> {
    const homepage = await ctx.loadPage(ctx.site.homepageUrl);
    const blocks = homepage ? offerTextBlocks(homepage.$, { pageIsOffers: false }).length : 0;
    return { canHandle: true, score: Math.min(50, 10 + blocks * 5), reasons: [`${blocks} offer-like text blocks on the homepage`] };
  }

  extractFromPage(page: LoadedPage, roles: PageRole[], ctx: Pick<WebsiteContext, 'checkedAt'>): PageExtraction {
    return {
      businesses: extractBusinessesFromHtml(page, { branchPath: branchPathOf(page, roles) ?? '/' }),
      offers: [...this.visibleTextOffers(page, roles, ctx), ...this.embeddedJsonOffers(page, ctx)],
    };
  }

  visibleTextOffers(page: LoadedPage, roles: PageRole[], ctx: Pick<WebsiteContext, 'checkedAt'>): OfferExtraction[] {
    const branchPath = branchPathOf(page, roles);
    return offerTextBlocks(page.$, { pageIsOffers: roles.includes('offers') }).flatMap((block) =>
      parseOfferBlock(block.text, block.containerText, {
        sourceUrl: page.finalUrl,
        pageTitle: page.title,
        checkedAt: ctx.checkedAt,
        adapterId: this.id,
        adapterVersion: this.version,
        extractionMethod: 'html_pattern',
        methodPrefix: 'html',
        offerContext: block.offerContext,
        heading: block.heading,
        lastModified: page.lastModified,
      }).map((e) => ({ ...e, branchPath })),
    );
  }

  embeddedJsonOffers(page: LoadedPage, ctx: Pick<WebsiteContext, 'checkedAt'>): OfferExtraction[] {
    const blocks = embeddedOfferTexts(page.$);
    return blocks.flatMap((text) =>
      parseOfferBlock(text, text, {
        sourceUrl: page.finalUrl,
        pageTitle: page.title,
        checkedAt: ctx.checkedAt,
        adapterId: this.id,
        adapterVersion: this.version,
        extractionMethod: 'embedded_json',
        methodPrefix: 'json_embedded',
        offerContext: true,
        lastModified: page.lastModified,
      }),
    );
  }
}

// A single branch's own page; a locations page listing several branches is not itself a branch.
export function branchPathOf(page: LoadedPage, roles: PageRole[]): string | undefined {
  if (!roles.includes('branch') || branchPageLinks(page).length > 0) return undefined;
  return new URL(page.finalUrl).pathname.replace(/\/+$/, '') || '/';
}

// Text of objects that describe an offer inside JSON the page itself ships (never fetched from an API).
export function embeddedOfferTexts($: CheerioAPI): string[] {
  const texts = new Set<string>();
  const visit = (value: unknown, underOfferKey: boolean, depth: number) => {
    if (texts.size >= 200 || depth > 15 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((v) => visit(v, underOfferKey, depth + 1));
      return;
    }
    const record = value as Record<string, unknown>;
    if (underOfferKey) {
      const text = collapse(
        Object.entries(record)
          .filter(([k, v]) => TEXT_KEYS.test(k) && typeof v === 'string' && v.length <= 400)
          .map(([, v]) => String(v).replace(/<[^>]+>/g, ' '))
          .join('. '),
      );
      if (text.length >= 4) texts.add(text);
    }
    for (const [key, child] of Object.entries(record)) visit(child, underOfferKey || EMBEDDED_OFFER_KEY.test(key), depth + 1);
  };
  $('script[type="application/json" i], script#__NEXT_DATA__').each((_, el) => {
    const raw = $(el).text();
    if (!raw || raw.length > EMBEDDED_JSON_MAX_CHARS) return;
    try {
      visit(JSON.parse(raw), false, 0);
    } catch {
      // not JSON
    }
  });
  return [...texts];
}
