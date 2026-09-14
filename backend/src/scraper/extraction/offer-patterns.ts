import type { Weekday } from '../../common/scraper.enums';
import { daysBetween, lastDayOfMonth, londonDate, nextWeekdayDate, toIsoDate } from './london-time';
import { parseCount, parseMoney, TextMatch } from './text';

// UK takeaway offer patterns. Each detector is pure and returns what it found plus where, so the
// caller can attach the matching text as field-level evidence.

const MONEY = String.raw`£\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)`;
const COUNT = String.raw`(one|two|three|four|five|six|\d)`;

function first<T>(re: RegExp, text: string, map: (m: RegExpExecArray) => T | undefined): TextMatch<T> | null {
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (const m of text.matchAll(global)) {
    const value = map(m as RegExpExecArray);
    if (value !== undefined) return { value, index: m.index ?? 0, length: m[0].length };
  }
  return null;
}

export const OFFER_CONTEXT = /\b(offers?|deals?|promotions?|promos?|specials?|discounts?|savings?|vouchers?|coupons?|bundles?)\b/i;

const PROMOTIONAL =
  /\b(offers?|deals?|discounts?|promo(?:tion)?s?|specials?|save|saving|savings|off|free|bogof|half[\s-]price|vouchers?|coupons?|code|limited\s+time|this\s+week|today\s+only|exclusive|bonus|bargain|reduced|now\s+only|just\s+£|only\s+£)\b|\d\s?%|\b2\s?for\s?1\b/i;

export function findPromotionalLanguage(text: string): TextMatch<string> | null {
  const m = PROMOTIONAL.exec(text);
  return m ? { value: m[0], index: m.index, length: m[0].length } : null;
}

// ---------- benefits ----------

export function findPercentage(text: string): TextMatch<{ percent: number; upTo: boolean }> | null {
  const half = /\bhalf[\s-]price\b/i.exec(text);
  const pct = first(
    /(\bup\s+to\s+)?(?<![\d.£])(100|\d{1,2}(?:\.\d)?)\s?%(\s*(?:off|discount|reduction|saving|savings|less))?/i,
    text,
    (m) => {
      const percent = Number(m[2]);
      if (!(percent > 0 && percent <= 100)) return undefined;
      const before = text.slice(Math.max(0, (m.index ?? 0) - 24), m.index).toLowerCase();
      const discountContext = !!m[3] || /\b(save|saving|get|enjoy|take|extra|discount\s+of|up\s+to)\s*$/.test(before);
      return discountContext ? { percent, upTo: !!m[1] } : undefined;
    },
  );
  if (pct && (!half || pct.index <= half.index)) return pct;
  return half ? { value: { percent: 50, upTo: false }, index: half.index, length: half[0].length } : null;
}

export function findFixedAmount(text: string): TextMatch<number> | null {
  return first(new RegExp(String.raw`(\b(?:save|get|enjoy|take)\s+(?:an?\s+extra\s+)?)?${MONEY}(\s*(?:off|discount|saving))?`, 'i'), text, (m) => {
    if (!m[1] && !m[3]) return undefined;
    const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 20).toLowerCase();
    if (/^\s*(?:or\s+more|min|minimum|spend|and\s+over)/.test(after)) return undefined;
    const amount = parseMoney(m[2]);
    return amount && amount > 0 ? amount : undefined;
  });
}

export function findWasNow(text: string): TextMatch<{ original: number; promotional: number }> | null {
  return first(
    new RegExp(String.raw`\b(?:was|rrp|usually|normally)\s+${MONEY}\s*[,;/-]?\s*(?:now|only|just)\s+(?:only\s+|just\s+)?${MONEY}`, 'i'),
    text,
    (m) => {
      const original = parseMoney(m[1]);
      const promotional = parseMoney(m[2]);
      return original && promotional && promotional < original ? { original, promotional } : undefined;
    },
  );
}

export function findBogof(text: string): TextMatch<true> | null {
  return first(
    /\b(?:buy\s+(?:one|1)\s+get\s+(?:one|1)\s+free|bogof|bogo|b1g1|two\s+for\s+one|2\s?for\s?1|2\s?-\s?4\s?-\s?1|241(?=\s+(?:deal|offer|special|on|pizzas?|kebabs?|burgers?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)))\b/i,
    text,
    () => true as const,
  );
}

