import type { CheerioAPI } from 'cheerio';

/**
 * Public data that ordering platforms embed in their pages for their own JavaScript to render. Reading it is
 * reading the page: nothing here makes a request, and the platforms' APIs are never called (spec §2.2).
 */

// Size limits for what is decoded and scanned, well within the 2 MB page cap.
const MAX_EMBEDDED_CHARS = 2 * 1024 * 1024;
const MAX_MATCHES = 50;

/** Foodhub: base64-encoded JSON in `<input id="prerender-data">`, holding the store's settings and discounts. */
export function foodhubPrerender($: CheerioAPI): { store: Record<string, unknown> } | null {
  const raw = $('input#prerender-data').attr('value');
  if (!raw || raw.length > MAX_EMBEDDED_CHARS) return null;
  try {
    const outer = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as Record<string, unknown>;
    const store = typeof outer.store === 'string' ? JSON.parse(outer.store) : outer.store;
    return store && typeof store === 'object' ? { store: store as Record<string, unknown> } : null;
  } catch {
    return null;
  }
}

/** Next.js App Router: the page's data streamed as `self.__next_f.push([1, "<chunk>"])` script calls. */
export function nextFlightText($: CheerioAPI): string {
  let text = '';
  $('script:not([src])').each((_, el) => {
    if (text.length > MAX_EMBEDDED_CHARS) return false;
    const source = $(el).html() ?? '';
    if (!source.includes('__next_f')) return undefined;
    for (const match of source.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
      try {
        text += JSON.parse(match[1]) as string;
      } catch {
        // A chunk that isn't a plain string literal carries no page data we read.
      }
    }
    return undefined;
  });
  return text.slice(0, MAX_EMBEDDED_CHARS);
}

// The JSON array or object that starts at `start`, found by bracket matching that respects strings.
export function jsonValueAt(text: string, start: number): unknown {
  const open = text[start];
  if (open !== '[' && open !== '{') return undefined;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/** Every JSON array or object stored under `"key":` in a blob of streamed data. */
export function jsonValuesForKey(text: string, key: string): unknown[] {
  const needle = `"${key}":`;
  const values: unknown[] = [];
  for (let index = text.indexOf(needle); index >= 0 && values.length < MAX_MATCHES; index = text.indexOf(needle, index + needle.length)) {
    const value = jsonValueAt(text, index + needle.length);
    if (value !== undefined) values.push(value);
  }
  return values;
}

/** Every JSON object that begins with `{"<firstKey>":` in a blob of streamed data. */
export function jsonObjectsStartingWith(text: string, firstKey: string): Record<string, unknown>[] {
  const needle = `{"${firstKey}":`;
  const objects: Record<string, unknown>[] = [];
  for (let index = text.indexOf(needle); index >= 0 && objects.length < MAX_MATCHES * 4; index = text.indexOf(needle, index + needle.length)) {
    const value = jsonValueAt(text, index);
    if (value && typeof value === 'object' && !Array.isArray(value)) objects.push(value as Record<string, unknown>);
  }
  return objects;
}

// Short, verbatim JSON for evidence: only the named keys of an embedded record.
export function jsonSnippet(record: Record<string, unknown>, keys: string[]): string {
  return JSON.stringify(Object.fromEntries(keys.filter((k) => record[k] !== undefined && record[k] !== null).map((k) => [k, record[k]])));
}

// Every host a page references: asset tags, and absolute URLs inside structured data and inline scripts.
export function referencedHosts($: CheerioAPI, limit = 500): string[] {
  const hosts = new Set<string>();
  const add = (raw: string | undefined) => {
    if (!raw || hosts.size >= limit || !/^(https?:)?\/\//i.test(raw)) return;
    try {
      hosts.add(new URL(raw, 'https://placeholder.invalid').hostname.toLowerCase());
    } catch {
      // ignore malformed URLs
    }
  };
  $('script[src], link[href], img[src], source[src]').each((_, el) => add($(el).attr('src') ?? $(el).attr('href')));
  $('script:not([src])').each((_, el) => {
    const source = ($(el).html() ?? '').slice(0, MAX_EMBEDDED_CHARS);
    for (const match of source.matchAll(/https?:(?:\\?\/){2}([a-z0-9.-]+\.[a-z]{2,})/gi)) {
      if (hosts.size >= limit) break;
      hosts.add(match[1].toLowerCase());
    }
  });
  return [...hosts];
}
