import type { CheerioAPI } from 'cheerio';
import { normaliseUrl, siteDomainOf } from '../safety/url';
import type { DiscoveredPage, PageRole } from './adapter.types';
import { collapse } from './text';

const OFFERS = /offer|deal|promo|discount|special|voucher|coupon|saving/i;
const MENU = /\bmenu|\border(?:-|\s)?online|\border\b|\bfood\b|dishes|takeaway-menu/i;
const BUSINESS = /contact|about|find-?us|visit|opening|hours|get-?in-?touch/i;
const BRANCH = /branch|locations?|stores?|restaurants|shops?\b|our-sites/i;

// Pages behind a login or part of a checkout are never crawled (spec §2.2).
const PRIVATE_PATH = /\/(?:login|log-in|signin|sign-in|signup|sign-up|register|account|my-?account|my-?orders|checkout|basket|cart|admin|wp-admin|wp-login|user|profile|password|logout)(?:\/|$|\.|\?)/i;
const ASSET = /\.(?:pdf|jpe?g|png|gif|webp|svg|ico|css|js|json|xml|zip|mp4|mp3|docx?|xlsx?)(?:$|\?)/i;

const PRIORITY: Record<PageRole, number> = { home: 1000, offers: 100, menu: 60, branch: 55, business: 50 };

export function classifyPage(url: URL, anchorText = ''): PageRole[] {
  const path = decodeURIComponent(url.pathname);
  const haystack = `${path} ${anchorText}`;
  const roles: PageRole[] = [];
  if (path === '/' || path === '') roles.push('home');
  if (OFFERS.test(haystack)) roles.push('offers');
  if (MENU.test(haystack)) roles.push('menu');
  if (BRANCH.test(path) && path.split('/').filter(Boolean).length >= 1) roles.push('branch');
  if (BUSINESS.test(haystack)) roles.push('business');
  return roles;
}

export function pagePriority(roles: PageRole[]): number {
  return roles.reduce((sum, role) => Math.max(sum, PRIORITY[role]), 0);
}

export function isCrawlablePath(url: URL): boolean {
  return !PRIVATE_PATH.test(url.pathname) && !ASSET.test(url.pathname);
}

export interface PageLink {
  url: string;
  anchorText: string;
  nofollow: boolean;
}

export function linksOf($: CheerioAPI, baseUrl: string): PageLink[] {
  const links: PageLink[] = [];
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    if (!href || /^(?:mailto:|tel:|javascript:|sms:|whatsapp:|#)/i.test(href)) return;
    try {
      links.push({
        url: normaliseUrl(href, baseUrl),
        anchorText: collapse($(el).text()).slice(0, 80),
        nofollow: /\bnofollow\b/i.test($(el).attr('rel') ?? ''),
      });
    } catch {
      // not a crawlable URL
    }
  });
  return links;
}

// Same-site pages worth visiting, highest priority first. Off-site links are returned separately.
export function planPages(
  homepageUrl: string,
  links: PageLink[],
  siteDomain: string,
  pageNofollow: boolean,
): { pages: DiscoveredPage[]; offsite: URL[] } {
  const pages = new Map<string, DiscoveredPage>();
  const offsite = new Map<string, URL>();
  pages.set(normaliseUrl(homepageUrl), { url: normaliseUrl(homepageUrl), roles: ['home'], priority: PRIORITY.home, source: 'seed' });
  if (pageNofollow) return { pages: [...pages.values()], offsite: [] };

  for (const link of links) {
    if (link.nofollow) continue;
    const url = new URL(link.url);
    if (siteDomainOf(url.hostname) !== siteDomain) {
      offsite.set(siteDomainOf(url.hostname), url);
      continue;
    }
    if (!isCrawlablePath(url)) continue;
    const roles = classifyPage(url, link.anchorText);
    if (roles.length === 0) continue;
    const existing = pages.get(link.url);
    if (existing) {
      existing.roles = [...new Set([...existing.roles, ...roles])];
      existing.priority = pagePriority(existing.roles);
      continue;
    }
    pages.set(link.url, { url: link.url, roles, priority: pagePriority(roles), source: 'homepage_link', anchorText: link.anchorText });
  }
  return {
    pages: [...pages.values()].sort((a, b) => b.priority - a.priority),
    offsite: [...offsite.values()],
  };
}
