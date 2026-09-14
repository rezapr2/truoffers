import { parsePhoneNumberFromString } from 'libphonenumber-js';

// Returns an E.164 number, or null when the input isn't a valid UK-dialable number.
export function normaliseUkPhone(raw?: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\(0\)/g, '').trim();
  if (!/\d/.test(cleaned)) return null;
  const parsed = parsePhoneNumberFromString(cleaned, 'GB');
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

const UK_POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/;

// "ls11aa" / "LS1  1AA" -> "LS1 1AA"; null when it isn't a UK postcode.
export function canonicalUkPostcode(raw?: string | null): string | null {
  if (!raw) return null;
  const compact = raw.toUpperCase().replace(/\s+/g, '');
  if (compact === 'GIR0AA') return 'GIR 0AA';
  const match = UK_POSTCODE.exec(compact);
  return match ? `${match[1]} ${match[2]}` : null;
}

export const UK_POSTCODE_IN_TEXT = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

// Multi-word suffixes first so "co ltd" isn't reduced to a dangling "co".
const LEGAL_SUFFIXES = ['co ltd', 'and co', 'limited', 'ltd', 'llp', 'plc', 'lp', 'cic'];

// Lowercase, no diacritics or punctuation, legal suffixes removed: spec §8.
export function normaliseBusinessName(raw?: string | null): string | null {
  if (!raw) return null;
  let name = raw
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let stripped = true;
  while (stripped && name) {
    stripped = false;
    for (const suffix of LEGAL_SUFFIXES) {
      if (name === suffix) break;
      if (name.endsWith(` ${suffix}`)) {
        name = name.slice(0, -suffix.length - 1).trim();
        stripped = true;
      }
    }
  }
  return name || null;
}

// Hostname without "www.", lowercased and punycoded; null for anything that isn't a web address.
export function normaliseWebsiteHost(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    return host.includes('.') ? host : null;
  } catch {
    return null;
  }
}

export interface BusinessIdentity {
  phoneE164?: string;
  postcodeCanonical?: string;
  nameNormalized?: string;
  websiteHost?: string;
}

export function deriveBusinessIdentity(input: {
  name?: string | null;
  phone?: string | null;
  postcode?: string | null;
  website?: string | null;
}): BusinessIdentity {
  return {
    phoneE164: normaliseUkPhone(input.phone) ?? undefined,
    postcodeCanonical: canonicalUkPostcode(input.postcode) ?? undefined,
    nameNormalized: normaliseBusinessName(input.name) ?? undefined,
    websiteHost: normaliseWebsiteHost(input.website) ?? undefined,
  };
}
