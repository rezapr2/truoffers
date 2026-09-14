import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { canonicalUkPostcode, normaliseUkPhone, UK_POSTCODE_IN_TEXT } from '../../common/business-identity';
import { INTAKE_LIMITS } from '../scraper.constants';
import { normaliseUrl, siteDomainOf } from '../safety/url';
import type { ExtractedBusiness, FieldEvidence, LoadedPage } from './adapter.types';
import { evidenceFor } from './evidence';
import { collapse, excerptAround } from './text';

const PHONE_IN_TEXT = /(?:\+44\s?\(0\)\s?|\+44\s?|\b0)(?:\d[\s-]?){8,10}\d/g;
const GENERIC_TITLE_PART =
  /^(?:home|homepage|welcome|menu|our\s+menu|order\s+online|order\s+now|online\s+ordering|takeaway|restaurant|delivery|collection|contact(?:\s+us)?|about(?:\s+us)?|offers|deals|official\s+site|best\s+.+\s+in\s+.+|.+\s+takeaway\s+in\s+.+|takeaway\s+in\s+.+|.+\s+delivery)$/i;
const ADDRESS_HINT = 'address, [itemprop="address"], [class*="address" i], [class*="location" i], [class*="contact" i], [id*="contact" i], footer';
const ORDER_LINK = /order\s+(?:online|now|here|food)|start\s+(?:your\s+)?order|place\s+(?:an\s+)?order/i;

function siteName($: CheerioAPI): { name: string; text: string; method: string } | null {
  const og = collapse($('meta[property="og:site_name"]').attr('content') ?? '');
  if (og) return { name: og, text: `og:site_name "${og}"`, method: 'html:og_site_name' };
  const title = collapse($('title').first().text());
  if (title) {
    const part = title
      .split(/\s+[|–—-]\s+|\s*[|•·]\s*|:\s+/)
      .map((p) => p.trim())
      .find((p) => p.length >= 2 && p.length <= 60 && !GENERIC_TITLE_PART.test(p));
    if (part) return { name: part, text: title, method: 'html:title' };
  }
  const logoAlt = collapse($('header img[alt], [class*="logo" i] img[alt], img[class*="logo" i][alt]').first().attr('alt') ?? '');
  if (logoAlt && !/logo$/i.test(logoAlt)) return { name: logoAlt, text: `logo alt "${logoAlt}"`, method: 'html:logo_alt' };
  const h1 = collapse($('h1').first().text());
  return h1 && h1.length <= 60 ? { name: h1, text: h1, method: 'html:h1' } : null;
}

function phoneFrom($: CheerioAPI, scope?: Element): { raw: string; e164: string; text: string; method: string } | null {
  const telLinks = scope ? $(scope).find('a[href^="tel:" i]') : $('a[href^="tel:" i]');
  for (const el of telLinks.toArray()) {
    const raw = decodeURIComponent(($(el).attr('href') ?? '').slice(4));
    const e164 = normaliseUkPhone(raw);
    if (e164) return { raw: collapse($(el).text()) || raw, e164, text: collapse($(el).parent().text()) || raw, method: 'html:tel_link' };
  }
  const areas = scope ? [scope] : $(ADDRESS_HINT).toArray();
  if (!scope) areas.push(...$('body').toArray());
  for (const area of areas) {
    const text = collapse($(area).text());
    for (const m of text.matchAll(PHONE_IN_TEXT)) {
      const e164 = normaliseUkPhone(m[0]);
      if (e164) return { raw: m[0].trim(), e164, text: excerptAround(text, m.index ?? 0, m[0].length), method: 'html:phone_text' };
    }
  }
  return null;
}

