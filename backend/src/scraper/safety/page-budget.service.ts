import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../scraper.tokens';

// Adds the page to the run's set unless that would exceed the cap. Re-visiting a counted page is free.
const CONSUME = `
local added = redis.call('SADD', KEYS[1], ARGV[1])
if added == 0 then return 1 end
if redis.call('SCARD', KEYS[1]) > tonumber(ARGV[2]) then
  redis.call('SREM', KEYS[1], ARGV[1])
  return 0
end
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
`;

const BUDGET_TTL_MS = 24 * 60 * 60 * 1000;

type RedisWithBudget = Redis & { scraperConsumePage(key: string, page: string, cap: number, ttl: number): Promise<number> };

// Per-run, per-domain cap on unique pages (spec default: 50 pages per job).
@Injectable()
export class PageBudget {
  private readonly redis: RedisWithBudget;

  constructor(@Inject(REDIS_CLIENT) redis: Redis) {
    if (!('scraperConsumePage' in redis)) {
      redis.defineCommand('scraperConsumePage', { numberOfKeys: 1, lua: CONSUME });
    }
    this.redis = redis as RedisWithBudget;
  }

  private key(runId: string, domain: string) {
    return `scraper:pages:${runId}:${domain}`;
  }

  async consume(runId: string, domain: string, pageKey: string, cap: number): Promise<boolean> {
    return (await this.redis.scraperConsumePage(this.key(runId, domain), pageKey, cap, BUDGET_TTL_MS)) === 1;
  }

  async used(runId: string, domain: string): Promise<number> {
    return this.redis.scard(this.key(runId, domain));
  }
}
