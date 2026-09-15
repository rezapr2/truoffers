import type { CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { OFFER_CONTEXT } from './offer-patterns';
import { benefitSignature, hasBenefit } from './offer-text-parser';
import { collapse } from './text';

const BLOCK_TAGS = new Set([
  'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dt', 'dd', 'td', 'th', 'figcaption', 'blockquote', 'div', 'section',
  'article', 'aside', 'header', 'footer', 'main', 'nav', 'ul', 'ol', 'table', 'tr', 'tbody', 'form', 'fieldset', 'button',
  'label', 'details', 'summary', 'dialog', 'address', 'pre',
]);
const NON_CONTENT = 'script, style, noscript, template, svg, iframe, canvas, object, embed, select, option, input, textarea';
const OFFER_HINT = /(offer|deal|promo|discount|special|banner|hero|slide|carousel|announcement|notice|alert|modal|popup|voucher|coupon|saving)/i;
const BENEFIT_PREFILTER = /%|£|\bfree\b|bogof|\b2\s?for\s?1\b|half[\s-]price|\bdeal|\boffer|\bcode\b|buy\s+(?:one|1|two|2)/i;
const MAX_LEAF_CHARS = 400;
const MAX_CONTAINER_CHARS = 700;
const MAX_CONTAINER_DEPTH = 4;
const MAX_CONTEXT_DEPTH = 6;

export interface OfferTextBlock {
  text: string;
  containerText: string;
  heading?: string;
  offerContext: boolean;
}

function isElement(node: AnyNode | null | undefined): node is Element {
  return !!node && node.type === 'tag';
}

function hintOf(el: Element): string {
  return `${el.attribs?.class ?? ''} ${el.attribs?.id ?? ''} ${el.attribs?.role ?? ''}`;
}

/**
 * Splits a page into short text blocks that may carry an offer, each with the card or section around
 * it (for terms, codes and dates) and the nearest heading. Visually hidden content such as
 * unauthenticated popups is included; scripts and form controls are not.
 */
export function offerTextBlocks($: CheerioAPI, options: { pageIsOffers: boolean }): OfferTextBlock[] {
  const root = $.root().clone();
  root.find(NON_CONTENT).remove();
  const elements = root.find('*').toArray().filter(isElement);

  // Bottom-up: which elements contain block-level descendants.
  const hasBlockDescendant = new Set<Element>();
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (isElement(el.parent) && (BLOCK_TAGS.has(el.tagName) || hasBlockDescendant.has(el))) hasBlockDescendant.add(el.parent);
  }

  const textOf = new Map<Element, string>();
  const text = (el: Element) => {
    let value = textOf.get(el);
    if (value === undefined) {
      value = collapse($(el).text());
      textOf.set(el, value);
    }
    return value;
  };

  const candidates: Element[] = [];
  for (const el of elements) {
    if (hasBlockDescendant.has(el)) continue;
    // Inline elements count only when their parent can't be a leaf itself.
    if (!BLOCK_TAGS.has(el.tagName) && isElement(el.parent) && !hasBlockDescendant.has(el.parent)) continue;
    const value = text(el);
    if (value.length < 4 || value.length > MAX_LEAF_CHARS || !BENEFIT_PREFILTER.test(value)) continue;
    // Terms lines ("Use code X. Minimum order £15.") belong to the card, not a separate offer.
    if (!hasBenefit(value)) continue;
    candidates.push(el);
  }

  // A card often states its offer twice: a heading ("20% off all orders") and a description ("Get 20% off
  // online"). A heading and a body leaf with the same benefit count as one offer, so the card becomes
  // the context (with its code and minimum order) and only the heading is emitted.
  const signatureOf = new Map<Element, string>();
  const isHeading = (el: Element) => /^h[1-6]$/.test(el.tagName) || /title|heading|headline/i.test(el.attribs?.class ?? '');
  for (const leaf of candidates) signatureOf.set(leaf, benefitSignature(text(leaf)) ?? `text:${text(leaf)}`);

  const leavesUnder = new Map<Element, Element[]>();
  for (const leaf of candidates) {
    let node = leaf.parent;
    for (let depth = 0; isElement(node) && depth < MAX_CONTEXT_DEPTH; depth++, node = node.parent) {
      leavesUnder.set(node, [...(leavesUnder.get(node) ?? []), leaf]);
    }
  }
  const offersUnder = (node: Element) => {
    const groups = new Map<string, { headings: number; bodies: number }>();
    for (const leaf of leavesUnder.get(node) ?? []) {
      const group = groups.get(signatureOf.get(leaf)!) ?? { headings: 0, bodies: 0 };
      if (isHeading(leaf)) group.headings += 1;
      else group.bodies += 1;
      groups.set(signatureOf.get(leaf)!, group);
    }
    let count = 0;
    for (const group of groups.values()) count += group.headings > 0 && group.bodies > 0 ? Math.max(group.headings, group.bodies) : group.headings + group.bodies;
    return count;
  };
  const candidatesUnder = new Map<Element, number>([...leavesUnder.keys()].map((node) => [node, offersUnder(node)]));
  const emitted = new Set<string>();

  const seen = new Set<string>();
  const blocks: OfferTextBlock[] = [];
  for (const leaf of candidates) {
    const leafText = text(leaf);
    if (seen.has(leafText)) continue;
    seen.add(leafText);

    let container: Element = leaf;
    let offerContext = options.pageIsOffers || OFFER_HINT.test(hintOf(leaf));
    let node = leaf.parent;
    let containerClosed = false;
    for (let depth = 0; isElement(node) && depth < MAX_CONTEXT_DEPTH; depth++, node = node.parent) {
      if (OFFER_HINT.test(hintOf(node))) offerContext = true;
      if (containerClosed || depth >= MAX_CONTAINER_DEPTH) continue;
      if ((candidatesUnder.get(node) ?? 0) > 1 || text(node).length > MAX_CONTAINER_CHARS) {
        containerClosed = true;
        continue;
      }
      container = node;
    }

    const lowerLeaf = leafText.toLowerCase();
    let heading = $(container)
      .find('h1, h2, h3, h4, h5, h6, [class*="title" i], strong, b')
      .toArray()
      .filter(isElement)
      .map((h) => text(h))
      // A bold promo code ("<strong>SPICE20</strong>") is not a heading.
      .find((h) => h && h.length <= 80 && !/^[A-Z0-9][A-Z0-9_-]{2,19}$/.test(h) && !lowerLeaf.includes(h.toLowerCase()) && !h.toLowerCase().includes(lowerLeaf));
    heading ??= nearestPrecedingHeading(container, text);
    if (heading && OFFER_CONTEXT.test(heading)) offerContext = true;

    // The body line repeating a heading's benefit inside the same card is already covered by the heading.
    const cardKey = (el: Element) => `${signatureOf.get(leaf)}|${$(container).index()}|${text(container)}|${isHeading(el) ? 'h' : 'b'}`;
    if (container !== leaf) {
      const partner = (leavesUnder.get(container) ?? []).find((other) => other !== leaf && signatureOf.get(other) === signatureOf.get(leaf) && isHeading(other) !== isHeading(leaf));
      if (partner && !isHeading(leaf)) continue;
      if (emitted.has(cardKey(leaf))) continue;
      emitted.add(cardKey(leaf));
    }

    blocks.push({ text: leafText, containerText: text(container), heading, offerContext });
  }
  return blocks;
}

