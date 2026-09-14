import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Types } from 'mongoose';
import type { ImportJobDocument } from '../../schemas/import-job.schema';
import { bullConnectionOptions } from '../infra/redis';
import { JOB_RETRY } from '../scraper.constants';
import { QUEUE_FOR_JOB, SCRAPER_QUEUES, StageJobData, WORK_QUEUES } from './queue.constants';
import { ImportJobsService } from './import-jobs.service';

export type QueueCounts = Record<string, { waiting: number; active: number; delayed: number; failed: number; completed: number; paused: number }>;

// Producer side of the scraper queues, shared by the API and the worker.
@Injectable()
export class ScraperQueueService implements OnApplicationShutdown {
  private readonly queues = new Map<string, Queue<StageJobData>>();
  private deadLetter?: Queue;

  constructor(private readonly jobs: ImportJobsService) {}

  queue(name: string): Queue<StageJobData> {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue<StageJobData>(name, { connection: bullConnectionOptions() });
      this.queues.set(name, queue);
    }
    return queue;
  }

  private deadLetterQueue(): Queue {
    this.deadLetter ??= new Queue(SCRAPER_QUEUES.deadLetter, { connection: bullConnectionOptions() });
    return this.deadLetter;
  }

  async enqueue(job: ImportJobDocument, options: { delayMs?: number } = {}): Promise<void> {
    const queueName = QUEUE_FOR_JOB[job.type];
    const bullJobId = `${String(job._id)}-${job.attempts ?? 0}-${Date.now()}`;
    await this.queue(queueName).add(
      job.type,
      { importJobId: String(job._id), runId: String(job.runId) },
      {
        jobId: bullJobId,
        attempts: JOB_RETRY.attempts,
        backoff: { type: 'exponential', delay: JOB_RETRY.backoffMs },
        delay: options.delayMs,
        removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
      },
    );
    await this.jobs.attachQueue(job._id, queueName, bullJobId);
  }

  async deadLetterJob(job: ImportJobDocument, reason: string): Promise<void> {
    await this.deadLetterQueue().add(
      'dead_letter',
      { importJobId: String(job._id), runId: String(job.runId), type: job.type, reason, at: new Date().toISOString() },
      { removeOnComplete: false, removeOnFail: false },
    );
  }

  async pauseAll(): Promise<void> {
    await Promise.all(WORK_QUEUES.map((name) => this.queue(name).pause()));
  }

  async resumeAll(): Promise<void> {
    await Promise.all(WORK_QUEUES.map((name) => this.queue(name).resume()));
  }

  async isPaused(): Promise<boolean> {
    const states = await Promise.all(WORK_QUEUES.map((name) => this.queue(name).isPaused()));
    return states.some(Boolean);
  }

  async counts(): Promise<QueueCounts> {
    const result: QueueCounts = {};
    for (const name of [...WORK_QUEUES, SCRAPER_QUEUES.deadLetter]) {
      const queue = name === SCRAPER_QUEUES.deadLetter ? this.deadLetterQueue() : this.queue(name);
      const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed', 'paused');
      result[name] = {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
        completed: counts.completed ?? 0,
        paused: counts.paused ?? 0,
      };
    }
    return result;
  }

  // Waiting and delayed jobs of a cancelled run are removed; running ones stop at their next checkpoint.
  async removePending(runId: Types.ObjectId): Promise<number> {
    let removed = 0;
    for (const name of WORK_QUEUES) {
      const jobs = await this.queue(name).getJobs(['waiting', 'delayed', 'paused', 'prioritized']);
      for (const job of jobs) {
        if (job?.data?.runId === String(runId)) {
          await job.remove().catch(() => undefined);
          removed++;
        }
      }
    }
    return removed;
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    await this.deadLetter?.close();
  }
}
