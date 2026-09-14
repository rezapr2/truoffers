import type Redis from 'ioredis';
import { ControlMessage, JobStoppedError, ScraperControlService } from '../../../src/scraper/queue/scraper-control.service';
import { PageBudget } from '../../../src/scraper/safety/page-budget.service';
import { DomainRateLimiter, RateLimitDelayError } from '../../../src/scraper/safety/rate-limiter.service';
import { createTestRedis } from '../../helpers/redis';

describe('Redis-backed crawl controls', () => {
  let redis: Redis;

  beforeAll(() => {
    redis = createTestRedis();
  });
  afterAll(() => redis.quit());
  beforeEach(() => redis.flushdb());

  describe('per-domain rate limiter', () => {
    it('grants one slot per interval per domain', async () => {
      const limiter = new DomainRateLimiter(redis);
      const key = DomainRateLimiter.key('pizza-palace.test');
      expect(await limiter.tryAcquire(key, 2_000)).toBe(0);
      const wait = await limiter.tryAcquire(key, 2_000);
      expect(wait).toBeGreaterThan(1_900);
      expect(wait).toBeLessThanOrEqual(2_000);
      expect(await limiter.tryAcquire(DomainRateLimiter.key('curry-house.test'), 2_000)).toBe(0);
    });

    it('keeps concurrent jobs on the same domain spaced apart', async () => {
      const key = DomainRateLimiter.key('shared.test');
      const workers = [new DomainRateLimiter(redis), new DomainRateLimiter(createTestRedis())];
      const grantedAt: number[] = [];
      await Promise.all(
        workers.flatMap((limiter) =>
          [0, 1].map(async () => {
            await limiter.acquire(key, 300, { inlineMaxMs: 5_000 });
            grantedAt.push(Date.now());
          }),
        ),
      );
      grantedAt.sort((a, b) => a - b);
      for (let i = 1; i < grantedAt.length; i++) {
        expect(grantedAt[i] - grantedAt[i - 1]).toBeGreaterThanOrEqual(280);
      }
      await (workers[1] as any).redis.quit();
    });

    it('hands long waits back to the job instead of blocking the worker', async () => {
      const limiter = new DomainRateLimiter(redis);
      const key = DomainRateLimiter.key('slow.test');
      await limiter.acquire(key, 10_000);
      const started = Date.now();
      const error = await limiter.acquire(key, 10_000, { inlineMaxMs: 2_000 }).catch((e) => e);
      expect(error).toBeInstanceOf(RateLimitDelayError);
      expect(error.delayMs).toBeGreaterThan(9_000);
      expect(Date.now() - started).toBeLessThan(200);
    });
  });

  describe('page budget', () => {
    it('caps unique pages per run and domain; revisits are free', async () => {
      const budget = new PageBudget(redis);
      const run = 'run-1';
      expect(await budget.consume(run, 'a.test', 'https://a.test/1', 2)).toBe(true);
      expect(await budget.consume(run, 'a.test', 'https://a.test/2', 2)).toBe(true);
      expect(await budget.consume(run, 'a.test', 'https://a.test/3', 2)).toBe(false);
      expect(await budget.consume(run, 'a.test', 'https://a.test/1', 2)).toBe(true);
      expect(await budget.consume('run-2', 'a.test', 'https://a.test/3', 2)).toBe(true);
      expect(await budget.used(run, 'a.test')).toBe(2);
    });
  });

  describe('emergency stop and cancellation', () => {
    it('raises at the next checkpoint', async () => {
      const control = new ScraperControlService(redis);
      await expect(control.checkpoint('run-a')).resolves.toBeUndefined();

      await control.cancelRun('run-a');
      await expect(control.checkpoint('run-a')).rejects.toMatchObject({ reason: 'cancelled' });
      await expect(control.checkpoint('run-b')).resolves.toBeUndefined();

      await control.halt();
      await expect(control.checkpoint('run-b')).rejects.toBeInstanceOf(JobStoppedError);
      expect(await control.isHalted()).toBe(true);
      await control.resume();
      expect(await control.isHalted()).toBe(false);
    });

    it('broadcasts control messages so workers can abort in-flight requests', async () => {
      const worker = new ScraperControlService(createTestRedis());
      const admin = new ScraperControlService(redis);
      const received: ControlMessage[] = [];
      await worker.subscribe((m) => received.push(m));

      await admin.halt();
      await admin.cancelRun('run-z');
      await new Promise((r) => setTimeout(r, 100));

      expect(received).toEqual([{ type: 'halt' }, { type: 'cancel_run', runId: 'run-z' }]);
      await worker.onApplicationShutdown();
      await (worker as any).redis.quit();
    });
  });
});
