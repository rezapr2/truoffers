import type Redis from 'ioredis';
import { createRedis } from '../../src/scraper/infra/redis';

export function createTestRedis(): Redis {
  const url = process.env.REDIS_URL ?? '';
  if (!/\/15$/.test(url)) throw new Error(`Tests must use Redis db 15 (got ${url})`);
  return createRedis();
}
