import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../scraper.tokens';

const HALT_KEY = 'scraper:halt';
const CONTROL_CHANNEL = 'scraper:control';
const CANCEL_TTL_SECONDS = 7 * 24 * 60 * 60;

const cancelKey = (runId: string) => `scraper:cancel:run:${runId}`;

export type ControlMessage = { type: 'halt' } | { type: 'resume' } | { type: 'cancel_run'; runId: string };

export class JobStoppedError extends Error {
  constructor(readonly reason: 'halted' | 'cancelled') {
    super(reason === 'halted' ? 'Emergency stop is active' : 'Run was cancelled');
    this.name = 'JobStoppedError';
  }
}

/**
 * Cooperative cancellation and the emergency-stop flag. BullMQ cannot kill a running job, so workers
 * check these flags between pages and abort in-flight requests when a control message arrives.
 */
@Injectable()
export class ScraperControlService implements OnApplicationShutdown {
  private readonly logger = new Logger(ScraperControlService.name);
  private subscriber?: Redis;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async isHalted(): Promise<boolean> {
    return (await this.redis.exists(HALT_KEY)) === 1;
  }

  async state(runId: string): Promise<{ halted: boolean; cancelled: boolean }> {
    const [halted, cancelled] = await this.redis.mget(HALT_KEY, cancelKey(runId));
    return { halted: halted !== null, cancelled: cancelled !== null };
  }

  async checkpoint(runId: string): Promise<void> {
    const { halted, cancelled } = await this.state(runId);
    if (halted) throw new JobStoppedError('halted');
    if (cancelled) throw new JobStoppedError('cancelled');
  }

  async halt(): Promise<void> {
    await this.redis.set(HALT_KEY, new Date().toISOString());
    await this.publish({ type: 'halt' });
  }

  async resume(): Promise<void> {
    await this.redis.del(HALT_KEY);
    await this.publish({ type: 'resume' });
  }

  async cancelRun(runId: string): Promise<void> {
    await this.redis.set(cancelKey(runId), '1', 'EX', CANCEL_TTL_SECONDS);
    await this.publish({ type: 'cancel_run', runId });
  }

  async subscribe(handler: (message: ControlMessage) => void): Promise<void> {
    if (!this.subscriber) {
      this.subscriber = this.redis.duplicate();
      await this.subscriber.subscribe(CONTROL_CHANNEL);
    }
    this.subscriber.on('message', (channel, raw) => {
      if (channel !== CONTROL_CHANNEL) return;
      try {
        handler(JSON.parse(raw) as ControlMessage);
      } catch (err) {
        this.logger.warn(`Ignoring malformed control message: ${(err as Error).message}`);
      }
    });
  }

  private async publish(message: ControlMessage) {
    await this.redis.publish(CONTROL_CHANNEL, JSON.stringify(message));
  }

  async onApplicationShutdown() {
    await this.subscriber?.quit().catch(() => this.subscriber?.disconnect());
  }
}