export interface MultiBuy {
  buy?: number;
  free?: number;
  quantity?: number;
  price?: number;
  product?: string;
  secondItemPercent?: number;
}

export function findMultiBuy(text: string): TextMatch<MultiBuy> | null {
  const halfPrice = first(/\bbuy\s+(one|1|two|2)\s+(?:[a-z]+\s+){0,2}?get\s+(?:(?:the\s+)?(?:second|2nd|one|1|another)\s+)?half\s+price\b/i, text, (m) => ({
    buy: parseCount(m[1]),
    secondItemPercent: 50,
  }));
  if (halfPrice) return halfPrice;

  const buyGetFree = first(
    new RegExp(String.raw`\bbuy\s+${COUNT}\s+(?:[a-z]+\s+){0,3}?get\s+(a|an|one|two|three|\d)\s+(?:[a-z]+\s+){0,2}?free\b`, 'i'),
    text,
    (m) => {
      const buy = parseCount(m[1]);
      const free = parseCount(m[2]);
      // "buy one get one free" is a BOGOF, reported by findBogof.
      return buy && free && !(buy === 1 && free === 1) ? { buy, free } : undefined;
    },
  );
  if (buyGetFree) return buyGetFree;

  return first(
    new RegExp(
      String.raw`\b(?:any\s+)?${COUNT}\s+((?:(?:large|medium|small|regular|\d{1,2}(?:"|\s?inch))\s+)?[a-z][a-z' ]{2,30}?\s+)?for\s+(?:just\s+|only\s+)?${MONEY}`,
      'i',
    ),
    text,
    (m) => {
      const quantity = parseCount(m[1]);
      const price = parseMoney(m[3]);
      if (!quantity || quantity < 2 || !price) return undefined;
      const product = m[2]?.trim().toLowerCase();
      return { quantity, price, product: product || undefined };
    },
  );
}

export function findFreeDelivery(text: string): TextMatch<true> | null {
  return first(
    /\b(?:free\s+delivery|delivery\s+(?:is\s+)?free|no\s+delivery\s+(?:charges?|fees?)|zero\s+delivery\s+(?:fees?|charges?))\b/i,
    text,
    () => true as const,
  );
}

const NOT_AN_ITEM_BEFORE_FREE = /\b(gluten|dairy|nut|nuts|sugar|lactose|alcohol|meat|fat|hassle|stress|fuss|commission|cash|contact|toll|risk|duty|interest|cruelty|tax|fee|carbon|plastic|allergen|egg|soya|wheat|caffeine)[\s-]*$/i;

