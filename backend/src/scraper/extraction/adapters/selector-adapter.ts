import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { FingerprintMatchCategory, ScraperAdapterStatus } from '../../../common/scraper.enums';
import { extractMarkers } from '../../fingerprinting/markers';
import { categoryAtLeast, FingerprintScore, ScoringFingerprint, scoreFingerprint } from '../../fingerprinting/scoring';
import { siteDomainOf } from '../../safety/url';
import type {
  AdapterMatchResult,
  DiscoveredPage,
  ExtractedBusiness,
  FieldEvidence,
  LoadedPage,
  OfferExtraction,
  PageRole,
  WebsiteContext,
} from '../adapter.types';
import { extractBusinessesFromHtml } from '../business-extractor';
import { contentFingerprint } from '../content-fingerprint';
import { enforceEvidenceCoverage, evidenceFor } from '../evidence';
import { parseOfferBlock } from '../offer-text-parser';
import { classifyPage, pagePriority } from '../page-classifier';
import {
  applyParser,
  BusinessFieldName,
  DEFAULT_PARSERS,
  FieldSelector,
  OfferFieldName,
  pathMatches,
  SelectorAdapterConfig,
} from '../selector-config';
import { collapse, truncate } from '../text';
import { BuiltinAdapter, mergeBusinesses, PageExtraction } from './builtin-adapter';
import { branchPathOf } from './generic-html.adapter';

export const SELECTOR_ADAPTER_PRIORITY = 300;
// Selector adapters only run on sites that match their template at least this well.
export const SELECTOR_MIN_MATCH = FingerprintMatchCategory.HIGH_CONFIDENCE;
const MAX_CONTAINERS_PER_PAGE = 50;

export interface SelectorAdapterDefinition {
  key: string;
  name: string;
  version: string;
  status: ScraperAdapterStatus;
  exampleDomains: string[];
  config: SelectorAdapterConfig;
  fingerprint?: ScoringFingerprint & { id: string; name?: string };
}

/**
 * An admin-built adapter: CSS selectors and named parsers for one website template. It only handles
 * sites whose fingerprint matches its template; while being tested it only handles its example sites.
 */
export class SelectorAdapter extends BuiltinAdapter {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly priority: number = SELECTOR_ADAPTER_PRIORITY;

  constructor(readonly definition: SelectorAdapterDefinition) {
    super();
    this.id = definition.key;
    this.name = definition.name;
    this.version = definition.version;
  }

  private method(field: string) {
    return `selector:${this.id}@${this.version}:${field}`;
  }

  matchTemplate(page: LoadedPage): FingerprintScore | null {
    if (!this.definition.fingerprint) return null;
    return scoreFingerprint(this.definition.fingerprint, extractMarkers({ $: page.$, html: page.html, finalUrl: page.finalUrl }));
  }

  async canHandle(ctx: WebsiteContext): Promise<AdapterMatchResult> {
    const { status, exampleDomains, fingerprint } = this.definition;
    if (status === ScraperAdapterStatus.TESTING && !exampleDomains.includes(siteDomainOf(ctx.site.domain))) {
      return { canHandle: false, score: 0, reasons: ['still being tested: runs on its example websites only'] };
    }
    if (!fingerprint) return { canHandle: false, score: 0, reasons: ['no fingerprint attached'] };
    const homepage = await ctx.loadPage(ctx.site.homepageUrl);
    if (!homepage) return { canHandle: false, score: 0, reasons: ['homepage unavailable'] };
    const match = this.matchTemplate(homepage)!;
    const reason = `template ${fingerprint.name ?? fingerprint.id}: ${match.category} (${match.score})`;
    if (!categoryAtLeast(match.category, SELECTOR_MIN_MATCH)) return { canHandle: false, score: match.score, reasons: [reason] };
    return { canHandle: true, score: match.score, reasons: [reason] };
  }

  // The generic discovery, plus the literal pages the config names (e.g. "/offers").
  async discover(ctx: WebsiteContext) {
    const found = await super.discover(ctx);
    const pages = new Map(found.pages.map((p) => [p.url, p]));
    const literal = (patterns: string[] | undefined, role: PageRole) =>
      (patterns ?? []).filter((p) => !p.includes('*')).map((p) => ({ url: new URL(p, ctx.site.homepageUrl).toString(), role }));
    for (const { url, role } of [...literal(this.definition.config.pages?.offers, 'offers'), ...literal(this.definition.config.pages?.business, 'business')]) {
      const existing = pages.get(url);
      const roles = [...new Set<PageRole>([role, ...(existing?.roles ?? classifyPage(new URL(url)))])];
      pages.set(url, { url, roles, priority: pagePriority(roles) + 100, source: existing?.source ?? 'homepage_link', anchorText: existing?.anchorText });
    }
    for (const page of pages.values()) {
      const path = new URL(page.url).pathname;
      if ((this.definition.config.pages?.offers ?? []).some((p) => pathMatches(p, path)) && !page.roles.includes('offers')) page.roles.push('offers');
    }
    return { pages: [...pages.values()].sort((a, b) => b.priority - a.priority) as DiscoveredPage[], offsite: found.offsite };
  }

  extractFromPage(page: LoadedPage, roles: PageRole[], ctx: Pick<WebsiteContext, 'checkedAt'>): PageExtraction {
    return { businesses: this.businessesOn(page, roles), offers: this.offersOn(page, roles, ctx) };
  }

  private read($: CheerioAPI, scope: Cheerio<AnyNode>, field: FieldSelector | undefined, defaultParser: string): { raw: string; text: string } | null {
    if (!field) return null;
    const element = scope.find(field.selector).first();
    if (element.length === 0) return null;
    const parser = field.parser ?? defaultParser;
    const attribute = field.source === 'attribute' ? field.attribute : parser === 'url' ? 'href' : undefined;
    const raw = attribute ? (element.attr(attribute) ?? '') : element.text();
    const text = collapse(element.text());
    return raw.trim() ? { raw, text: text || raw } : null;
  }

