import { getDomain } from 'tldts';

export type LinkCheck = 'none' | 'invalid' | 'own_domain' | 'ordering_provider' | 'mismatch';

export const LINK_CHECK_LABELS: Record<LinkCheck, string> = {
  none: 'No link',
  invalid: 'Not a valid web address',
  own_domain: "On the business's own website",
  ordering_provider: 'On a known ordering provider',
  mismatch: "Not the business's website or a known ordering provider",
};

export function registrableDomain(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase();
    return getDomain(host) ?? host;
  } catch {
    return null;
  }
}

/** A URL a person typed, made absolute (https) and checked; null if it isn't a web address. */
export function normaliseUrl(input: string | undefined | null): string | null {
  const value = input?.trim();
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Spec: the order link (and an offer's link) must point at the business's own domain, or at Foodbell or another
 * known ordering provider. "Own" means the same registrable domain as the business's website or, for offers,
 * its order link.
 */
export function checkLink(
  url: string | undefined | null,
  business: { website?: string | null; orderUrl?: string | null },
  knownProviders: readonly string[],
  options: { againstOrderUrl?: boolean } = {},
): LinkCheck {
  if (!url) return 'none';
  const domain = registrableDomain(url);
  if (!domain) return 'invalid';
  const own = [registrableDomain(business.website), options.againstOrderUrl ? registrableDomain(business.orderUrl) : null].filter(Boolean);
  if (own.includes(domain)) return 'own_domain';
  const host = (() => {
    try {
      return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  if (knownProviders.some((provider) => domain === provider || host === provider || host.endsWith(`.${provider}`))) return 'ordering_provider';
  return 'mismatch';
}
