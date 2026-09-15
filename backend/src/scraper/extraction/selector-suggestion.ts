import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { stableClass } from '../fingerprinting/markers';
import type { ExtractedBusiness, LoadedPage, OfferExtraction } from './adapter.types';
import { parseSelectorConfig, SelectorAdapterConfig } from './selector-config';
import { collapse } from './text';

export interface ExamplePage {
  page: LoadedPage;
  offers: OfferExtraction[];
  businesses: ExtractedBusiness[];
}

export interface SuggestionResult {
  config?: SelectorAdapterConfig;
  notes: string[];
}

const SKIP_CONTAINER_TAGS = new Set(['html', 'body', 'main']);

function isElement(node: AnyNode | null | undefined): node is Element {
  return !!node && node.type === 'tag';
}

// Most specific first: "h3.sf-offer-title", ".sf-offer-title", "h3".
function selectorCandidates(el: Element): string[] {
  const classes = (el.attribs?.class ?? '').split(/\s+/).map((c) => stableClass(c)).filter((c): c is string => !!c);
  return [...classes.map((c) => `${el.tagName}.${c}`), ...classes.map((c) => `.${c}`), el.tagName];
}

// The smallest element whose text contains the needle.
function smallestContaining($: CheerioAPI, scope: Cheerio<AnyNode>, needle: string): Element | null {
  const target = collapse(needle).toLowerCase();
  if (!target) return null;
  let best: Element | null = null;
  let bestLength = Infinity;
  scope.find('*').each((_, node) => {
    if (!isElement(node) || ['script', 'style'].includes(node.tagName)) return;
    const text = collapse($(node).text()).toLowerCase();
    if (text.includes(target) && text.length < bestLength) {
      best = node;
      bestLength = text.length;
    }
  });
  return best;
}

// The nearest ancestor that repeats on the page once per offer: the offer card.
function repeatedContainer($: CheerioAPI, titleEl: Element, titles: string[]): string[] {
  const out: string[] = [];
  for (let el = titleEl.parent; isElement(el); el = el.parent) {
    if (SKIP_CONTAINER_TAGS.has(el.tagName)) break;
    for (const selector of selectorCandidates(el).filter((s) => s !== el!.tagName)) {
      const matches = $(selector).toArray();
      const holdingTitles = matches.filter((m) => titles.some((t) => collapse($(m).text()).toLowerCase().includes(t.toLowerCase())));
      // Each card holds exactly one title, and the selector finds every titled card.
      const oneEach = holdingTitles.every((m) => titles.filter((t) => collapse($(m).text()).toLowerCase().includes(t.toLowerCase())).length === 1);
      if (holdingTitles.length === Math.min(titles.length, matches.length) && oneEach && holdingTitles.length > 0) out.push(selector);
    }
    if (out.length) return out;
  }
  return out;
}

function titleText(extraction: OfferExtraction): string {
  const evidence = extraction.offer.evidence.title?.text ?? extraction.offer.title;
  return evidence.split(/\s+—\s+|:\s+/)[0].slice(0, 80);
}

type FieldKey = 'title' | 'description' | 'promoCode' | 'minimumOrder' | 'expiry';

function fieldCandidates($: CheerioAPI, card: Cheerio<AnyNode>, extraction: OfferExtraction): Partial<Record<FieldKey, string[]>> {
  const found: Partial<Record<FieldKey, string[]>> = {};
  const title = smallestContaining($, card, titleText(extraction));
  if (title) found.title = selectorCandidates(title);

  const code = extraction.offer.promoCode && smallestContaining($, card, extraction.offer.promoCode);
  if (code) {
    // Prefer the element that also carries the "use code" wording.
    const wrapper = isElement(code.parent) && collapse($(code.parent).text()).length <= 60 ? code.parent : code;
    found.promoCode = [...selectorCandidates(wrapper as Element), ...selectorCandidates(code)];
  }
  if (extraction.offer.minimumOrder) {
    const el = smallestContaining($, card, `£${extraction.offer.minimumOrder}`);
    if (el) found.minimumOrder = selectorCandidates(el);
  }
  const expiry = card
    .find('*')
    .toArray()
    .filter(isElement)
    .filter((el) => /\b(?:ends?|until|expires?|valid until|offer ends)\b/i.test(collapse($(el).text())) && collapse($(el).text()).length <= 60)
    .sort((a, b) => collapse($(a).text()).length - collapse($(b).text()).length)[0];
  if (expiry) found.expiry = selectorCandidates(expiry);

  // The description: the longest other text block in the card.
  const description = card
    .find('p, div, span')
    .toArray()
    .filter(isElement)
    .filter((el) => el !== title && !$(el).find('*').toArray().some((child) => child === title))
    .map((el) => ({ el, text: collapse($(el).text()) }))
    .filter(({ text }) => text.length >= 20 && !/\b(?:use code|minimum order|ends?)\b/i.test(text))
    .sort((a, b) => b.text.length - a.text.length)[0];
  if (description) found.description = selectorCandidates(description.el);
  return found;
}

// First candidate every example agrees on (and that finds something on each).
function agree(lists: string[][]): string | undefined {
  if (lists.length === 0 || lists.some((l) => l.length === 0)) return undefined;
  return lists[0].find((candidate) => lists.every((list) => list.includes(candidate)));
}

