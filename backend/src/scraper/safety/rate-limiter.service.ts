import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { CRAWL_DEFAULTS } from '../scraper.constants';
import { REDIS_CLIENT } from '../scraper.tokens';
import { FetchAbortedError } from './errors';

// One request per interval per key, decided atomically on the Redis server clock so that
// every worker and every job share the same schedule.
const ACQUIRE_SLOT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local interval = tonumber(ARGV[1])
local nextAllowed = tonumber(redis.call('GET', KEYS[1]) or '0')
if nextAllowed <= now then
  redis.call('SET', KEYS[1], now + interval, 'PX', interval * 2 + 1000)
  return 0
end
return nextAllowed - now
`;

// Thrown when the wait is long enough that the job should give its worker slot back and retry later.
export class RateLimitDelayError extends Error {
  constructor(readonly delayMs: number) {
    super(`Rate limited; retry in ${delayMs}ms`);
    this.name = 'RateLimitDelayError';
  }
}

type RedisWithSlot = Redis & { scraperAcquireSlot(key: string, intervalMs: number): Promise<number> };

@Injectable()
export class DomainRateLimiter {
  private readonly redis: RedisWithSlot;

  constructor(@Inject(REDIS_CLIENT) redis: Redis) {
    if (!('scraperAcquireSlot' in redis)) {
      redis.defineCommand('scraperAcquireSlot', { numberOfKeys: 1, lua: ACQUIRE_SLOT });
    }
    this.redis = redis as RedisWithSlot;
  }

  static key(registrableDomain: string): string {
    return `scraper:rate:${registrableDomain}`;
  }

  // Returns 0 when the slot was taken, otherwise how long to wait before trying again.
  async tryAcquire(key: string, intervalMs: number): Promise<number> {
    return Number(await this.redis.scraperAcquireSlot(key, Math.max(1, Math.round(intervalMs))));
  }

  // Waits briefly in-process; anything longer is handed back to the caller to reschedule the job.
  async acquire(
    key: string,
    intervalMs: number,
    options: { signal?: AbortSignal; inlineMaxMs?: number } = {},
  ): Promise<void> {
    const inlineMaxMs = options.inlineMaxMs ?? CRAWL_DEFAULTS.inlineDelayMaxMs;
    for (;;) {
      if (options.signal?.aborted) throw new FetchAbortedError();
      const wait = await this.tryAcquire(key, intervalMs);
      if (wait === 0) return;
      if (wait > inlineMaxMs) throw new RateLimitDelayError(wait);
      await sleep(wait, options.signal);
    }
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new FetchAbortedError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new FetchAbortedError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
