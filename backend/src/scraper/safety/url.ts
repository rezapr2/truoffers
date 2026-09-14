import ipaddr from 'ipaddr.js';
import { getDomain } from 'tldts';

export class UrlRejectedError extends Error {
  constructor(
    readonly reason: 'invalid' | 'protocol' | 'credentials' | 'ip_literal' | 'single_label',
    message: string,
  ) {
    super(message);
    this.name = 'UrlRejectedError';
  }
}

const TRACKING_PARAMS = new Set([
  'gclid',
  'fbclid',
  'msclkid',
  'dclid',
  'gbraid',
  'wbraid',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  'igshid',
  'yclid',
  'ttclid',
  'twclid',
  'li_fat_id',
]);

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('utm_') || TRACKING_PARAMS.has(lower);
}

// Parses a URL the crawler may request: http(s), no credentials, a real multi-label hostname.
export function parseCrawlUrl(input: string, base?: string | URL): URL {
  let url: URL;
  try {
    url = new URL(input.trim(), base);
  } catch {
    throw new UrlRejectedError('invalid', `Not a valid URL: ${input}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlRejectedError('protocol', `Only http and https URLs can be crawled (got ${url.protocol})`);
  }
  if (url.username || url.password) {
    throw new UrlRejectedError('credentials', 'URLs containing credentials are not crawled');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(hostname)) {
    throw new UrlRejectedError('ip_literal', 'URLs must use a hostname, not an IP address');
  }
  if (!hostname.replace(/\.$/, '').includes('.')) {
    throw new UrlRejectedError('single_label', `Not a public hostname: ${hostname}`);
  }
  return url;
}

// Canonical form for fetching and dedupe: no fragment or tracking parameters, query keys sorted.
export function normaliseUrl(input: string, base?: string | URL): string {
  const url = parseCrawlUrl(input, base);
  url.hash = '';
  url.hostname = url.hostname.replace(/\.$/, '');
  const kept = [...url.searchParams.entries()]
    .filter(([name]) => !isTrackingParam(name))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = '';
  for (const [name, value] of kept) url.searchParams.append(name, value);
  if (!url.pathname) url.pathname = '/';
  return url.toString();
}

// www.example.co.uk and example.co.uk are the same site.
export function siteDomainOf(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

export function registrableDomainOf(hostname: string): string {
  const host = siteDomainOf(hostname);
  return getDomain(host) ?? host;
}

// Dedupe key that treats the www and bare hosts of a site as one.
export function pageKey(url: string): string {
  const parsed = new URL(normaliseUrl(url));
  parsed.hostname = siteDomainOf(parsed.hostname);
  parsed.protocol = 'https:';
  return parsed.toString();
}

export function isSameSite(a: string | URL, b: string | URL): boolean {
  const hostA = typeof a === 'string' ? new URL(a).hostname : a.hostname;
  const hostB = typeof b === 'string' ? new URL(b).hostname : b.hostname;
  return siteDomainOf(hostA) === siteDomainOf(hostB);
}

// True when `hostname` is `domain` or one of its subdomains (label-boundary match).
export function hostMatchesDomain(hostname: string, domain: string): boolean {
  const host = siteDomainOf(hostname);
  const target = siteDomainOf(domain);
  return host === target || host.endsWith(`.${target}`);
}
