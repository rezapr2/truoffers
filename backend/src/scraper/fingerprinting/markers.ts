import { createHash } from 'node:crypto';
import type { AnyNode, Element } from 'domhandler';
import type { CheerioAPI } from 'cheerio';
import { MarkerCategory } from '../../common/scraper.enums';
import { registrableDomainOf, siteDomainOf } from '../safety/url';

export interface SiteMarker {
  category: MarkerCategory;
  value: string;
}

export const markerKey = (marker: SiteMarker) => `${marker.category}|${marker.value}`;

const VALUE_MAX = 120;
const PER_CATEGORY: Partial<Record<MarkerCategory, number>> = {
  [MarkerCategory.CSS_CLASS]: 80,
  [MarkerCategory.ELEMENT_ID]: 30,
  [MarkerCategory.ROUTE_PATTERN]: 30,
  [MarkerCategory.SCRIPT]: 20,
  [MarkerCategory.STYLESHEET]: 15,
  [MarkerCategory.ASSET_HOST]: 10,
  [MarkerCategory.API_ENDPOINT]: 15,
  [MarkerCategory.JSONLD_SHAPE]: 10,
};

// Public CDNs and platforms shared by unrelated sites: never a signal of a common template.
const SHARED_ASSET_HOSTS = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'ajax.googleapis.com',
  'www.googletagmanager.com',
  'www.google-analytics.com',
  'code.jquery.com',
  'maxcdn.bootstrapcdn.com',
  'stackpath.bootstrapcdn.com',
  'use.fontawesome.com',
  'kit.fontawesome.com',
  'connect.facebook.net',
  'js.stripe.com',
  'maps.googleapis.com',
];

// Atomic utility classes (Tailwind, Bootstrap grid) say nothing about a template.
const UTILITY_CLASS =
  /^(?:[a-z]+:)+|^-?(?:p|m|px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|w|h|gap|space|text|bg|border|rounded|shadow|font|leading|tracking|z|top|left|right|bottom|inset|opacity|order|col|row|grid-cols|flex-(?:row|col|wrap|1|none)|items|justify|self|content|d|align)-|^(?:flex|grid|block|inline|inline-block|hidden|relative|absolute|fixed|sticky|container|row|col|clearfix|visible|invisible|sr-only|uppercase|lowercase|italic|underline|truncate|active|show|fade|in|open|disabled|selected)$/;
const HASHED_CLASS = /^(?:css|sc|jsx|emotion|svelte|astro|chakra|mui|tw)-[a-z0-9]{4,}$/i;

const FRAMEWORK_PROBES: [string, (ctx: { $: CheerioAPI; html: string }) => boolean][] = [
  ['next.js', ({ $ }) => $('script#__NEXT_DATA__').length > 0],
  ['nuxt', ({ $ }) => $('#__nuxt, #__layout').length > 0],
  ['angular', ({ $ }) => $('[ng-version]').length > 0],
  ['react', ({ $ }) => $('[data-reactroot]').length > 0],
  ['wordpress', ({ html }) => /\/wp-(?:content|includes)\//i.test(html)],
  ['shopify', ({ html }) => /cdn\.shopify\.com|Shopify\.theme/i.test(html)],
  ['webflow', ({ $ }) => $('html[data-wf-site]').length > 0],
  ['wix', ({ html }) => /static\.wixstatic\.com/i.test(html)],
  ['squarespace', ({ html }) => /static1\.squarespace\.com/i.test(html)],
];

// "Website by Saffron Web Studio": the credit is case-insensitive, the credited name must be capitalised.
const ATTRIBUTION = /\b(?:[Ww]ebsite|[Ss]ite|[Tt]heme|[Ww]eb design|[Dd]esigned|[Bb]uilt|[Mm]ade|[Pp]owered)\s+by\s+([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*){0,3})/g;

function clip(value: string): string {
  return value.length > VALUE_MAX ? value.slice(0, VALUE_MAX) : value;
}

function shortHash(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 12);
}

