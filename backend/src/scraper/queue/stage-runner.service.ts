import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DelayedError, Job, UnrecoverableError } from 'bullmq';
import { Model } from 'mongoose';
import { ImportJobStatus } from '../../common/scraper.enums';
import { OfferLifecycleViolation } from '../../schemas/offer-lifecycle.guard';
import type { ImportJobDocument } from '../../schemas/import-job.schema';
import { ScrapedWebsite, ScrapedWebsiteDocument } from '../../schemas/scraped-website.schema';
import { NoAdapterAvailableError } from '../extraction/adapter-registry.service';
import { NetworkJobsService } from '../pipeline/network-jobs.service';
import { PipelineService, StageAbortedError, StageContext, StageOutcome } from '../pipeline/pipeline.service';
import { CrawlDeniedError, PARKING_DENIALS } from '../safety/crawl-gate.service';
import { FetchAbortedError, FetchDeniedError, FetchFailedError } from '../safety/errors';
import { RateLimitDelayError } from '../safety/rate-limiter.service';
import { CRAWL_DEFAULTS } from '../scraper.constants';
import { ImportJobsService } from './import-jobs.service';
import type { StageJobData } from './queue.constants';
import { JobStoppedError, ScraperControlService } from './scraper-control.service';
import { ScraperQueueService } from './scraper-queue.service';

const HALT_RECHECK_MS = 60_000;
const MAX_RETRY_AFTER_MS = 60 * 60 * 1000;
const FINISHED = [ImportJobStatus.COMPLETED, ImportJobStatus.CANCELLED, ImportJobStatus.FAILED, ImportJobStatus.DEAD_LETTERED];

function isRetryable(err: Error): boolean {
  if (err instanceof FetchFailedError) return err.retryable;
  if (
    err instanceof FetchDeniedError ||
    err instanceof StageAbortedError ||
    err instanceof NoAdapterAvailableError ||
    err instanceof OfferLifecycleViolation
  ) {
    return false;
  }
  return true;
}

/**
 * Runs one pipeline stage for BullMQ. Rate limits, pauses and Retry-After make the job delay itself
 * (freeing the worker); cancellation and emergency stop are cooperative; policy denials fail once;
 * transient failures retry with backoff and are dead-lettered when attempts run out.
 */
@Injectable()
export class StageRunner {
  private readonly logger = new Logger(StageRunner.name);
  private readonly active = new Map<string, Set<AbortController>>();

  constructor(
    private readonly jobs: ImportJobsService,
    private readonly queue: ScraperQueueService,
    private readonly pipeline: PipelineService,
    private readonly networkJobs: NetworkJobsService,
    private readonly control: ScraperControlService,
    @InjectModel(ScrapedWebsite.name) private readonly sites: Model<ScrapedWebsiteDocument>,
  ) {}

  abortAll(): void {
    for (const controllers of this.active.values()) controllers.forEach((c) => c.abort());
  }

  abortRun(runId: string): void {
    this.active.get(runId)?.forEach((c) => c.abort());
  }

  activeRuns(): number {
    return this.active.size;
  }

  async process(job: Job<StageJobData>, token?: string): Promise<void> {
    const importJob = await this.jobs.get(job.data.importJobId);
    if (!importJob || FINISHED.includes(importJob.status)) return;
    const runId = String(importJob.runId);

    const state = await this.control.state(runId);
    if (state.cancelled) {
      await this.jobs.cancelRun(importJob.runId, undefined, 'Cancelled');
      return;
    }
    if (state.halted) await this.delay(job, token, importJob, HALT_RECHECK_MS, 'Emergency stop is active');

    const controller = new AbortController();
    this.track(runId, controller);
    const attempt = job.attemptsMade + 1;
    try {
      await this.jobs.markRunning(importJob._id, attempt);
      const running = (await this.jobs.get(importJob._id))!;
      const ctx: StageContext = {
        job: running,
        signal: controller.signal,
        log: (message, data, level = 'info') => this.jobs.log(importJob._id, level, message, data),
        progress: async (current, total, message) => {
          await this.jobs.progress(importJob._id, current, total, message);
          await job.updateProgress({ current, total });
        },
        checkpoint: (partial) => this.jobs.checkpoint(importJob._id, partial),
      };
      const outcome = this.networkJobs.handles(importJob.type)
        ? await this.networkJobs.run(importJob.type, ctx)
        : await this.pipeline.run(importJob.type, ctx);
      await this.finish(running, outcome);
    } catch (err) {
      await this.handleError(job, token, importJob, err as Error, controller);
    } finally {
      this.untrack(runId, controller);
    }
  }