function addressFrom(text: string): { address: string; postcode: string; town?: string; index: number; length: number } | null {
  const m = UK_POSTCODE_IN_TEXT.exec(text);
  if (!m) return null;
  const postcode = canonicalUkPostcode(`${m[1]}${m[2]}`);
  if (!postcode) return null;
  const excerpt = excerptAround(text, m.index, m[0].length, 200);
  const beforePostcode = excerpt.slice(0, excerpt.toUpperCase().indexOf(m[0].toUpperCase())).replace(/[,\s]+$/, '');
  const parts = beforePostcode.split(',').map((p) => p.trim()).filter(Boolean);
  const town = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const address = parts.join(', ').replace(/^(?:address|find\s+us|visit\s+us|located\s+at)[:\s]+/i, '');
  return { address: address || excerpt, postcode, town: town && /^[A-Za-z' -]{2,40}$/.test(town) ? town : undefined, index: m.index, length: m[0].length };
}

function orderUrlFrom($: CheerioAPI, baseUrl: string): { url: string; text: string } | null {
  for (const el of $('a[href]').toArray()) {
    const label = collapse($(el).text());
    if (!ORDER_LINK.test(label)) continue;
    try {
      return { url: normaliseUrl($(el).attr('href')!, baseUrl), text: label };
    } catch {
      continue;
    }
  }
  return null;
}

function cite(evidence: Record<string, FieldEvidence>, field: string, url: string, text: string, method: string) {
  evidence[field] = evidenceFor(url, text, method);
}

/**
 * Business details from a page's visible content. A page listing several branches (distinct postcodes
 * in separate blocks) yields one business per branch.
 */
export function extractBusinessesFromHtml(page: LoadedPage, options: { branchPath?: string } = {}): ExtractedBusiness[] {
  const { $ } = page;
  const url = page.finalUrl;
  const name = siteName($);
  const branches = branchBlocks($, page);
  if (branches.length >= 2) {
    return branches.slice(0, INTAKE_LIMITS.maxBranchesPerSite).map((branch) => {
      const evidence: Record<string, FieldEvidence> = {};
      const business: ExtractedBusiness = { branchPath: branch.branchPath, branchLabel: branch.label, sourceUrl: url, evidence };
      if (name) {
        business.name = branch.label ? `${name.name} ${branch.label}` : name.name;
        cite(evidence, 'name', url, branch.label ? `${name.text} — ${branch.label}` : name.text, name.method);
      }
      business.address = branch.address.address;
      business.postcode = branch.address.postcode;
      business.town = branch.address.town;
      cite(evidence, 'address', url, branch.text, 'html:branch_block');
      cite(evidence, 'postcode', url, branch.text, 'html:branch_block');
      if (business.town) cite(evidence, 'town', url, branch.text, 'html:branch_block');
      const phone = phoneFrom($, branch.element);
      if (phone) {
        business.telephone = phone.e164;
        cite(evidence, 'telephone', url, phone.text, phone.method);
      }
      return business;
    });
  }

  const evidence: Record<string, FieldEvidence> = {};
  const business: ExtractedBusiness = {
    branchPath: options.branchPath ?? '/',
    sourceUrl: url,
    evidence,
    website: `${new URL(url).protocol}//${new URL(url).host}/`,
  };
  cite(evidence, 'website', url, url, 'html:page_origin');
  if (name) {
    business.name = name.name;
    cite(evidence, 'name', url, name.text, name.method);
  }
  const phone = phoneFrom($);
  if (phone) {
    business.telephone = phone.e164;
    cite(evidence, 'telephone', url, phone.text, phone.method);
  }
  for (const area of [...$(ADDRESS_HINT).toArray(), ...$('body').toArray()]) {
    const text = collapse($(area).text());
    const address = addressFrom(text);
    if (!address) continue;
    business.address = address.address;
    business.postcode = address.postcode;
    business.town = address.town;
    const excerpt = excerptAround(text, address.index, address.length, 300);
    cite(evidence, 'address', url, excerpt, 'html:address_block');
    cite(evidence, 'postcode', url, excerpt, 'html:address_block');
    if (address.town) cite(evidence, 'town', url, excerpt, 'html:address_block');
    break;
  }
  const order = orderUrlFrom($, url);
  if (order) {
    business.orderUrl = order.url;
    cite(evidence, 'orderUrl', url, `${order.text} → ${order.url}`, 'html:order_link');
  }
  return business.name || business.telephone || business.postcode ? [business] : [];
}

interface BranchBlock {
  element: Element;
  text: string;
  label?: string;
  branchPath: string;
  linkUrl?: string;
  address: NonNullable<ReturnType<typeof addressFrom>>;
}

// Same-site pages linked from individual branch blocks on a locations page.
export function branchPageLinks(page: LoadedPage): { url: string; label?: string }[] {
  const blocks = branchBlocks(page.$, page);
  return blocks.length >= 2 ? blocks.filter((b) => b.linkUrl).map((b) => ({ url: b.linkUrl!, label: b.label })) : [];
}

function branchBlocks($: CheerioAPI, page: LoadedPage): BranchBlock[] {
  const blocks: BranchBlock[] = [];
  const postcodes = new Set<string>();
  const siteDomain = siteDomainOf(new URL(page.finalUrl).hostname);
  for (const el of $('article, li, [class*="branch" i], [class*="location" i], [class*="store" i], address').toArray() as Element[]) {
    const text = collapse($(el).text());
    if (text.length > 400) continue;
    const address = addressFrom(text);
    if (!address || postcodes.has(address.postcode)) continue;
    // Skip wrappers that contain several branch blocks.
    if ($(el).find('article, li, address').toArray().some((child) => UK_POSTCODE_IN_TEXT.test(collapse($(child).text())))) continue;
    postcodes.add(address.postcode);

    const label = collapse($(el).find('h2, h3, h4, strong').first().text()) || address.town;
    let branchPath = `/@${address.postcode.replace(/\s+/g, '')}`;
    let linkUrl: string | undefined;
    for (const link of $(el).find('a[href]').toArray()) {
      try {
        const target = new URL(normaliseUrl($(link).attr('href')!, page.finalUrl));
        if (siteDomainOf(target.hostname) === siteDomain && target.pathname !== '/') {
          branchPath = target.pathname.replace(/\/+$/, '') || '/';
          linkUrl = target.toString();
          break;
        }
      } catch {
        continue;
      }
    }
    blocks.push({ element: el, text, label: label || undefined, branchPath, linkUrl, address });
  }
  return blocks;
}