function isElement(node: AnyNode): node is Element {
  return node.type === 'tag';
}

// "/static/js/main.3f2a9c1b.js" -> "/static/js/main.*.js"; "/themes/4.2.1/app.js" -> "/themes/*/app.js"
export function normaliseAssetPath(pathname: string): string {
  return pathname
    .toLowerCase()
    .split('/')
    .map((segment) =>
      segment
        .replace(/(?:^|[.-])[a-f0-9]{7,}(?=[.-]|$)/g, (m) => `${m[0] === '.' || m[0] === '-' ? m[0] : ''}*`)
        .replace(/^v?\d+(?:\.\d+){1,3}$/, '*'),
    )
    .join('/');
}

export function stableClass(token: string): string | null {
  if (HASHED_CLASS.test(token)) return null;
  const cleaned = token.replace(/__[A-Za-z0-9_-]{4,}$/, '').replace(/-[a-f0-9]{6,}$/i, '');
  if (cleaned.length < 3 || cleaned.length > 60) return null;
  if (UTILITY_CLASS.test(cleaned)) return null;
  if (/\d{3,}/.test(cleaned)) return null;
  return cleaned;
}

// "/menu/1234" -> "/menu/:n"; "/branches/leeds-city-centre" -> "/branches/:slug"
export function routePattern(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean).slice(0, 3);
  if (segments.length === 0) return null;
  const normalised = segments.map((s) => {
    const seg = decodeURIComponent(s).toLowerCase();
    if (/^\d+$/.test(seg)) return ':n';
    if (/^[a-f0-9-]{16,}$/.test(seg)) return ':id';
    if (seg.split('-').length >= 3) return ':slug';
    return seg.replace(/\.(?:html?|php|aspx?)$/, '');
  });
  return `/${normalised.join('/')}`;
}

function skeleton(el: Element, depth: number): string {
  if (depth === 0) return el.tagName;
  const cls = (el.attribs?.class ?? '').split(/\s+/).map(stableClass).find(Boolean);
  const children = el.children.filter(isElement).slice(0, 12).map((child) => skeleton(child, depth - 1));
  return `${el.tagName}${cls ? `.${cls}` : ''}(${children.join(',')})`;
}

function add(out: Map<string, SiteMarker>, category: MarkerCategory, value: string | null | undefined) {
  if (!value) return;
  const marker = { category, value: clip(value.trim()) };
  if (marker.value) out.set(markerKey(marker), marker);
}

/**
 * Structural traits of a page that identify the template behind it rather than its content: generator and
 * attribution, asset bundles, stable CSS classes and ids, landmark skeletons, JSON-LD shapes, routes and
 * public API endpoints mentioned in inline scripts (recorded only, never called).
 */
