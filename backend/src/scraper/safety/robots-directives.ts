import type { CheerioAPI } from 'cheerio';
import type { IncomingHttpHeaders } from 'node:http';
import { BOT_TOKEN } from '../scraper.constants';

export interface PageDirectives {
  noindex: boolean;
  nofollow: boolean;
}

const KNOWN_DIRECTIVES = new Set([
  'all',
  'none',
  'noindex',
  'nofollow',
  'noarchive',
  'nosnippet',
  'notranslate',
  'noimageindex',
  'unavailable_after',
  'indexifembedded',
  'max-snippet',
  'max-image-preview',
  'max-video-preview',
]);

function apply(directives: PageDirectives, list: string) {
  for (const raw of list.split(',')) {
    const directive = raw.trim().toLowerCase();
    if (directive === 'noindex' || directive === 'none') directives.noindex = true;
    if (directive === 'nofollow' || directive === 'none') directives.nofollow = true;
    if (directive.startsWith('unavailable_after')) {
      const when = Date.parse(raw.slice(raw.indexOf(':') + 1).trim());
      if (!Number.isNaN(when) && when < Date.now()) directives.noindex = true;
    }
  }
}

// X-Robots-Tag values apply to every crawler unless prefixed with a user agent ("TruOffersBot: noindex").
export function parseXRobotsTag(headers: IncomingHttpHeaders, directives: PageDirectives = { noindex: false, nofollow: false }) {
  const raw = headers['x-robots-tag'];
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const value of values) {
    const scoped = /^\s*([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(value);
    if (scoped && !KNOWN_DIRECTIVES.has(scoped[1].toLowerCase())) {
      if (scoped[1].toLowerCase() === BOT_TOKEN.toLowerCase()) apply(directives, scoped[2]);
      continue;
    }
    apply(directives, value);
  }
  return directives;
}

export function parseMetaRobots($: CheerioAPI, directives: PageDirectives = { noindex: false, nofollow: false }) {
  $('meta[name]').each((_, el) => {
    const name = ($(el).attr('name') ?? '').trim().toLowerCase();
    if (name === 'robots' || name === BOT_TOKEN.toLowerCase()) apply(directives, $(el).attr('content') ?? '');
  });
  return directives;
}

export function pageDirectives(headers: IncomingHttpHeaders, $: CheerioAPI): PageDirectives {
  return parseMetaRobots($, parseXRobotsTag(headers));
}
