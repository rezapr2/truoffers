import { ImportJobType } from '../../common/scraper.enums';

export const SCRAPER_QUEUES = {
  fetch: 'scraper-fetch',
  process: 'scraper-process',
  deadLetter: 'scraper-dead-letter',
  // Chromium rendering, consumed only by a render worker (its image carries the browser).
  render: 'scraper-render',
  // Repeatable maintenance ticks (recheck scheduling, stale offer review); they start ImportJobs, never fetch.
  schedule: 'scraper-schedule',
} as const;

export const WORK_QUEUES = [SCRAPER_QUEUES.fetch, SCRAPER_QUEUES.process] as const;

// Every queue that carries run stages: what the emergency stop pauses and cancellation clears.
export const STAGE_QUEUES = [...WORK_QUEUES, SCRAPER_QUEUES.render] as const;

// Network-bound stages share one queue (and the per-domain rate limiter); database-only stages another.
export const QUEUE_FOR_JOB: Record<ImportJobType, string> = {
  [ImportJobType.ANALYSE_SEED_WEBSITE]: SCRAPER_QUEUES.fetch,
  [ImportJobType.DISCOVER_OFFER_PAGES]: SCRAPER_QUEUES.fetch,
  [ImportJobType.EXTRACT_BUSINESS]: SCRAPER_QUEUES.fetch,
  [ImportJobType.EXTRACT_OFFERS]: SCRAPER_QUEUES.fetch,
  [ImportJobType.MATCH_BUSINESS]: SCRAPER_QUEUES.process,
  [ImportJobType.DEDUPLICATE_OFFERS]: SCRAPER_QUEUES.process,
  [ImportJobType.DISCOVER_AUTHORISED_DOMAINS]: SCRAPER_QUEUES.fetch,
  [ImportJobType.CREATE_FINGERPRINT]: SCRAPER_QUEUES.fetch,
  [ImportJobType.MATCH_FINGERPRINT]: SCRAPER_QUEUES.fetch,
  [ImportJobType.TEST_ADAPTER]: SCRAPER_QUEUES.fetch,
  [ImportJobType.RECHECK_OFFER]: SCRAPER_QUEUES.process,
  [ImportJobType.REVIEW_STALE_OFFER]: SCRAPER_QUEUES.process,
  [ImportJobType.RENDER_PAGES]: SCRAPER_QUEUES.render,
};

export const SCHEDULE_JOBS = {
  rechecks: 'schedule_rechecks',
  staleOffers: 'schedule_stale_offer_review',
} as const;

export const QUEUE_CONCURRENCY: Record<string, number> = {
  [SCRAPER_QUEUES.fetch]: 4,
  [SCRAPER_QUEUES.process]: 4,
  // One render at a time per worker, each using at most two browser contexts.
  [SCRAPER_QUEUES.render]: 1,
};

// A worker consumes either the crawling queues or the render queue, never both: only the render image
// carries Chromium. SCRAPER_QUEUE_ROLE=render selects the second.
export function queuesForRole(role = process.env.SCRAPER_QUEUE_ROLE): string[] {
  return role === 'render' ? [SCRAPER_QUEUES.render] : [...WORK_QUEUES];
}

export const isRenderWorker = (role = process.env.SCRAPER_QUEUE_ROLE) => role === 'render';

export interface StageJobData {
  importJobId: string;
  runId: string;
}

export const WORKER_HEARTBEAT_PREFIX = 'scraper:worker:';
export const RENDER_WORKER_HEARTBEAT_PREFIX = 'scraper:render-worker:';
export const WORKER_HEARTBEAT_TTL_SECONDS = 30;
