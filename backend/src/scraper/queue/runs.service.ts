import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditAction, ImportJobType } from '../../common/scraper.enums';
import type { ImportJobDocument } from '../../schemas/import-job.schema';
import { ScrapedWebsite, ScrapedWebsiteDocument } from '../../schemas/scraped-website.schema';
import { AuditService } from '../audit/audit.service';
import type { ScrapedWebsiteLean } from '../safety/domain-registry.service';
import { normaliseUrl } from '../safety/url';
import { ImportJobsService } from './import-jobs.service';
import { ScraperControlService } from './scraper-control.service';
import { ScraperQueueService } from './scraper-queue.service';

// Starting, cancelling, retrying and halting runs. Used by the admin API; never fetches anything itself.
@Injectable()
export class RunsService {
  constructor(
    @InjectModel(ScrapedWebsite.name) private readonly sites: Model<ScrapedWebsiteDocument>,
    private readonly jobs: ImportJobsService,
    private readonly queue: ScraperQueueService,
    private readonly control: ScraperControlService,
    private readonly audit: AuditService,
  ) {}

  async startRun(site: Pick<ScrapedWebsiteLean, '_id' | 'domain' | 'seedUrl'>, options: { submittedBy?: string; batchId?: string } = {}) {
    const active = await this.jobs.activeForSite(site._id);
    if (active) return { job: active, created: false };
    const { job, created } = await this.jobs.createRun({
      type: ImportJobType.ANALYSE_SEED_WEBSITE,
      normalisedUrl: normaliseUrl(site.seedUrl),
      domain: site.domain,
      scrapedWebsiteId: site._id,
      submittedBy: options.submittedBy,
      batchId: options.batchId,
    });
    if (created) {
      await this.queue.enqueue(job);
      await this.sites.updateOne({ _id: site._id }, { $set: { lastRunRef: job.runId } });
    }
    return { job, created };
  }

  async cancelRun(runId: string, userId?: string): Promise<{ cancelled: number; removed: number }> {
    const id = new Types.ObjectId(runId);
    await this.control.cancelRun(runId);
    const cancelled = await this.jobs.cancelRun(id, userId, 'Cancelled by an admin');
    const removed = await this.queue.removePending(id);
    await this.audit.record({ action: AuditAction.RUN_CANCELLED, targetType: 'ImportRun', targetId: runId, after: { stagesCancelled: cancelled.length } });
    return { cancelled: cancelled.length, removed };
  }

  async retry(jobId: string): Promise<ImportJobDocument> {
    const job = await this.jobs.get(jobId);
    if (!job) throw new NotFoundException('Job not found');
    const reset = await this.jobs.resetForRetry(job);
    if (!reset) throw new NotFoundException('This job is not in a retryable state, or the same stage is already active');
    await this.queue.enqueue(reset);
    await this.audit.record({ action: AuditAction.JOB_RETRIED, targetType: 'ImportJob', targetId: jobId, before: { status: job.status } });
    return reset;
  }

  // Pauses every queue, raises the halt flag checked by workers, and aborts in-flight requests.
  async emergencyStop(): Promise<void> {
    await this.control.halt();
    await this.queue.pauseAll();
    await this.audit.record({ action: AuditAction.EMERGENCY_STOP, targetType: 'ScraperQueues' });
  }

  async resume(): Promise<void> {
    await this.control.resume();
    await this.queue.resumeAll();
    await this.audit.record({ action: AuditAction.QUEUE_RESUMED, targetType: 'ScraperQueues' });
  }
}
