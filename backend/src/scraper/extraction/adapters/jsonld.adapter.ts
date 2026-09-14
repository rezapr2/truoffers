import type { AdapterMatchResult, LoadedPage, PageRole, WebsiteContext } from '../adapter.types';
import { extractBusinessesFromHtml } from '../business-extractor';
import { BUSINESS_TYPE, businessesFromJsonLd, jsonLdNodes, offersFromJsonLd } from '../jsonld';
import { mergeBusinesses, PageExtraction } from './builtin-adapter';
import { branchPathOf, GenericHtmlAdapter } from './generic-html.adapter';

/**
 * Structured data first (schema.org JSON-LD), then the same visible-text detection as the generic
 * adapter for anything the structured data doesn't describe.
 */
export class JsonLdAdapter extends GenericHtmlAdapter {
  readonly id = 'generic-jsonld';
  readonly name = 'Generic JSON-LD';
  readonly version = '1.0.0';
  readonly priority = 200;

  async canHandle(ctx: WebsiteContext): Promise<AdapterMatchResult> {
    const homepage = await ctx.loadPage(ctx.site.homepageUrl);
    if (!homepage) return { canHandle: false, score: 0, reasons: ['homepage unavailable'] };
    const nodes = jsonLdNodes(homepage.$);
    const businesses = nodes.filter((n) => n.types.some((t) => BUSINESS_TYPE.test(t))).length;
    const offers = offersFromJsonLd(nodes, homepage, this.blockContext(homepage, ctx)).length;
    if (businesses === 0 && offers === 0) return { canHandle: false, score: 0, reasons: ['no schema.org business or offer data'] };
    const reasons = [`${businesses} schema.org business node(s)`, `${offers} promotional Offer node(s)`];
    return { canHandle: true, score: Math.min(100, 50 + businesses * 20 + offers * 15), reasons };
  }

  extractFromPage(page: LoadedPage, roles: PageRole[], ctx: Pick<WebsiteContext, 'checkedAt'>): PageExtraction {
    const nodes = jsonLdNodes(page.$);
    const businesses = mergeBusinesses([
      ...extractBusinessesFromHtml(page, { branchPath: branchPathOf(page, roles) ?? '/' }),
      ...businessesFromJsonLd(nodes, page),
    ]);

    const structured = offersFromJsonLd(nodes, page, this.blockContext(page, ctx));
    const fingerprints = new Set(structured.map((e) => e.offer.contentFingerprint));
    const visible = [...this.visibleTextOffers(page, roles, ctx), ...this.embeddedJsonOffers(page, ctx)].filter(
      (e) => !fingerprints.has(e.offer.contentFingerprint),
    );
    return { businesses, offers: [...structured, ...visible] };
  }

  private blockContext(page: LoadedPage, ctx: Pick<WebsiteContext, 'checkedAt'>): Parameters<typeof offersFromJsonLd>[2] {
    return {
      sourceUrl: page.finalUrl,
      pageTitle: page.title,
      checkedAt: ctx.checkedAt,
      adapterId: this.id,
      adapterVersion: this.version,
      extractionMethod: 'jsonld',
      lastModified: page.lastModified,
    };
  }
}
