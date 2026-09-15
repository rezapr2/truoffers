import { ImportJobType } from '../../common/scraper.enums';

export const SCRAPER_QUEUES = {
  fetch: 'scraper-fetch',
  process: 'scraper-process',
  deadLetter: 'scraper-dead-letter',
} as const;

export const WORK_QUEUES = [SCRAPER_QUEUES.fetch, SCRAPER_QUEUES.process] as const;

// Network-bound stages share one queue (and the per-domain rate limiter); database-only stages another.
export const QUEUE_FOR_JOB: Record<ImportJobType, (typeof WORK_QUEUES)[number]> = {
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
};

export const QUEUE_CONCURRENCY: Record<(typeof WORK_QUEUES)[number], number> = {
  [SCRAPER_QUEUES.fetch]: 4,
  [SCRAPER_QUEUES.process]: 4,
};

export interface StageJobData {
  importJobId: string;
  runId: string;
}

export const WORKER_HEARTBEAT_PREFIX = 'scraper:worker:';
export const WORKER_HEARTBEAT_TTL_SECONDS = 30;
