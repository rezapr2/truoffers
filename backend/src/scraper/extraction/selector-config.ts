import * as cheerio from 'cheerio';
import { z } from 'zod';
import { canonicalUkPostcode, normaliseUkPhone, UK_POSTCODE_IN_TEXT } from '../../common/business-identity';
import { findDates, findFixedAmount, findMinimumOrder, findPercentage, findPromoCode, findRequiredSpend } from './offer-patterns';
import { collapse, parseMoney } from './text';

// Admins pick one of these named parsers per field. There is deliberately no way to supply a regex.
export const FIELD_PARSERS = ['text', 'offer_text', 'money', 'percent', 'date', 'promo_code', 'phone', 'postcode', 'url'] as const;
export type FieldParser = (typeof FIELD_PARSERS)[number];

const probe = cheerio.load('<div><p></p></div>');
function isValidSelector(selector: string): boolean {
  try {
    probe(selector);
    return true;
  } catch {
    return false;
  }
}

const cssSelector = z
  .string()
  .trim()
  .min(1, 'Enter a CSS selector')
  .max(300)
  .refine((s) => !/[{}<>]/.test(s), 'CSS selectors cannot contain { } < or >')
  .refine(isValidSelector, 'Not a valid CSS selector');

export const fieldSelectorSchema = z
  .object({
    selector: cssSelector,
    source: z.enum(['text', 'attribute']).optional(),
    attribute: z.string().regex(/^[a-z][a-z0-9_:-]{0,39}$/i, 'Attribute names are letters, digits, - _ :').optional(),
    parser: z.enum(FIELD_PARSERS).optional(),
  })
  .refine((f) => f.source !== 'attribute' || !!f.attribute, 'Choose the attribute to read');
export type FieldSelector = z.infer<typeof fieldSelectorSchema>;

// "/offers", "/deals/*": literal segments, with * standing for any one segment.
const pathPattern = z
  .string()
  .trim()
  .max(200)
  .refine((p) => /^\/[\w\-.~/*]*$/.test(p), 'Use a path such as /offers or /deals/*');

export const selectorAdapterConfigSchema = z.object({
  pages: z
    .object({
      offers: z.array(pathPattern).max(10).optional(),
      business: z.array(pathPattern).max(10).optional(),
    })
    .optional(),
  business: z
    .object({
      container: cssSelector.optional(),
      name: fieldSelectorSchema.optional(),
      telephone: fieldSelectorSchema.optional(),
      address: fieldSelectorSchema.optional(),
      postcode: fieldSelectorSchema.optional(),
      orderUrl: fieldSelectorSchema.optional(),
    })
    .optional(),
  offers: z.object({
    container: cssSelector,
    fields: z.object({
      title: fieldSelectorSchema,
      description: fieldSelectorSchema.optional(),
      terms: fieldSelectorSchema.optional(),
      promoCode: fieldSelectorSchema.optional(),
      minimumOrder: fieldSelectorSchema.optional(),
      expiry: fieldSelectorSchema.optional(),
      orderUrl: fieldSelectorSchema.optional(),
    }),
  }),
});
export type SelectorAdapterConfig = z.infer<typeof selectorAdapterConfigSchema>;
export type OfferFieldName = keyof SelectorAdapterConfig['offers']['fields'];
export type BusinessFieldName = Exclude<keyof NonNullable<SelectorAdapterConfig['business']>, 'container'>;

export function parseSelectorConfig(input: unknown): { config?: SelectorAdapterConfig; errors: string[] } {
  const result = selectorAdapterConfigSchema.safeParse(input);
  if (result.success) return { config: result.data, errors: [] };
  return { errors: result.error.issues.map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`) };
}

export function pathMatches(pattern: string, pathname: string): boolean {
  const want = pattern.split('/').filter(Boolean);
  const have = pathname.split('/').filter(Boolean);
  if (want.length !== have.length) return false;
  return want.every((segment, i) => segment === '*' || segment.toLowerCase() === have[i].toLowerCase());
}

export interface ParseContext {
  checkedAt: Date;
  pageUrl: string;
}

export type ParsedValue =
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'dates'; startDate?: string; endDate?: string; flags: string[] }
  | { kind: 'none' };

// Turns the text (or attribute) a selector picked into a typed value, using the same pattern library as extraction.
export function applyParser(parser: FieldParser, raw: string, ctx: ParseContext): ParsedValue {
  const text = collapse(raw);
  if (!text) return { kind: 'none' };
  switch (parser) {
    case 'text':
    case 'offer_text':
      return { kind: 'text', value: text };
    case 'money': {
      const value = findMinimumOrder(text)?.value ?? findRequiredSpend(text)?.value ?? findFixedAmount(text)?.value ?? parseMoney(text.match(/£\s?(\d+(?:\.\d{1,2})?)/)?.[1]);
      return value !== undefined && value > 0 ? { kind: 'number', value } : { kind: 'none' };
    }
    case 'percent': {
      const value = findPercentage(text)?.value.percent;
      return value !== undefined ? { kind: 'number', value } : { kind: 'none' };
    }
    case 'date': {
      const dates = findDates(/\b(?:until|ends?|expires?|valid|from|starts?)\b/i.test(text) ? text : `Ends ${text}`, ctx.checkedAt);
      if (!dates.startDate && !dates.endDate) return { kind: 'none' };
      return { kind: 'dates', startDate: dates.startDate?.value, endDate: dates.endDate?.value, flags: dates.flags };
    }
    case 'promo_code': {
      const anchored = findPromoCode(text)?.value;
      if (anchored) return { kind: 'text', value: anchored };
      return /^[A-Z0-9][A-Z0-9_-]{2,19}$/.test(text) && /[A-Z]/.test(text) ? { kind: 'text', value: text } : { kind: 'none' };
    }
    case 'phone':
      return normaliseUkPhone(text) ? { kind: 'text', value: text.replace(/^tel:/i, '') } : { kind: 'none' };
    case 'postcode': {
      const match = text.match(UK_POSTCODE_IN_TEXT);
      const canonical = match && canonicalUkPostcode(`${match[1]} ${match[2]}`);
      return canonical ? { kind: 'text', value: canonical } : { kind: 'none' };
    }
    case 'url': {
      try {
        const url = new URL(raw.trim(), ctx.pageUrl);
        return url.protocol === 'http:' || url.protocol === 'https:' ? { kind: 'text', value: url.toString() } : { kind: 'none' };
      } catch {
        return { kind: 'none' };
      }
    }
  }
}

// The parser a field uses when the config doesn't name one.
export const DEFAULT_PARSERS: Record<OfferFieldName | BusinessFieldName, FieldParser> = {
  title: 'offer_text',
  description: 'offer_text',
  terms: 'text',
  promoCode: 'promo_code',
  minimumOrder: 'money',
  expiry: 'date',
  orderUrl: 'url',
  name: 'text',
  telephone: 'phone',
  address: 'text',
  postcode: 'postcode',
};
