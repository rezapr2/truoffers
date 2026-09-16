export const BOT_TOKEN = 'TruOffersBot';

export function botUserAgent(siteUrl = process.env.SITE_URL || 'https://truoffers.co.uk'): string {
  return `${BOT_TOKEN}/1.0 (+${siteUrl.replace(/\/+$/, '')}/bot)`;
}

export const FETCH_LIMITS = {
  connectTimeoutMs: 5_000,
  responseTimeoutMs: 20_000,
  maxResponseBytes: 2 * 1024 * 1024,
  maxDecompressionRatio: 20,
  // Tiny, highly compressible responses legitimately exceed 20:1; only judge the ratio past this size.
  ratioCheckFloorBytes: 64 * 1024,
  maxRedirects: 5,
} as const;

export const ROBOTS_LIMITS = {
  cacheMs: 24 * 60 * 60 * 1000,
  unreachableCacheMs: 60 * 60 * 1000,
  maxBytes: 500 * 1024,
} as const;

export const SITEMAP_LIMITS = {
  maxUrls: 5_000,
  maxBytes: 5 * 1024 * 1024,
  maxIndexDepth: 2,
} as const;

export const CRAWL_DEFAULTS = {
  rateLimitMs: 2_000,
  pageCap: 50,
  // Waits up to this long are awaited inline; longer waits move the job to the delayed set.
  inlineDelayMaxMs: 2_000,
  pausedRecheckMs: 15 * 60 * 1000,
} as const;

export const EVIDENCE_LIMITS = {
  excerptMaxChars: 500,
} as const;

export const INTAKE_LIMITS = {
  csvMaxBytes: 1024 * 1024,
  csvMaxRows: 5_000,
  maxUrlsPerRequest: 500,
  maxBranchesPerSite: 200,
} as const;

export const CONFIDENCE_THRESHOLDS = {
  high: 90,
  reviewRecommended: 70,
  manualInvestigation: 40,
} as const;

export const MATCH_THRESHOLDS = {
  // pg_trgm-equivalent similarity; spec §8.
  nameSimilarity: 0.8,
  // Below this, a business is not worth suggesting to a reviewer.
  suggestionFloor: 0.5,
  // Title-token Jaccard above which two offers are treated as the same offer with changed terms.
  sameOfferTitleSimilarity: 0.6,
} as const;

export const RETENTION = {
  excerptDays: 90,
  runHistoryDays: 180,
  jobLogLines: 500,
} as const;

// Spec §10 recheck defaults. Per-domain (DomainCrawlConfig) and per-adapter (ScraperAdapter) intervals override
// the base interval; the ending-soon rule and error backoff always apply.
export const RECHECK = {
  activeOfferHours: 24,
  endingSoonHours: 6,
  endingSoonWindowHours: 48,
  inactiveHours: 7 * 24,
  errorBackoffHours: [1, 4, 16, 64],
  maxBackoffHours: 7 * 24,
  // Consecutive successful checks without the offer before it goes to admin expiry review.
  absentChecksForExpiryReview: 2,
  schedulerEveryMs: 5 * 60 * 1000,
  schedulerBatch: 25,
  staleReviewEveryMs: 60 * 60 * 1000,
  // A scheduled run that never reports back (cancelled, lost) is tried again after this.
  provisionalHours: 24,
  // Imported offers not successfully checked for this long are listed as stale for admins.
  staleAfterDays: 7,
} as const;

// Template traits and fingerprint match results removed from a website when it opts out.
export const OPTED_OUT_MATCH_FIELDS = {
  siteMarkers: 1,
  markersExtractedAt: 1,
  fingerprintRef: 1,
  matchScore: 1,
  matchCategory: 1,
  fingerprintMatchedAt: 1,
} as const;

export const AI_LIMITS = {
  maxPagesPerRun: 3,
  maxBlockChars: 4_000,
  maxBlocksPerPage: 12,
} as const;

export const JOB_RETRY = {
  attempts: 3,
  backoffMs: 30_000,
} as const;
