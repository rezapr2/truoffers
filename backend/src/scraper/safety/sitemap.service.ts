import { Injectable } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { SITEMAP_LIMITS } from '../scraper.constants';
import { normaliseUrl, siteDomainOf } from './url';

export type SitemapFetcher = (url: string) => Promise<string | null>;

const MAX_SITEMAP_DOCUMENTS = 20;

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function locOf(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry.trim();
  if (entry && typeof entry === 'object' && 'loc' in entry) return String((entry as { loc: unknown }).loc).trim();
  return undefined;
}

// Collects same-site page URLs from sitemaps: at most 5,000 URLs, sitemap indexes followed to depth 2.
// The 5 MB size cap is enforced by the fetcher while each document streams.
@Injectable()
export class SitemapService {
  private readonly parser = new XMLParser({
    ignoreAttributes: true,
    processEntities: false,
    parseTagValue: false,
    removeNSPrefix: true,
  });

  async collectUrls(sitemapUrls: string[], siteDomain: string, fetchDocument: SitemapFetcher): Promise<string[]> {
    return this.walk(sitemapUrls, siteDomain, fetchDocument, (loc) => this.sameSite(loc, siteDomain));
  }

  /**
   * The websites an authorised network's sitemap lists (e.g. a provider's client directory): one origin per
   * site domain, at most `maxSites`. Sitemap indexes are still only followed on the sitemap's own host.
   */
  async collectListedSites(sitemapUrls: string[], sitemapDomain: string, fetchDocument: SitemapFetcher, maxSites: number): Promise<{ domain: string; seedUrl: string }[]> {
    const sites = new Map<string, string>();
    await this.walk(sitemapUrls, sitemapDomain, fetchDocument, (loc) => {
      if (sites.size >= maxSites) return false;
      try {
        const url = new URL(loc);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
        const domain = siteDomainOf(url.hostname);
        if (domain !== sitemapDomain && !sites.has(domain)) sites.set(domain, `${url.protocol}//${url.host}/`);
      } catch {
        /* skip malformed entries */
      }
      return false;
    });
    return [...sites.entries()].map(([domain, seedUrl]) => ({ domain, seedUrl }));
  }

  private async walk(sitemapUrls: string[], siteDomain: string, fetchDocument: SitemapFetcher, accept: (loc: string) => boolean): Promise<string[]> {
    const found = new Set<string>();
    const seenDocuments = new Set<string>();
    const queue = sitemapUrls.map((url) => ({ url, depth: 0 }));
    let documents = 0;

    while (queue.length > 0 && found.size < SITEMAP_LIMITS.maxUrls && documents < MAX_SITEMAP_DOCUMENTS) {
      const { url, depth } = queue.shift()!;
      if (seenDocuments.has(url)) continue;
      seenDocuments.add(url);
      documents++;

      const xml = await fetchDocument(url);
      if (!xml) continue;
      let parsed: Record<string, any>;
      try {
        parsed = this.parser.parse(xml);
      } catch {
        continue;
      }

      if (parsed.sitemapindex) {
        // depth counts nested indexes below the one we were given
        if (depth >= SITEMAP_LIMITS.maxIndexDepth) continue;
        for (const entry of asArray(parsed.sitemapindex.sitemap)) {
          const loc = locOf(entry);
          if (loc && this.sameSite(loc, siteDomain)) queue.push({ url: loc, depth: depth + 1 });
        }
        continue;
      }

      for (const entry of asArray(parsed.urlset?.url)) {
        if (found.size >= SITEMAP_LIMITS.maxUrls) break;
        const loc = locOf(entry);
        if (!loc || !accept(loc)) continue;
        try {
          found.add(normaliseUrl(loc));
        } catch {
          // skip malformed entries
        }
      }
    }
    return [...found];
  }

  private sameSite(url: string, siteDomain: string): boolean {
    try {
      const parsed = new URL(url);
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && siteDomainOf(parsed.hostname) === siteDomain;
    } catch {
      return false;
    }
  }
}
