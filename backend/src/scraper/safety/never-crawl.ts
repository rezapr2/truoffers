import { hostMatchesDomain, siteDomainOf } from './url';

// Spec §2.2: never crawled, whatever an admin submits. Each entry covers the domain and all subdomains.
// Admins can extend this list in scraper settings but can never remove from it.
export const NEVER_CRAWL_DOMAINS: readonly string[] = [
  // Search engines and maps
  'google.com',
  'google.co.uk',
  'goo.gl',
  'g.page',
  'googleusercontent.com',
  'bing.com',
  'duckduckgo.com',
  'yahoo.com',
  // Food marketplaces and aggregators
  'just-eat.co.uk',
  'just-eat.com',
  'justeat.co.uk',
  'justeattakeaway.com',
  'ubereats.com',
  'uber.com',
  'deliveroo.co.uk',
  'deliveroo.com',
  'hungryhouse.co.uk',
  'kukd.com',
  'grubhub.com',
  'doordash.com',
  'menulog.com.au',
  'toogoodtogo.com',
  // Review, booking and directory platforms
  'tripadvisor.co.uk',
  'tripadvisor.com',
  'yelp.co.uk',
  'yelp.com',
  'opentable.co.uk',
  'opentable.com',
  'thefork.co.uk',
  'thefork.com',
  'yell.com',
  // Social platforms
  'facebook.com',
  'fb.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'youtube.com',
  'linkedin.com',
  'pinterest.com',
  'threads.net',
  'whatsapp.com',
];

// Marketplace front ends on domains that also host individual takeaway sites, blocked by exact host only.
export const NEVER_CRAWL_HOSTS: readonly string[] = ['foodhub.co.uk', 'maps.apple.com'];

export function neverCrawlReason(hostname: string, extraDomains: readonly string[] = []): string | null {
  const host = siteDomainOf(hostname);
  const domain = [...NEVER_CRAWL_DOMAINS, ...extraDomains].find((d) => hostMatchesDomain(host, d));
  if (domain) return `${host} is on the never-crawl list (${domain})`;
  if (NEVER_CRAWL_HOSTS.includes(host)) return `${host} is a marketplace and is never crawled`;
  return null;
}