export function findFreeItem(text: string): TextMatch<string> | null {
  const complimentary = first(/\bcomplimentary\s+([a-z][a-z' &-]{2,40}?)(?=\s+(?:with|on|when|for|if)\b|[.!,;:()]|$)/i, text, (m) =>
    m[1].trim(),
  );
  const free = first(
    /\bfree\s+((?:(?:can|bottle|portion|bag|side|serving|tub|pot|slice|box)\s+of\s+)?(?!(?:delivery|collection|wi-?fi|parking|from|range|to|of|for|with|on|when|and|or|entry|gift|trial|shipping)\b)[a-z0-9][a-z0-9' .&-]{1,40}?)(?=\s+(?:with|on|when|for|if|worth|every|per)\b|[.!,;:()]|$)/i,
    text,
    (m) => {
      const before = text.slice(Math.max(0, (m.index ?? 0) - 20), m.index);
      if (NOT_AN_ITEM_BEFORE_FREE.test(before)) return undefined;
      const item = m[1].trim().replace(/\s+/g, ' ');
      return item.length >= 2 ? item : undefined;
    },
  );
  if (free && (!complimentary || free.index <= complimentary.index)) return free;
  return complimentary;
}

export function findMealDeal(text: string): TextMatch<{ name: string; price?: number }> | null {
  const deal = first(
    /\b(meal\s+deals?|family\s+(?:deals?|feasts?|meals?|bundles?|box(?:es)?|offers?)|(?:party|sharing|kids'?|student|lunch(?:time)?)\s+(?:deals?|box(?:es)?|bundles?|feasts?|meals?)|combo\s+(?:deals?|meals?)|(?:deal|meal|feast|set\s+menu)\s+for\s+(?:one|two|three|four|five|six|\d))\b/i,
    text,
    (m) => m[1],
  );
  if (!deal) return null;
  const window = text.slice(deal.index, deal.index + deal.length + 80);
  const price = new RegExp(MONEY).exec(window);
  return { ...deal, value: { name: deal.value, price: price ? parseMoney(price[1]) : undefined } };
}

export function findPricePoint(text: string): TextMatch<{ product: string; price: number }> | null {
  return first(
    new RegExp(
      String.raw`\b(?:any|all|every)\s+((?:(?:large|medium|small|regular|\d{1,2}(?:"|\s?inch))\s+)?[a-z][a-z' ]{2,30}?)\s+(?:(?:for\s+)?(?:just|only|now|at)\s+)?${MONEY}(?:\s+each)?`,
      'i',
    ),
    text,
    (m) => {
      const price = parseMoney(m[2]);
      const product = m[1].trim().toLowerCase();
      if (!price || /^(orders?|items?|products?|food)$/.test(product)) return undefined;
      // "all collection orders over £25" is a spend threshold, not a price.
      if (/\b(?:orders?|over|above|of|worth|spend|from|min(?:imum)?|more\s+than)\b/.test(product)) return undefined;
      return { product, price };
    },
  );
}

// ---------- terms ----------

export type Channel = 'collection' | 'delivery' | 'both';

export function findChannel(text: string): TextMatch<Channel> | null {
  const both = first(/\b(?:collection\s+(?:and|&|or)\s+delivery|delivery\s+(?:and|&|or)\s+collection)\b/i, text, () => 'both' as const);
  if (both) return both;
  const collection = first(
    /\b(?:collection\s+only|only\s+(?:valid\s+)?(?:on|for)\s+collection|collection\s+orders?|when\s+you\s+collect|collected\s+orders?|for\s+collection)\b/i,
    text,
    () => 'collection' as const,
  );
  const delivery = first(
    /\b(?:delivery\s+only|only\s+(?:valid\s+)?(?:on|for)\s+delivery|delivery\s+orders?|delivered\s+orders?|for\s+delivery)\b/i,
    text,
    () => 'delivery' as const,
  );
  if (collection && delivery) return collection.index < delivery.index ? collection : delivery;
  return collection ?? delivery;
}

export function findNewCustomers(text: string): TextMatch<true> | null {
  return first(
    /\b(?:new\s+customers?|(?:your\s+)?first\s+(?:online\s+|app\s+)?order|1st\s+order|first[-\s]time\s+(?:customers?|orders?|buyers?)|welcome\s+(?:offer|discount|code))\b/i,
    text,
    () => true as const,
  );
}

export function findMinimumOrder(text: string): TextMatch<number> | null {
  const patterns = [
    new RegExp(String.raw`\b(?:on\s+)?(?:all\s+)?orders?\s+(?:over|above|of|exceeding|worth)\s+${MONEY}`, 'i'),
    new RegExp(String.raw`\bmin(?:imum|\.)?\s*(?:order|spend)(?:\s+(?:of|value|amount))?\s*(?:is\s+|:)?\s*${MONEY}`, 'i'),
    new RegExp(String.raw`${MONEY}\s+(?:min(?:imum|\.)?\s*(?:order|spend)|or\s+more|and\s+over)`, 'i'),
  ];
  for (const re of patterns) {
    const match = first(re, text, (m) => parseMoney(m[1]));
    if (match) return match;
  }
  return null;
}

export function findRequiredSpend(text: string): TextMatch<number> | null {
  return first(new RegExp(String.raw`\b(?:when\s+you\s+|if\s+you\s+)?spend\s+(?:over\s+|more\s+than\s+|at\s+least\s+)?${MONEY}`, 'i'), text, (m) =>
    parseMoney(m[1]),
  );
}

const CODE_STOPWORDS = new Set(
  'at checkout below applies apply when online is to for the a an your and required needed valid only from will on in this that of or here now'.split(' '),
);

export function findPromoCode(text: string): TextMatch<string> | null {
  return first(
    /\b(?:promo(?:tion(?:al)?)?\s+code|discount\s+code|voucher\s+code|offer\s+code|coupon(?:\s+code)?|use\s+(?:the\s+)?(?:promo\s+)?code|enter\s+(?:the\s+)?code|apply\s+(?:the\s+)?code|with\s+(?:the\s+)?code|quote|code)\s*(?:[:\-–]|is)?\s*["'“‘`]?([A-Za-z0-9][A-Za-z0-9_-]{2,19})["'”’`]?/i,
    text,
    (m) => {
      const token = m[1];
      if (CODE_STOPWORDS.has(token.toLowerCase())) return undefined;
      if (!/[A-Za-z]/.test(token)) return undefined;
      if (token !== token.toUpperCase() && !/\d/.test(token)) return undefined;
      return token.toUpperCase();
    },
  );
}

const DAY_ORDER: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_TOKEN = String.raw`(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:rs?(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)`;

function dayOf(token: string): Weekday {
  return token.toLowerCase().slice(0, 3) as Weekday;
}

function expandRange(from: Weekday, to: Weekday): Weekday[] {
  const days: Weekday[] = [];
  let i = DAY_ORDER.indexOf(from);
  for (let guard = 0; guard < 7; guard++) {
    days.push(DAY_ORDER[i]);
    if (DAY_ORDER[i] === to) break;
    i = (i + 1) % 7;
  }
  return days;
}

export function findWeekdays(text: string): TextMatch<Weekday[]> | null {
  const range = new RegExp(String.raw`\b${DAY_TOKEN}s?\.?\s*(?:-|–|—|to|through|thru|until|till)\s*${DAY_TOKEN}s?\b\.?`, 'i').exec(text);
  if (range) return { value: expandRange(dayOf(range[1]), dayOf(range[2])), index: range.index, length: range[0].length };

  const weekdays = /\b(?:week\s?days|monday\s+to\s+friday)\b/i.exec(text);
  if (weekdays) return { value: ['mon', 'tue', 'wed', 'thu', 'fri'], index: weekdays.index, length: weekdays[0].length };
  const weekends = /\bweekends?\b/i.exec(text);

  const full = [...text.matchAll(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/gi)];
  const short = [...text.matchAll(/\b(mon|tues?|weds?|thurs?|fri|sat|sun)\b\.?(?=\s*(?:,|&|and|\/|\+))/gi)];
  const tokens = full.length ? full : short.length >= 2 ? [...text.matchAll(/\b(mon|tues?|weds?|thurs?|fri|sat|sun)\b/gi)] : [];
  if (tokens.length === 0) {
    return weekends ? { value: ['sat', 'sun'], index: weekends.index, length: weekends[0].length } : null;
  }
  const days = new Set(tokens.map((t) => dayOf(t[1])));
  if (weekends) {
    days.add('sat');
    days.add('sun');
  }
  const start = Math.min(...tokens.map((t) => t.index ?? 0));
  const last = tokens[tokens.length - 1];
  return {
    value: DAY_ORDER.filter((d) => days.has(d)),
    index: start,
    length: (last.index ?? 0) + last[0].length - start,
  };
}

function toHHmm(hour: number, minute: number, meridiem?: string): string | undefined {
  let h = hour;
  if (meridiem) {
    const pm = meridiem.toLowerCase() === 'pm';
    if (h < 1 || h > 12) return undefined;
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  if (h > 23 || minute > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function findTimeWindow(text: string): TextMatch<{ start?: string; end?: string }> | null {
  const twelve = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|until|till)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/i.exec(text);
  if (twelve) {
    const endMeridiem = twelve[6];
    let startMeridiem = twelve[3];
    if (!startMeridiem) {
      // "5-7pm": the start shares the end's meridiem unless that would put it after the end.
      startMeridiem = Number(twelve[1]) > Number(twelve[4]) && endMeridiem.toLowerCase() === 'pm' ? 'am' : endMeridiem;
    }
    const start = toHHmm(Number(twelve[1]), Number(twelve[2] ?? 0), startMeridiem);
    const end = toHHmm(Number(twelve[4]), Number(twelve[5] ?? 0), endMeridiem);
    if (start && end) return { value: { start, end }, index: twelve.index, length: twelve[0].length };
  }
  const twentyFour = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(?:-|–|—|to|until|till)\s*([01]?\d|2[0-3])[:.]([0-5]\d)\b/.exec(text);
  if (twentyFour) {
    return {
      value: { start: toHHmm(Number(twentyFour[1]), Number(twentyFour[2])), end: toHHmm(Number(twentyFour[3]), Number(twentyFour[4])) },
      index: twentyFour.index,
      length: twentyFour[0].length,
    };
  }
  const before = /\b(?:before|until|till)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/i.exec(text);
  if (before) {
    const end = toHHmm(Number(before[1]), Number(before[2] ?? 0), before[3]);
    if (end) return { value: { end }, index: before.index, length: before[0].length };
  }
  const after = /\b(?:after|from)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/i.exec(text);
  if (after) {
    const start = toHHmm(Number(after[1]), Number(after[2] ?? 0), after[3]);
    if (start) return { value: { start }, index: after.index, length: after[0].length };
  }
  return null;
}

// ---------- dates ----------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const DAY = String.raw`(\d{1,2})(?:st|nd|rd|th)?`;

const END_MARKER = /\b(?:until|till|til|ends?|ended|ending|expires?|expired|expiry|valid\s+(?:until|till|to|through|thru)|offer\s+ends|closing\s+date|last\s+day|before|through|thru|up\s+to|by)\s*(?:the\s+)?(?:on\s+)?$/i;
const START_MARKER = /\b(?:from|starts?|starting|begins?|beginning|valid\s+from|available\s+from|launch(?:es|ing)?\s+on)\s*(?:the\s+)?(?:on\s+)?$/i;

export interface DateFinding {
  startDate?: TextMatch<string>;
  endDate?: TextMatch<string>;
  flags: string[];
  oldYearReference?: TextMatch<number>;
}

interface RawDate {
  iso: string;
  index: number;
  length: number;
  yearInferred: boolean;
}

function monthNumber(token: string): number {
  return MONTHS[token.toLowerCase().slice(0, 3)];
}

function inferYear(month: number, day: number, checkedAt: Date): { iso?: string; inferred: true } {
  const today = londonDate(checkedAt);
  const year = Number(today.slice(0, 4));
  let iso = toIsoDate(year, month, day);
  // A year-less date more than two months in the past most likely means next year.
  if (iso && daysBetween(iso, today) > 60) iso = toIsoDate(year + 1, month, day);
  return { iso, inferred: true };
}

function explicitYear(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const year = Number(raw);
  return raw.length === 2 ? 2000 + year : year;
}

function collectDates(text: string, checkedAt: Date): RawDate[] {
  const found: RawDate[] = [];
  const add = (index: number, length: number, year: number | undefined, month: number, day: number) => {
    if (found.some((d) => index < d.index + d.length && d.index < index + length)) return;
    if (year) {
      const iso = toIsoDate(year, month, day);
      if (iso) found.push({ iso, index, length, yearInferred: false });
    } else {
      const { iso } = inferYear(month, day, checkedAt);
      if (iso) found.push({ iso, index, length, yearInferred: true });
    }
  };
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) add(m.index ?? 0, m[0].length, Number(m[1]), Number(m[2]), Number(m[3]));
  for (const m of text.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4}|\d{2})\b/g)) {
    add(m.index ?? 0, m[0].length, explicitYear(m[3]), Number(m[2]), Number(m[1]));
  }
  for (const m of text.matchAll(new RegExp(String.raw`\b${DAY}\s+(?:of\s+)?${MONTH}\.?(?:,?\s+(\d{4}))?\b`, 'gi'))) {
    add(m.index ?? 0, m[0].length, explicitYear(m[3]), monthNumber(m[2]), Number(m[1]));
  }
  for (const m of text.matchAll(new RegExp(String.raw`\b${MONTH}\.?\s+${DAY}(?:,?\s+(\d{4}))?\b`, 'gi'))) {
    add(m.index ?? 0, m[0].length, explicitYear(m[3]), monthNumber(m[1]), Number(m[2]));
  }
  return found.sort((a, b) => a.index - b.index);
}

export function findDates(text: string, checkedAt: Date): DateFinding {
  const flags: string[] = [];
  const today = londonDate(checkedAt);
  const result: DateFinding = { flags };

  const oldYear = [...text.matchAll(/\b(20\d{2})\b/g)].find((m) => {
    if (Number(m[1]) >= Number(today.slice(0, 4))) return false;
    const before = text.slice(Math.max(0, (m.index ?? 0) - 20), m.index);
    return !/(?:since|est\.?|established|founded|opened|serving|©|copyright|\(c\))\s*$/i.test(before);
  });
  if (oldYear) result.oldYearReference = { value: Number(oldYear[1]), index: oldYear.index ?? 0, length: 4 };

  // "1st - 14th February 2027"
  const dayRange = new RegExp(String.raw`\b${DAY}\s*(?:-|–|—|to|until|till)\s*${DAY}\s+(?:of\s+)?${MONTH}(?:,?\s+(\d{4}))?\b`, 'i').exec(text);
  if (dayRange) {
    const month = monthNumber(dayRange[3]);
    const year = explicitYear(dayRange[4]);
    const start = year ? toIsoDate(year, month, Number(dayRange[1])) : inferYear(month, Number(dayRange[1]), checkedAt).iso;
    const end = year ? toIsoDate(year, month, Number(dayRange[2])) : inferYear(month, Number(dayRange[2]), checkedAt).iso;
    if (start && end && start <= end) {
      if (!year) flags.push('year_inferred');
      const span = { index: dayRange.index, length: dayRange[0].length };
      return { ...result, startDate: { value: start, ...span }, endDate: { value: end, ...span } };
    }
  }

  // "throughout January"
  const monthRange = new RegExp(String.raw`\b(?:throughout|all\s+(?:of\s+)?|during|for\s+the\s+whole\s+of|every\s+day\s+in)\s+${MONTH}(?:\s+(\d{4}))?\b`, 'i').exec(text);
  if (monthRange) {
    const month = monthNumber(monthRange[1]);
    let year = explicitYear(monthRange[2]);
    if (!year) {
      year = Number(today.slice(0, 4));
      if (lastDayOfMonth(year, month) < today) year += 1;
      flags.push('year_inferred');
    }
    const span = { index: monthRange.index, length: monthRange[0].length };
    return {
      ...result,
      startDate: { value: toIsoDate(year, month, 1)!, ...span },
      endDate: { value: lastDayOfMonth(year, month), ...span },
    };
  }

  const dates = collectDates(text, checkedAt);
  for (const date of dates) {
    const before = text.slice(Math.max(0, date.index - 30), date.index);
    const match = { value: date.iso, index: date.index, length: date.length };
    if (END_MARKER.test(before) && !result.endDate) result.endDate = match;
    else if (START_MARKER.test(before) && !result.startDate) result.startDate = match;
    else continue;
    if (date.yearInferred && !flags.includes('year_inferred')) flags.push('year_inferred');
  }
  if (!result.startDate && !result.endDate && dates.length === 2 && dates[0].iso <= dates[1].iso) {
    result.startDate = { value: dates[0].iso, index: dates[0].index, length: dates[0].length };
    result.endDate = { value: dates[1].iso, index: dates[1].index, length: dates[1].length };
    if (dates.some((d) => d.yearInferred)) flags.push('year_inferred');
  } else if (dates.length > 0 && !result.startDate && !result.endDate) {
    flags.push('unlabelled_date');
  }

  if (!result.endDate) {
    const relative = new RegExp(String.raw`\b(?:until|till|ends?|ending|expires?)\s+(?:this\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b`, 'i').exec(text);
    if (relative) {
      result.endDate = { value: nextWeekdayDate(checkedAt, relative[1].slice(0, 3).toLowerCase() as Weekday), index: relative.index, length: relative[0].length };
      flags.push('relative_date');
    } else {
      const todayOnly = /\b(?:today\s+only|tonight\s+only|one\s+day\s+only)\b/i.exec(text);
      if (todayOnly) {
        const span = { index: todayOnly.index, length: todayOnly[0].length };
        result.startDate = { value: today, ...span };
        result.endDate = { value: today, ...span };
        flags.push('relative_date');
      }
    }
  }
  return result;
}

const NON_PRODUCT = /^(?:your|the|our|all|any|every|orders?|collection|delivery|food|everything|total|bill|purchases?|checkout|app|website|online|first|next|takeaway|menu|items?|selected\s+items?)\b/i;

export function findProducts(text: string): TextMatch<string[]> | null {
  return first(
    /\b(?:on|off)\s+(?:all\s+|any\s+|selected\s+|every\s+)?((?:(?:large|medium|small|regular|\d{1,2}(?:"|\s?inch))\s+)?[a-z][a-z' &-]{2,40}?)(?=\s+(?:every|each|when|with|on|for|until|till|if|from|before|after|between|this|today|tonight|at|over|above)\b|[.!,;:()]|$)/i,
    text,
    (m) => {
      const product = m[1].trim().toLowerCase();
      if (NON_PRODUCT.test(product) || /\d\s?%|£/.test(product)) return undefined;
      return [product];
    },
  );
}
