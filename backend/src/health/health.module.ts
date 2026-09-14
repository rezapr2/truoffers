import { Controller, Get, Inject, Module } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type Redis from 'ioredis';
import { Connection } from 'mongoose';
import { Public } from '../common/decorators';
import { WORKER_HEARTBEAT_PREFIX } from '../scraper/queue/queue.constants';
import { ScraperCoreModule } from '../scraper/scraper-core.module';
import { REDIS_CLIENT } from '../scraper/scraper.tokens';

const PROBE_TIMEOUT_MS = 1_000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS).unref()),
  ]);
}

@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // The API's own health depends only on MongoDB: a Redis or worker outage stops the scraper, not the site.
  @Public()
  @Get()
  async check() {
    const dbState = this.connection.readyState; // 1 = connected
    const redis = await withTimeout(this.redis.ping())
      .then(() => 'connected')
      .catch(() => 'unavailable');
    const workers =
      redis === 'connected'
        ? await withTimeout(this.redis.keys(`${WORKER_HEARTBEAT_PREFIX}*`))
            .then((keys) => keys.length)
            .catch(() => 0)
        : 0;
    return {
      status: dbState === 1 ? 'ok' : 'degraded',
      db: dbState === 1 ? 'connected' : `state:${dbState}`,
      redis,
      worker: workers > 0 ? 'running' : 'not_running',
      workers,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}

@Module({ imports: [ScraperCoreModule], controllers: [HealthController] })
export class HealthModule {}