const PROMO_HINT = /offer|deal|discount|promo|special|save|saving|free|%|£|code|voucher|half\s+price|2\s?for\s?1|bogof/i;

// Short promotional-looking text for the AI fallback: leaf text only, never whole pages.
export function promotionalTextBlocks($: CheerioAPI, max = 12): string[] {
  const root = $.root().clone();
  root.find(NON_CONTENT).remove();
  const blocks: string[] = [];
  const seen = new Set<string>();
  root.find('h1, h2, h3, h4, p, li, span, div, a, strong, small, td').each((_, node) => {
    if (blocks.length >= max || !isElement(node)) return;
    if ($(node).children('p, li, div, h1, h2, h3, h4, ul, ol, table, section, article').length > 0) return;
    const value = collapse($(node).text());
    if (value.length < 12 || value.length > 400 || seen.has(value) || !PROMO_HINT.test(value)) return;
    seen.add(value);
    blocks.push(value);
  });
  return blocks;
}

function nearestPrecedingHeading(el: Element, text: (el: Element) => string): string | undefined {
  let node: Element | null = el;
  for (let depth = 0; node && depth < 4; depth++) {
    for (let sibling = node.prev; sibling; sibling = sibling.prev) {
      if (!isElement(sibling)) continue;
      if (/^h[1-4]$/.test(sibling.tagName)) {
        const value = text(sibling);
        if (value && value.length <= 80) return value;
      }
    }
    node = isElement(node.parent) ? node.parent : null;
  }
  return undefined;
}
