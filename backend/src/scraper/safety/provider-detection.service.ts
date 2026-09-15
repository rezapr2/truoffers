import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { CheerioAPI } from 'cheerio';
import { promises as dns } from 'node:dns';
import { Model, Types } from 'mongoose';
import { ProviderPolicyStatus } from '../../common/scraper.enums';
import { ProviderPolicy, ProviderPolicyDocument } from '../../schemas/provider-policy.schema';
import { CNAME_RESOLVER } from '../scraper.tokens';
import { hostMatchesDomain } from './url';

export type CnameResolver = (hostname: string) => Promise<string[]>;

export const systemCnameResolver: CnameResolver = async (hostname) => {
  try {
    return await dns.resolveCname(hostname);
  } catch {
    return [];
  }
};

export interface ProviderMatch {
  policyId: Types.ObjectId;
  name: string;
  status: ProviderPolicyStatus;
  signals: string[];
}

type PolicyLean = ProviderPolicy & { _id: Types.ObjectId };

// Attribution wording that points at an ordering platform rather than a CMS or web designer.
const ORDERING_ATTRIBUTION = [
  /online\s+ordering\s+(?:system\s+|platform\s+)?(?:(?:powered|provided)\s+)?by\s+(.{1,60})/i,
  /ordering\s+(?:system|platform|website)\s+(?:(?:powered|provided)\s+)?by\s+(.{1,60})/i,
  /powered\s+by\s+(.{1,40}?)\s+online\s+ordering/i,
];