  private offersOn(page: LoadedPage, roles: PageRole[], ctx: Pick<WebsiteContext, 'checkedAt'>): OfferExtraction[] {
    const { $ } = page;
    const { offers: spec } = this.definition.config;
    const branchPath = branchPathOf(page, roles);
    const results: OfferExtraction[] = [];
    const parseCtx = { checkedAt: ctx.checkedAt, pageUrl: page.finalUrl };

    $(spec.container)
      .slice(0, MAX_CONTAINERS_PER_PAGE)
      .each((_, node) => {
        const container = $(node);
        const read = (field: OfferFieldName) => this.read($, container, spec.fields[field], DEFAULT_PARSERS[field]);
        const title = read('title');
        if (!title) return;
        const description = read('description');
        const terms = read('terms');
        const code = read('promoCode');
        const minimum = read('minimumOrder');
        const expiry = read('expiry');
        const containerText = collapse(container.text());

        // The benefit (what the offer is) comes from the pattern library, over the title and description.
        const leaf = [title.text, description?.text].filter(Boolean).join('. ');
        const [parsed] = parseOfferBlock(leaf, containerText, {
          sourceUrl: page.finalUrl,
          pageTitle: page.title,
          checkedAt: ctx.checkedAt,
          adapterId: this.id,
          adapterVersion: this.version,
          extractionMethod: 'selector',
          methodPrefix: `selector:${this.id}@${this.version}`,
          offerContext: true,
          lastModified: page.lastModified,
        });
        if (!parsed) return;

        const offer = { ...parsed.offer };
        const evidence: Record<string, FieldEvidence> = {};
        // Fields the pattern library derived keep their values, re-attributed to this adapter.
        for (const [field, entry] of Object.entries(parsed.offer.evidence)) evidence[field] = { ...entry, method: this.method(field) };
        const cite = (field: string, text: string) => (evidence[field] = evidenceFor(page.finalUrl, text, this.method(field)));

        offer.title = truncate(title.text, 120);
        cite('title', title.text);
        if (description) {
          offer.shortDescription = truncate(description.text, 200);
          cite('shortDescription', description.text);
        }
        if (terms) {
          offer.terms = truncate(terms.text, 300);
          cite('terms', terms.text);
        }
        if (code) {
          const value = applyParser(spec.fields.promoCode?.parser ?? 'promo_code', code.raw, parseCtx);
          if (value.kind === 'text') {
            offer.promoCode = value.value;
            cite('promoCode', code.text);
          }
        }
        if (minimum) {
          const value = applyParser(spec.fields.minimumOrder?.parser ?? 'money', minimum.raw, parseCtx);
          if (value.kind === 'number') {
            offer.minimumOrder = value.value;
            delete offer.requiredSpend;
            delete evidence.requiredSpend;
            cite('minimumOrder', minimum.text);
          }
        }
        const flags = [...parsed.flags];
        if (expiry) {
          const value = applyParser(spec.fields.expiry?.parser ?? 'date', expiry.raw, parseCtx);
          if (value.kind === 'dates') {
            if (value.endDate) {
              offer.endDate = value.endDate;
              cite('endDate', expiry.text);
            }
            if (value.startDate) {
              offer.startDate = value.startDate;
              cite('startDate', expiry.text);
            }
            flags.push(...value.flags);
          }
        }

        offer.evidence = evidence;
        const { offer: covered, dropped } = enforceEvidenceCoverage(offer);
        if (dropped.length) flags.push(`evidence_missing:${dropped.join(',')}`);
        covered.contentFingerprint = contentFingerprint(covered);
        results.push({
          offer: covered,
          signals: {
            ...parsed.signals,
            promoCodeFound: !!covered.promoCode,
            datesIdentified: !!(covered.startDate || covered.endDate),
            termsParsed: parsed.signals.termsParsed || !!covered.terms || !!covered.minimumOrder,
          },
          flags: [...new Set(flags)],
          pageUrl: page.finalUrl,
          branchPath,
        });
      });
    return results;
  }

  private businessesOn(page: LoadedPage, roles: PageRole[]): ExtractedBusiness[] {
    const generic = extractBusinessesFromHtml(page, { branchPath: branchPathOf(page, roles) ?? '/' });
    const spec = this.definition.config.business;
    if (!spec) return generic;
    const { $ } = page;
    const scope = spec.container ? $(spec.container).first() : $.root();
    if (scope.length === 0) return generic;

    const business: ExtractedBusiness = { branchPath: branchPathOf(page, roles) ?? '/', sourceUrl: page.finalUrl, evidence: {} };
    const parseCtx = { checkedAt: new Date(), pageUrl: page.finalUrl };
    for (const field of ['name', 'telephone', 'address', 'postcode', 'orderUrl'] as BusinessFieldName[]) {
      const found = this.read($, scope as Cheerio<AnyNode>, spec[field], DEFAULT_PARSERS[field]);
      if (!found) continue;
      const value = applyParser(spec[field]?.parser ?? DEFAULT_PARSERS[field], found.raw, parseCtx);
      if (value.kind !== 'text') continue;
      business[field === 'postcode' ? 'postcode' : field] = value.value;
      business.evidence[field] = evidenceFor(page.finalUrl, found.text, this.method(field));
    }
    if (!business.postcode && business.address) {
      const postcode = applyParser('postcode', business.address, parseCtx);
      if (postcode.kind === 'text') {
        business.postcode = postcode.value;
        business.evidence.postcode = business.evidence.address;
      }
    }
    return mergeBusinesses([business, ...generic]);
  }
}
