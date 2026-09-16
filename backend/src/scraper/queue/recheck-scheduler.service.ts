import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { ImportJobType } from '../../common/scraper.enums';
import { bullConnectionOptions } from '../infra/redis';
import { RecheckService } from '../lifecycle/recheck.service';
import { RECHECK } from '../scraper.constants';
import { isRenderWorker, SCHEDULE_JOBS, SCRAPER_QUEUES } from './queue.constants';
import { RunsService } from './runs.service';
import { ScraperControlService } from './scraper-control.service';

/**
 * Spec §10 rechecks without a person pressing a button. Two repeatable BullMQ ticks (so several workers never
 * double up): every 5 minutes, start runs for websites whose check is due; every hour, queue review_stale_offer
 * when an imported offer has passed its end date. Nothing is scheduled while the emergency stop is active.
 */
@Injectable()
export class RecheckSchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RecheckSchedulerService.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly recheck: RecheckService,
    private readonly runs: RunsService,
    private readonly control: ScraperControlService,
  ) {}

  async onApplicationBootstrap() {
    if (isRenderWorker()) return;
    this.queue = new Queue(SCRAPER_QUEUES.schedule, { connection: bullConnectionOptions() });
    this.queue.on('error', (err) => this.logger.warn(`Queue ${SCRAPER_QUEUES.schedule}: ${err.message}`));
    const opts = { removeOnComplete: { count: 50 }, removeOnFail: { count: 200 } };
    await this.queue.upsertJobScheduler(SCHEDULE_JOBS.rechecks, { every: RECHECK.schedulerEveryMs }, { name: SCHEDULE_JOBS.rechecks, opts });
    await this.queue.upsertJobScheduler(SCHEDULE_JOBS.staleOffers, { every: RECHECK.staleReviewEveryMs }, { name: SCHEDULE_JOBS.staleOffers, opts });
    this.worker = new Worker(SCRAPER_QUEUES.schedule, (job) => this.tick(job.name), { connection: bullConnectionOptions(), concurrency: 1 });
    this.worker.on('error', (err) => this.logger.error(`Scheduler error: ${err.message}`));
  }

  async tick(name: string): Promise<Record<string, number | boolean>> {
    if (await this.control.isHalted()) return { skipped: true };
    if (name === SCHEDULE_JOBS.rechecks) return this.startDueChecks();
    if (name === SCHEDULE_JOBS.staleOffers) return this.queueStaleOfferReview();
    return { skipped: true };
  }

  async startDueChecks(now = new Date()) {
    const due = await this.recheck.dueWebsites(now, RECHECK.schedulerBatch);
    let started = 0;
    for (const site of due) {
      const { created } = await this.runs.startRun(site);
      if (created) started++;
      // Pushed back provisionally so a cancelled or lost run is retried later, not on every tick; a run that
      // completes or fails sets the real next check.
      await this.recheck.markScheduled(site._id, now);
    }
    if (started) this.logger.log(`Started ${started} scheduled check(s)`);
    return { due: due.length, started };
  }

  async queueStaleOfferReview(now = new Date()) {
    if ((await this.recheck.staleWork(now)) === 0) return { queued: false };
    const { created } = await this.runs.startJob({
      type: ImportJobType.REVIEW_STALE_OFFER,
      key: ImportJobType.REVIEW_STALE_OFFER,
      label: 'imported offers',
      payload: {},
    });
    return { queued: created };
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    await this.queue?.close();
  }
}
