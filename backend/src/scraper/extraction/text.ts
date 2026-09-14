import { EVIDENCE_LIMITS } from '../scraper.constants';

// \s includes non-breaking spaces.
export function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

export function parseCount(token: string | undefined): number | undefined {
  if (!token) return undefined;
  const lower = token.toLowerCase();
  if (/^\d+$/.test(lower)) return Number(lower);
  return WORD_NUMBERS[lower];
}

export function parseMoney(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw.replace(/,/g, ''));
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : undefined;
}

export interface TextMatch<T> {
  value: T;
  index: number;
  length: number;
}

// Sentence containing the match, widened to at most `max` characters: the evidence excerpt.
export function excerptAround(text: string, index: number, length: number, max: number = EVIDENCE_LIMITS.excerptMaxChars): string {
  const boundary = /[.!?]\s|[\n|•·]|\s[-–—]\s/g;
  let start = 0;
  let end = text.length;
  for (const m of text.matchAll(boundary)) {
    const at = m.index ?? 0;
    if (at + m[0].length <= index) start = at + m[0].length;
    else if (at >= index + length) {
      end = at + 1;
      break;
    }
  }
  let excerpt = text.slice(start, end).trim();
  if (excerpt.length > max) {
    const from = Math.max(0, index - start - Math.floor((max - length) / 2));
    excerpt = excerpt.slice(from, from + max).trim();
  }
  return excerpt.slice(0, max);
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9£*"'(])|\s*[\n|•·]\s*|\s+[-–—]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}