export function extractMarkers(page: { $: CheerioAPI; html?: string; finalUrl: string }): SiteMarker[] {
  const { $ } = page;
  const html = page.html ?? $.html();
  const base = new URL(page.finalUrl);
  const site = siteDomainOf(base.hostname);
  const registrable = registrableDomainOf(site);
  const out = new Map<string, SiteMarker>();

  $('meta[name="generator" i]').each((_, el) => {
    const content = ($(el).attr('content') ?? '').toLowerCase().replace(/\bv?\d+(?:\.\d+)*\b/g, '').replace(/\s+/g, ' ').trim();
    add(out, MarkerCategory.GENERATOR, content);
  });

  const footer = $('footer').text() || $('body').children().last().text();
  for (const match of footer.replace(/\s+/g, ' ').matchAll(ATTRIBUTION)) {
    add(out, MarkerCategory.FOOTER_ATTRIBUTION, `by ${match[1].toLowerCase().replace(/[.,]+$/, '')}`);
  }

  for (const [name, probe] of FRAMEWORK_PROBES) if (probe({ $, html })) add(out, MarkerCategory.FRAMEWORK, name);

  const assets: [MarkerCategory, string | undefined][] = [
    ...$('script[src]').map((_, el) => [[MarkerCategory.SCRIPT, $(el).attr('src')]] as [MarkerCategory, string | undefined][]).get(),
    ...$('link[rel~="stylesheet" i][href]').map((_, el) => [[MarkerCategory.STYLESHEET, $(el).attr('href')]] as [MarkerCategory, string | undefined][]).get(),
    ...$('img[src]').slice(0, 30).map((_, el) => [[MarkerCategory.ASSET_HOST, $(el).attr('src')]] as [MarkerCategory, string | undefined][]).get(),
  ];
  for (const [category, raw] of assets) {
    let url: URL;
    try {
      url = new URL(raw ?? '', base);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    const host = url.hostname.toLowerCase();
    const sameSite = registrableDomainOf(siteDomainOf(host)) === registrable;
    if (!sameSite && !SHARED_ASSET_HOSTS.includes(host)) add(out, MarkerCategory.ASSET_HOST, host);
    if (category === MarkerCategory.ASSET_HOST) continue;
    const path = normaliseAssetPath(url.pathname);
    if (sameSite) add(out, category, path);
    else if (!SHARED_ASSET_HOSTS.includes(host)) add(out, category, `${host}${path}`);
  }

  const classCounts = new Map<string, number>();
  const idValues = new Set<string>();
  $('body *').each((_, el) => {
    if (!isElement(el)) return;
    for (const token of (el.attribs.class ?? '').split(/\s+/)) {
      const stable = token && stableClass(token);
      if (stable) classCounts.set(stable, (classCounts.get(stable) ?? 0) + 1);
    }
    const id = el.attribs.id;
    if (id && !/\d{3,}|[a-f0-9]{8,}/i.test(id) && id.length <= 40) idValues.add(id.toLowerCase());
  });
  [...classCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .forEach(([cls]) => add(out, MarkerCategory.CSS_CLASS, cls));
  [...idValues].sort().forEach((id) => add(out, MarkerCategory.ELEMENT_ID, id));

  for (const landmark of ['header', 'nav', 'main', 'footer']) {
    const el = $(landmark).first().get(0);
    if (el && isElement(el)) add(out, MarkerCategory.DOM_SKELETON, `${landmark}:${shortHash(skeleton(el, 4))}`);
  }

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      for (const node of Array.isArray(data) ? data : data['@graph'] ?? [data]) {
        if (!node || typeof node !== 'object') continue;
        const type = [node['@type']].flat().join('+');
        const keys = Object.keys(node).filter((k) => !k.startsWith('@')).sort().join(',');
        add(out, MarkerCategory.JSONLD_SHAPE, `${type}{${keys}}`);
      }
    } catch {
      /* malformed JSON-LD is not a marker */
    }
  });

  $('a[href]').each((_, el) => {
    try {
      const url = new URL($(el).attr('href') ?? '', base);
      if (siteDomainOf(url.hostname) === site) add(out, MarkerCategory.ROUTE_PATTERN, routePattern(url.pathname));
    } catch {
      /* ignore */
    }
  });

  $('script:not([src])').each((_, el) => {
    const text = $(el).text().slice(0, 50_000);
    for (const match of text.matchAll(/["'](\/(?:api|graphql|wp-json|ajax)(?:\/[\w.-]+){0,4})["']/g)) {
      add(out, MarkerCategory.API_ENDPOINT, routePattern(match[1]) ?? match[1]);
    }
  });

  // Cap noisy categories, keeping their first (most frequent or first-seen) values.
  const counts = new Map<MarkerCategory, number>();
  return [...out.values()].filter((marker) => {
    const limit = PER_CATEGORY[marker.category] ?? 10;
    const seen = counts.get(marker.category) ?? 0;
    counts.set(marker.category, seen + 1);
    return seen < limit;
  });
}

// Markers from several pages of one site (homepage plus an offers page), deduplicated.
export function mergeMarkers(...sets: SiteMarker[][]): SiteMarker[] {
  const out = new Map<string, SiteMarker>();
  for (const set of sets) for (const marker of set) out.set(markerKey(marker), marker);
  return [...out.values()];
}