  private track(runId: string, controller: AbortController) {
    const set = this.active.get(runId) ?? new Set<AbortController>();
    set.add(controller);
    this.active.set(runId, set);
  }

  private untrack(runId: string, controller: AbortController) {
    const set = this.active.get(runId);
    set?.delete(controller);
    if (set && set.size === 0) this.active.delete(runId);
  }

  private async delay(job: Job<StageJobData>, token: string | undefined, importJob: ImportJobDocument, ms: number, reason: string): Promise<never> {
    const until = new Date(Date.now() + ms);
    await this.jobs.markDelayed(importJob._id, until, reason);
    await job.moveToDelayed(until.getTime(), token);
    throw new DelayedError();
  }

  private async finish(job: ImportJobDocument, outcome: StageOutcome) {
    if (outcome.held) {
      await this.jobs.complete(job, undefined, { ...(outcome.resultCounts ?? {}), held: 1 });
      await this.jobs.log(job._id, 'warn', outcome.held);
      await this.jobs.clearRunOutputs(job.runId);
      return;
    }
    await this.jobs.complete(job, outcome.output, outcome.resultCounts);
    if (!outcome.next) {
      await this.jobs.clearRunOutputs(job.runId);
      await this.jobs.log(job._id, 'info', 'Run complete');
      return;
    }
    if ((await this.control.state(String(job.runId))).cancelled) return;
    const next = await this.jobs.createStage(job, outcome.next);
    if (!next) {
      await this.jobs.log(job._id, 'warn', `Could not queue ${outcome.next}: the same stage is already active for this website`);
      return;
    }
    await this.queue.enqueue(next);
  }

  private async handleError(job: Job<StageJobData>, token: string | undefined, importJob: ImportJobDocument, err: Error, controller: AbortController) {
    if (err instanceof DelayedError) throw err;
    if (err instanceof RateLimitDelayError) {
      return this.delay(job, token, importJob, err.delayMs + Math.floor(Math.random() * 250), 'Waiting for the per-domain rate limit');
    }
    if (err instanceof CrawlDeniedError && PARKING_DENIALS.has(err.denial)) {
      return this.delay(job, token, importJob, CRAWL_DEFAULTS.pausedRecheckMs, err.message);
    }
    if (err instanceof FetchFailedError && (err.status === 429 || err.status === 503) && err.retryAfterMs !== undefined) {
      return this.delay(job, token, importJob, Math.min(Math.max(err.retryAfterMs, 1_000), MAX_RETRY_AFTER_MS), `The site asked us to wait (HTTP ${err.status})`);
    }
    if (err instanceof JobStoppedError || err instanceof FetchAbortedError || controller.signal.aborted) {
      const state = await this.control.state(String(importJob.runId));
      if (state.cancelled) {
        await this.jobs.cancelRun(importJob.runId, undefined, 'Cancelled');
        await this.queue.removePending(importJob.runId);
        return;
      }
      if (state.halted) return this.delay(job, token, importJob, HALT_RECHECK_MS, 'Emergency stop is active');
    }

    const retryable = isRetryable(err);
    const attempt = job.attemptsMade + 1;
    const final = !retryable || attempt >= (job.opts.attempts ?? 1);
    await this.jobs.fail(importJob, err, { attempt, retryable, final, deadLetter: final && retryable });
    if (!final) throw err;

    this.logger.warn(`${importJob.type} failed for ${importJob.domain}: ${err.message}`);
    await this.sites.updateOne(
      { _id: importJob.scrapedWebsiteRef },
      { $set: { lastFailedCheckAt: new Date(), lastError: err.message }, $inc: { failureCount: 1 } },
    );
    if (retryable) await this.queue.deadLetterJob(importJob, err.message);
    throw new UnrecoverableError(err.message);
  }
}