// "OrderNest. All rights reserved" -> "OrderNest"
function leadingName(text: string): string | null {
  const words: string[] = [];
  for (const word of text.trim().split(/\s+/)) {
    const clean = word.replace(/[.,;:|©]+$/, '');
    if (!/^[A-Z0-9][\w&'-]*$/.test(clean)) break;
    words.push(clean);
    if (words.length === 4 || clean !== word) break;
  }
  return words.length ? words.join(' ') : null;
}

const NOT_ORDERING_PROVIDERS = new Set([
  'wordpress',
  'wix',
  'squarespace',
  'shopify',
  'webflow',
  'joomla',
  'drupal',
  'godaddy',
  'weebly',
  'jimdo',
  'duda',
  'framer',
  'google',
  'cloudflare',
  'stripe',
  'paypal',
]);

const CACHE_MS = 30_000;

@Injectable()
export class ProviderDetectionService {
  private readonly logger = new Logger(ProviderDetectionService.name);
  private cache?: { at: number; policies: PolicyLean[] };

  constructor(
    @InjectModel(ProviderPolicy.name) private readonly model: Model<ProviderPolicyDocument>,
    @Inject(CNAME_RESOLVER) private readonly resolveCname: CnameResolver,
  ) {}

  // Before any request to the site: hostname suffix and CNAME chain only.
  async detectBeforeFetch(hostname: string): Promise<ProviderMatch | null> {
    const policies = await this.policies();
    for (const policy of policies) {
      const suffix = policy.detection?.hostSuffixes?.find((s) => hostMatchesDomain(hostname, s));
      const found = suffix && (await this.match(policy, [`host suffix ${suffix}`]));
      if (found) return found;
    }
    const chain = await this.cnameChain(hostname);
    for (const policy of policies) {
      for (const target of chain) {
        const suffix = policy.detection?.cnameSuffixes?.find((s) => hostMatchesDomain(target, s));
        const found = suffix && (await this.match(policy, [`CNAME ${target}`]));
        if (found) return found;
      }
    }
    return null;
  }

  // From the homepage: generator meta, footer attribution and asset hosts. Unrecognised ordering
  // platforms are recorded as "unknown" policies so an admin can review them.
  async detectFromPage($: CheerioAPI): Promise<ProviderMatch | null> {
    const policies = await this.policies();
    const generators = $('meta[name="generator" i]')
      .map((_, el) => ($(el).attr('content') ?? '').toLowerCase())
      .get();
    const footerText = this.footerText($);
    const footerLower = footerText.toLowerCase();
    const assetHosts = this.assetHosts($);

    for (const policy of policies) {
      const signals: string[] = [];
      const detection = policy.detection ?? ({} as ProviderPolicy['detection']);
      for (const pattern of detection.generatorPatterns ?? []) {
        if (pattern && generators.some((g) => g.includes(pattern.toLowerCase()))) signals.push(`generator "${pattern}"`);
      }
      for (const pattern of detection.footerPatterns ?? []) {
        if (pattern && footerLower.includes(pattern.toLowerCase())) signals.push(`footer "${pattern}"`);
      }
      for (const host of detection.assetHosts ?? []) {
        if (host && assetHosts.some((h) => hostMatchesDomain(h, host))) signals.push(`assets from ${host}`);
      }
      const found = signals.length > 0 && (await this.match(policy, signals));
      if (found) return found;
    }

    const name = this.orderingAttribution(footerText);
    if (!name) return null;
    const policy = await this.recordUnknownProvider(name);
    return this.match(policy, [`footer attribution "${name}"`]);
  }

  invalidate() {
    this.cache = undefined;
  }

  /**
   * Detection patterns come from a cache up to 30s old, but the decision uses the policy as it is now. The API
   * and worker are separate processes, so without this a run started just after an admin allowed a provider
   * would still see "unknown" and hold the website again, undoing the admin's decision.
   */
  private async match(policy: PolicyLean, signals: string[]): Promise<ProviderMatch | null> {
    const current = await this.model.findById(policy._id).select('name status').lean<Pick<PolicyLean, '_id' | 'name' | 'status'>>();
    if (!current) {
      this.invalidate();
      return null;
    }
    return { policyId: current._id, name: current.name, status: current.status, signals };
  }

  private async policies(): Promise<PolicyLean[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.policies;
    const policies = await this.model.find().lean<PolicyLean[]>();
    this.cache = { at: Date.now(), policies };
    return policies;
  }

  private async cnameChain(hostname: string): Promise<string[]> {
    const chain: string[] = [];
    let current = hostname;
    for (let i = 0; i < 3; i++) {
      const [next] = await this.resolveCname(current);
      if (!next || chain.includes(next)) break;
      chain.push(next.toLowerCase());
      current = next;
    }
    return chain;
  }

  private footerText($: CheerioAPI): string {
    const footer = $('footer, [class*="footer" i], [id*="footer" i]').text();
    const text = footer || $('body').text().slice(-2000);
    return text.replace(/\s+/g, ' ').trim();
  }

  private assetHosts($: CheerioAPI): string[] {
    const hosts = new Set<string>();
    $('script[src], link[href], img[src]').each((_, el) => {
      const raw = $(el).attr('src') ?? $(el).attr('href');
      if (!raw || !/^(https?:)?\/\//i.test(raw)) return;
      try {
        hosts.add(new URL(raw, 'https://placeholder.invalid').hostname.toLowerCase());
      } catch {
        // ignore malformed asset URLs
      }
    });
    return [...hosts];
  }

  private orderingAttribution(text: string): string | null {
    for (const pattern of ORDERING_ATTRIBUTION) {
      const capture = pattern.exec(text)?.[1];
      const name = capture ? leadingName(capture) : null;
      if (name && !NOT_ORDERING_PROVIDERS.has(name.toLowerCase().split(/\s+/)[0])) return name;
    }
    return null;
  }

  private async recordUnknownProvider(name: string): Promise<PolicyLean> {
    const existing = await this.model.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean<PolicyLean>();
    if (existing) return existing;
    this.logger.log(`Recording unrecognised ordering provider "${name}" for admin review`);
    const created = await this.model.findOneAndUpdate(
      { name },
      {
        $setOnInsert: {
          name,
          status: ProviderPolicyStatus.UNKNOWN,
          autoCreated: true,
          detection: { footerPatterns: [name], hostSuffixes: [], cnameSuffixes: [], generatorPatterns: [], assetHosts: [] },
        },
      },
      { upsert: true, new: true },
    );
    this.invalidate();
    return created.toObject() as PolicyLean;
  }
}
