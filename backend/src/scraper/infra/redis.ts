import { Inject, Injectable, OnApplicationShutdown, Provider } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';
import { REDIS_CLIENT } from '../scraper.tokens';

export function redisUrl(): string {
  return process.env.REDIS_URL || 'redis://localhost:6379';
}

export function createRedis(options: RedisOptions = {}): Redis {
  return new Redis(redisUrl(), { maxRetriesPerRequest: 3, ...options });
}

// BullMQ workers need blocking connections that never give up on a request.
export function bullConnectionOptions() {
  const url = new URL(redisUrl());
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}

export const redisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: () => createRedis(),
};

@Injectable()
export class RedisShutdown implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
