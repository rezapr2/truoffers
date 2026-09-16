import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Worker } from 'bullmq';
import type Redis from 'ioredis';
import { hostname } from 'node:os';
import { bullConnectionOptions } from '../infra/redis';
import { REDIS_CLIENT } from '../scraper.tokens';
import {
  isRenderWorker,
  QUEUE_CONCURRENCY,
  queuesForRole,
  RENDER_WORKER_HEARTBEAT_PREFIX,
  StageJobData,
  WORKER_HEARTBEAT_PREFIX,
  WORKER_HEARTBEAT_TTL_SECONDS,
} from './queue.constants';
import { ScraperControlService } from './scraper-control.service';
import { StageRunner } from './stage-runner.service';

export function heartbeatKey(host = hostname(), pid = process.pid, render = isRenderWorker()) {
  return `${render ? RENDER_WORKER_HEARTBEAT_PREFIX : WORKER_HEARTBEAT_PREFIX}${host}:${pid}`;
}

// Consumes the scraper queues. Only the worker process includes this provider.
@Injectable()
export class ScraperWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ScraperWorkerService.name);
  private readonly workers: Worker<StageJobData>[] = [];
  private heartbeat?: NodeJS.Timeout;

  constructor(
    private readonly runner: StageRunner,
    private readonly control: ScraperControlService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async onApplicationBootstrap() {
    // Emergency stop and cancellation reach in-flight requests immediately, not just at the next checkpoint.
    await this.control.subscribe((message) => {
      if (message.type === 'halt') this.runner.abortAll();
      if (message.type === 'cancel_run') this.runner.abortRun(message.runId);
    });
    const queues = queuesForRole();
    for (const name of queues) {
      const worker = new Worker<StageJobData>(name, (job, token) => this.runner.process(job, token), {
        connection: bullConnectionOptions(),
        concurrency: QUEUE_CONCURRENCY[name],
      });
      worker.on('error', (err) => this.logger.error(`Worker error on ${name}: ${err.message}`));
      this.workers.push(worker);
    }
    await this.beat();
    this.heartbeat = setInterval(() => void this.beat(), 10_000);
    this.logger.log(`Consuming ${queues.join(', ')}`);
  }

  private async beat() {
    await this.redis.set(heartbeatKey(), new Date().toISOString(), 'EX', WORKER_HEARTBEAT_TTL_SECONDS).catch((err: Error) => {
      this.logger.warn(`Heartbeat failed: ${err.message}`);
    });
  }

  async onApplicationShutdown() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.runner.abortAll();
    await Promise.all(this.workers.map((w) => w.close()));
    await this.redis.del(heartbeatKey()).catch(() => undefined);
  }
}