function commonOfferPaths(examples: ExamplePage[][]): string[] {
  const perExample = examples.map(
    (pages) => new Set(pages.filter((p) => p.offers.length > 0).map((p) => new URL(p.page.finalUrl).pathname.replace(/\/+$/, '') || '/')),
  );
  if (perExample.length === 0) return [];
  return [...perExample[0]].filter((path) => path !== '/' && perExample.every((set) => set.has(path)));
}

/**
 * Suggests a selector adapter from example sites: generic extraction finds the offers, and the engine looks
 * for the markup that holds them — a repeated card and stable per-field selectors that work on every
 * example. Hashed and utility classes are ignored. The admin reviews, tests and edits the result.
 */
export function suggestSelectorConfig(examples: ExamplePage[][]): SuggestionResult {
  const notes: string[] = [];
  const containerLists: string[][] = [];
  const fieldLists: Record<FieldKey, string[][]> = { title: [], description: [], promoCode: [], minimumOrder: [], expiry: [] };
  const fieldSeen: Record<FieldKey, number> = { title: 0, description: 0, promoCode: 0, minimumOrder: 0, expiry: 0 };

  for (const [index, pages] of examples.entries()) {
    const withOffers = pages.filter((p) => p.offers.length > 0);
    if (withOffers.length === 0) {
      notes.push(`Example ${index + 1}: no offers found by generic extraction`);
      containerLists.push([]);
      continue;
    }
    const exampleContainers = new Set<string>();
    const exampleFields: Record<FieldKey, Set<string>> = {
      title: new Set(),
      description: new Set(),
      promoCode: new Set(),
      minimumOrder: new Set(),
      expiry: new Set(),
    };
    for (const { page, offers } of withOffers) {
      const { $ } = page;
      const titles = offers.map(titleText);
      for (const extraction of offers) {
        const titleEl = smallestContaining($, $.root(), titleText(extraction));
        if (!titleEl) continue;
        const containers = repeatedContainer($, titleEl, titles);
        containers.forEach((c) => exampleContainers.add(c));
        const card = containers.length ? $(titleEl).closest(containers[0]) : $(titleEl).parent();
        const fields = fieldCandidates($, card, extraction);
        for (const key of Object.keys(fields) as FieldKey[]) fields[key]!.forEach((s) => exampleFields[key].add(s));
      }
    }
    containerLists.push([...exampleContainers]);
    for (const key of Object.keys(exampleFields) as FieldKey[]) {
      if (exampleFields[key].size) {
        fieldLists[key].push([...exampleFields[key]]);
        fieldSeen[key] += 1;
      }
    }
  }

  const container = agree(containerLists);
  if (!container) {
    notes.push('No offer card markup is shared by every example; pick the container selector by hand');
    return { notes };
  }
  const fields: Record<string, { selector: string; parser?: string }> = {};
  for (const key of Object.keys(fieldLists) as FieldKey[]) {
    // A field only belongs in the template if every example that has offers shows it somewhere.
    if (fieldSeen[key] < examples.length) {
      if (fieldSeen[key] > 0) notes.push(`${key}: found on only ${fieldSeen[key]} of ${examples.length} examples`);
      continue;
    }
    const selector = agree(fieldLists[key]);
    if (selector) fields[key] = { selector };
    else notes.push(`${key}: examples disagree on the markup`);
  }
  if (!fields.title) {
    notes.push('Could not find a title selector shared by every example');
    return { notes };
  }

  const business = suggestBusiness(examples);
  const offerPaths = commonOfferPaths(examples);
  const { config, errors } = parseSelectorConfig({
    pages: offerPaths.length ? { offers: offerPaths } : undefined,
    business: Object.keys(business).length ? business : undefined,
    offers: { container, fields },
  });
  return { config, notes: [...notes, ...errors] };
}

function suggestBusiness(examples: ExamplePage[][]): Record<string, { selector: string }> {
  const lists: Record<'name' | 'telephone' | 'address', string[][]> = { name: [], telephone: [], address: [] };
  for (const pages of examples) {
    const found: Record<'name' | 'telephone' | 'address', Set<string>> = { name: new Set(), telephone: new Set(), address: new Set() };
    for (const { page, businesses } of pages) {
      const { $ } = page;
      for (const business of businesses) {
        const tel = $('a[href^="tel:"]').first().get(0);
        if (business.telephone && isElement(tel)) selectorCandidates(tel).filter((s) => s !== 'a').forEach((s) => found.telephone.add(s));
        if (business.postcode) {
          const el = smallestContaining($, $('footer').length ? $('footer') : $.root(), business.postcode);
          if (el) selectorCandidates(el).filter((s) => !s.match(/^[a-z]+$/)).forEach((s) => found.address.add(s));
        }
        if (business.name) {
          const el = smallestContaining($, $('footer').length ? $('footer') : $.root(), business.name);
          if (el) selectorCandidates(el).filter((s) => !s.match(/^[a-z]+$/)).forEach((s) => found.name.add(s));
        }
      }
    }
    for (const key of Object.keys(found) as (keyof typeof found)[]) lists[key].push([...found[key]]);
  }
  const out: Record<string, { selector: string }> = {};
  for (const key of Object.keys(lists) as (keyof typeof lists)[]) {
    const selector = agree(lists[key]);
    if (selector) out[key] = { selector };
  }
  return out;
}
