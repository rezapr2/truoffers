import type { CheerioAPI } from 'cheerio';
import type { OfferType, Weekday } from '../../common/scraper.enums';

export interface FieldEvidence {
  sourceUrl: string;
  text: string;
  method: string;
}

export interface OfferSourceRef {
  url: string;
  pageTitle?: string;
  excerpt: string;
  checkedAt: Date;
}

// Spec §6, verbatim.
export interface ExtractedOffer {
  businessRef?: string;
  sources: OfferSourceRef[];
  title: string;
  shortDescription?: string;
  terms?: string;
  offerType: OfferType;
  discountPercentage?: number;
  discountAmount?: number;
  originalPrice?: number;
  promotionalPrice?: number;
  currency: 'GBP';
  promoCode?: string;
  minimumOrder?: number;
  requiredSpend?: number;
  freeItem?: string;
  collectionEligible?: boolean;
  deliveryEligible?: boolean;
  newCustomersOnly?: boolean;
  applicableProducts?: string[];
  eligibleWeekdays?: Weekday[];
  dailyStartTime?: string; // "HH:mm", Europe/London
  dailyEndTime?: string; // "HH:mm", Europe/London
  startDate?: string; // "YYYY-MM-DD", Europe/London, inclusive
  endDate?: string; // "YYYY-MM-DD", Europe/London, inclusive (expires at 23:59:59 local)
  evidence: Record<string, FieldEvidence>;
  extractionMethod: string;
  adapterId: string;
  adapterVersion: string;
  confidenceScore: number;
  contentFingerprint: string;
  lastCheckedAt: Date;
}

// Fields of ExtractedOffer that describe the offer itself and therefore need evidence when populated.
export const EVIDENCED_OFFER_FIELDS = [
  'title',
  'shortDescription',
  'terms',
  'offerType',
  'discountPercentage',
  'discountAmount',
  'originalPrice',
  'promotionalPrice',
  'promoCode',
  'minimumOrder',
  'requiredSpend',
  'freeItem',
  'collectionEligible',
  'deliveryEligible',
  'newCustomersOnly',
  'applicableProducts',
  'eligibleWeekdays',
  'dailyStartTime',
  'dailyEndTime',
  'startDate',
  'endDate',
] as const;
export type EvidencedOfferField = (typeof EVIDENCED_OFFER_FIELDS)[number];

// Pipeline-only annotations carried alongside an extracted offer; never part of the spec interface.
export interface ExtractionSignals {
  structuredData: boolean;
  promotionalLanguage: boolean;
  benefitParsed: boolean;
  termsParsed: boolean;
  promoCodeFound: boolean;
  datesIdentified: boolean;
  aiOnly: boolean;
  stale: boolean;
  sourceLastModified?: Date;
}

export interface OfferExtraction {
  offer: ExtractedOffer;
  signals: ExtractionSignals;
  flags: string[]; // e.g. relative_date, year_inferred, variable_discount
  pageUrl: string;
  branchPath?: string;
}

export type PageRole = 'home' | 'offers' | 'menu' | 'business' | 'branch';

export interface DiscoveredPage {
  url: string;
  roles: PageRole[];
  priority: number;
  source: 'seed' | 'homepage_link' | 'sitemap';
  anchorText?: string;
}

export interface LoadedPage {
  url: string;
  finalUrl: string;
  status: number;
  title?: string;
  html: string;
  $: CheerioAPI;
  nofollow: boolean;
  lastModified?: Date;
  fetchedAt: Date;
}

export interface WebsiteContext {
  site: { id: string; domain: string; homepageUrl: string };
  runId: string;
  checkedAt: Date;
  signal: AbortSignal;
  // Returns null when the page may not be used: gate denial, robots, noindex, page cap, wrong content type.
  loadPage(url: string): Promise<LoadedPage | null>;
  log(message: string, data?: Record<string, unknown>): void;
}

export interface AdapterMatchResult {
  canHandle: boolean;
  score: number;
  reasons: string[];
}

export interface ExtractedBusiness {
  branchPath: string;
  branchLabel?: string;
  name?: string;
  telephone?: string;
  address?: string;
  postcode?: string;
  town?: string;
  website?: string;
  orderUrl?: string;
  sourceUrl: string;
  evidence: Record<string, FieldEvidence>;
}

export interface OfferValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// Spec §5, verbatim.
export interface TakeawayWebsiteAdapter {
  id: string;
  name: string;
  version: string;
  priority: number; // higher wins when several adapters can handle a site
  canHandle(ctx: WebsiteContext): Promise<AdapterMatchResult>;
  discoverPages(ctx: WebsiteContext): Promise<DiscoveredPage[]>;
  extractBusiness(ctx: WebsiteContext): Promise<ExtractedBusiness[]>; // array: multi-branch
  extractOffers(ctx: WebsiteContext, pages: DiscoveredPage[]): Promise<ExtractedOffer[]>;
  validateOffer(offer: ExtractedOffer): Promise<OfferValidationResult>;
}
