import { siteDomainOf } from '../../safety/url';
import type {
  AdapterMatchResult,
  DiscoveredPage,
  ExtractedBusiness,
  ExtractedOffer,
  LoadedPage,
  OfferExtraction,
  OfferValidationResult,
  PageRole,
  TakeawayWebsiteAdapter,
  WebsiteContext,
} from '../adapter.types';
import { branchPageLinks } from '../business-extractor';
import { classifyPage, linksOf, pagePriority, planPages } from '../page-classifier';
import { validateExtractedOffer } from '../validate-offer';

export interface PageExtraction {
  businesses: ExtractedBusiness[];
  offers: OfferExtraction[];
}

export interface Discovery {
  pages: DiscoveredPage[];
  offsite: URL[];
}

const BUSINESS_ROLES: PageRole[] = ['home', 'business', 'branch'];
const OFFER_ROLES: PageRole[] = ['home', 'offers', 'menu', 'branch'];
const BUSINESS_FIELDS = ['name', 'telephone', 'address', 'postcode', 'town', 'website', 'orderUrl', 'branchLabel'] as const;

// Where a better source for the same business field wins when pages disagree.
const METHOD_RANK = (method = '') =>
  method.startsWith('selector:') || method.startsWith('provider:')
    ? 4
    : method.startsWith('jsonld:')
      ? 3
      : method === 'html:tel_link' || method === 'html:address_block'
        ? 2
        : 1;

function mergeInto(target: ExtractedBusiness, incoming: ExtractedBusiness) {
  for (const field of BUSINESS_FIELDS) {
    const value = incoming[field];
    if (!value) continue;
    const better = METHOD_RANK(incoming.evidence[field]?.method) > METHOD_RANK(target.evidence[field]?.method);
    if (!target[field] || better) {
      target[field] = value;
      if (incoming.evidence[field]) target.evidence[field] = incoming.evidence[field];
    }
  }
}

export function mergeBusinesses(found: ExtractedBusiness[]): ExtractedBusiness[] {
  const byBranch = new Map<string, ExtractedBusiness>();
  for (const business of found) {
    const existing = byBranch.get(business.branchPath);
    if (existing) mergeInto(existing, business);
    else byBranch.set(business.branchPath, { ...business, evidence: { ...business.evidence } });
  }

  // The same premises described on two pages (e.g. "/" and "/contact") is one branch: keep the shorter path.
  const merged = [...byBranch.values()].sort((a, b) => a.branchPath.length - b.branchPath.length);
  const result: ExtractedBusiness[] = [];
  for (const business of merged) {
    const same = result.find((r) => r.postcode && r.postcode === business.postcode && (!r.telephone || !business.telephone || r.telephone === business.telephone));
    if (same) mergeInto(same, business);
    else result.push(business);
  }

  // A brand-level "/" entry with no premises details isn't a branch when real branches exist.
  const branches = result.filter((b) => b.branchPath !== '/');
  if (branches.length > 0) {
    const root = result.find((b) => b.branchPath === '/');
    if (root && !root.postcode && !root.telephone) result.splice(result.indexOf(root), 1);
  }
  return result;
}

/**
 * Shared behaviour for code-defined adapters. Subclasses decide how a single loaded page is read;
 * the spec's adapter interface is built on top of that.
 */
export abstract class BuiltinAdapter implements TakeawayWebsiteAdapter {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly priority: number;
  // The platform loads its menu, and the deals in it, only in the browser: worth a render even when the
  // static HTML already had some offers.
  readonly menuNeedsRendering: boolean = false;
  // The path of the data the platform's app loads and this adapter reads (matched against each JSON response's
  // pathname). A render waits for it to arrive, up to a limit, instead of giving up at the ordinary settle time.
  readonly renderExpects?: RegExp;

  abstract canHandle(ctx: WebsiteContext): Promise<AdapterMatchResult>;
  abstract extractFromPage(page: LoadedPage, roles: PageRole[], ctx: Pick<WebsiteContext, 'checkedAt'>): PageExtraction;

  // Homepage links, plus branch pages linked from a locations page one level down.
  async discover(ctx: WebsiteContext): Promise<Discovery> {
    const homepage = await ctx.loadPage(ctx.site.homepageUrl);
    if (!homepage) return { pages: [], offsite: [] };
    const first = planPages(homepage.finalUrl, linksOf(homepage.$, homepage.finalUrl), ctx.site.domain, homepage.nofollow);
    const pages = new Map(first.pages.map((p) => [p.url, p]));

    for (const listing of first.pages.filter((p) => p.roles.includes('branch') && !p.roles.includes('home'))) {
      const loaded = await ctx.loadPage(listing.url);
      if (!loaded || loaded.nofollow) continue;
      for (const link of branchPageLinks(loaded)) {
        const url = new URL(link.url);
        if (siteDomainOf(url.hostname) !== ctx.site.domain || pages.has(link.url)) continue;
        const roles = [...new Set<PageRole>(['branch', ...classifyPage(url, link.label)])];
        pages.set(link.url, { url: link.url, roles, priority: pagePriority(roles), source: 'listing_link', anchorText: link.label });
      }
    }
    return { pages: [...pages.values()].sort((a, b) => b.priority - a.priority), offsite: first.offsite };
  }

  async discoverPages(ctx: WebsiteContext): Promise<DiscoveredPage[]> {
    return (await this.discover(ctx)).pages;
  }

  async extractBusiness(ctx: WebsiteContext): Promise<ExtractedBusiness[]> {
    const plan = ctx.plan ?? (await this.discoverPages(ctx));
    const found: ExtractedBusiness[] = [];
    for (const page of plan.filter((p) => p.roles.some((r) => BUSINESS_ROLES.includes(r)))) {
      const loaded = await ctx.loadPage(page.url);
      if (loaded) found.push(...this.extractFromPage(loaded, page.roles, ctx).businesses);
    }
    return mergeBusinesses(found);
  }

  async extractOfferDetails(ctx: WebsiteContext, pages: DiscoveredPage[]): Promise<OfferExtraction[]> {
    const found: OfferExtraction[] = [];
    for (const page of pages.filter((p) => p.roles.some((r) => OFFER_ROLES.includes(r)))) {
      const loaded = await ctx.loadPage(page.url);
      if (loaded) found.push(...this.extractFromPage(loaded, page.roles, ctx).offers);
    }
    return found;
  }

  async extractOffers(ctx: WebsiteContext, pages: DiscoveredPage[]): Promise<ExtractedOffer[]> {
    return (await this.extractOfferDetails(ctx, pages)).map((e) => e.offer);
  }

  async validateOffer(offer: ExtractedOffer): Promise<OfferValidationResult> {
    return validateExtractedOffer(offer);
  }
}
