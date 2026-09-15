import type { ExampleAnalysis } from '../../schemas/website-fingerprint.schema';

/**
 * Page text kept by the adapter builder: offer excerpts in a fingerprint's example analysis, and offer
 * excerpts, field text and branch contact details in an adapter version's test results. These are working
 * aids, so retention removes the text and keeps the counts, titles, URLs and parser outcomes.
 */

interface TestedOffer {
  excerpt?: string;
  fields?: Record<string, { text?: string; method?: string }>;
  [key: string]: unknown;
}

interface TestedBusiness {
  branchPath?: string;
  [key: string]: unknown;
}

export interface TestedDomain {
  domain: string;
  offers?: TestedOffer[];
  businesses?: TestedBusiness[];
  [key: string]: unknown;
}

export interface AdapterTestResults {
  ranAt?: Date;
  jobId?: string;
  summary?: Record<string, number>;
  domains?: TestedDomain[];
  redactedAt?: Date;
}

// `domains` limits redaction to those websites (an opt-out); null redacts every example (end of retention).
function covers(domains: ReadonlySet<string> | null, domain: string) {
  return domains === null || domains.has(domain);
}

export function redactFingerprintExamples(examples: ExampleAnalysis[], domains: ReadonlySet<string> | null) {
  let changed = 0;
  const redacted = examples.map((example) => {
    if (!covers(domains, example.domain) || example.offersFound.every((o) => o.excerpt === '')) return example;
    changed += 1;
    return { ...example, offersFound: example.offersFound.map((o) => ({ ...o, excerpt: '' })) };
  });
  return { examples: redacted, changed };
}

export function redactTestResults(results: AdapterTestResults, domains: ReadonlySet<string> | null, now: Date) {
  let changed = 0;
  const redactedDomains = (results.domains ?? []).map((entry) => {
    if (!covers(domains, entry.domain) || entry.excerptsRedacted === true) return entry;
    changed += 1;
    return {
      ...entry,
      offers: (entry.offers ?? []).map((offer) => ({
        ...offer,
        excerpt: '',
        fields: Object.fromEntries(Object.entries(offer.fields ?? {}).map(([field, e]) => [field, { method: e.method, text: '' }])),
      })),
      // Branch names, phone numbers and addresses can identify sole traders; only the branch path stays.
      businesses: (entry.businesses ?? []).map((b) => ({ branchPath: b.branchPath })),
      excerptsRedacted: true,
    };
  });
  return {
    results: { ...results, domains: redactedDomains, ...(domains === null ? { redactedAt: now } : {}) },
    changed,
  };
}
