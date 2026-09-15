import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ACTIVE_IMPORT_JOB_STATUSES, ImportJobStatus, ImportJobType } from '../../common/scraper.enums';
import { ImportJob, ImportJobDocument } from '../../schemas/import-job.schema';
import { RETENTION } from '../scraper.constants';

export type LogLevel = 'info' | 'warn' | 'error';

export interface NewRun {
  type: ImportJobType;
  normalisedUrl: string;
  domain: string;
  scrapedWebsiteId?: Types.ObjectId;
  submittedBy?: string;
  batchId?: string;
  payload?: Record<string, unknown>;
}

function activeKey(type: ImportJobType, normalisedUrl: string) {
  return `${type}|${normalisedUrl}`;
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number })?.code === 11000;
}

/**
 * ImportJob records: one per queued stage, grouped by runId. They hold progress, capped logs, errors
 * and the structured hand-over between stages; BullMQ only holds the id.
 */
@Injectable()
export class ImportJobsService {
  constructor(@InjectModel(ImportJob.name) private readonly model: Model<ImportJobDocument>) {}

  // Returns the existing active job instead when the same stage is already queued or running for the URL.
  async createRun(run: NewRun): Promise<{ job: ImportJobDocument; created: boolean }> {
    const id = new Types.ObjectId();
    try {
      const job = await this.model.create({
        _id: id,
        runId: id,
        type: run.type,
        normalisedUrl: run.normalisedUrl,
        submittedUrls: [run.normalisedUrl],
        domain: run.domain,
        scrapedWebsiteRef: run.scrapedWebsiteId,
        submittedBy: run.submittedBy ? new Types.ObjectId(run.submittedBy) : undefined,
        batchId: run.batchId,
        payload: run.payload,
        status: ImportJobStatus.QUEUED,
        activeKey: activeKey(run.type, run.normalisedUrl),
      });
      return { job, created: true };
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      const existing = await this.model.findOne({ activeKey: activeKey(run.type, run.normalisedUrl) });
      if (!existing) throw err;
      return { job: existing, created: false };
    }
  }

  async createStage(parent: ImportJobDocument, type: ImportJobType, payload?: Record<string, unknown>): Promise<ImportJobDocument | null> {
    try {
      return await this.model.create({
        runId: parent.runId,
        parentJobId: parent._id,
        type,
        normalisedUrl: parent.normalisedUrl,
        submittedUrls: parent.submittedUrls,
        domain: parent.domain,
        scrapedWebsiteRef: parent.scrapedWebsiteRef,
        submittedBy: parent.submittedBy,
        batchId: parent.batchId,
        adapterId: parent.adapterId,
        adapterVersion: parent.adapterVersion,
        payload,
        status: ImportJobStatus.QUEUED,
        activeKey: parent.normalisedUrl ? activeKey(type, parent.normalisedUrl) : undefined,
      });
    } catch (err) {
      if (isDuplicateKey(err)) return null;
      throw err;
    }
  }

  get(id: string | Types.ObjectId) {
    return this.model.findById(id);
  }

  // Any queued, running or delayed stage for the website: runs for one site never overlap.
  activeForSite(scrapedWebsiteId: Types.ObjectId) {
    return this.model.findOne({ scrapedWebsiteRef: scrapedWebsiteId, status: { $in: ACTIVE_IMPORT_JOB_STATUSES } }).sort({ createdAt: 1 });
  }

  stagesOf(runId: string | Types.ObjectId) {
    return this.model.find({ runId: new Types.ObjectId(String(runId)) }).sort({ createdAt: 1 });
  }

  async attachQueue(id: Types.ObjectId, queueName: string, bullJobId: string) {
    await this.model.updateOne({ _id: id }, { $set: { queueName, bullJobId } });
  }

  async markRunning(id: Types.ObjectId, attempt: number) {
    await this.model.updateOne(
      { _id: id },
      { $set: { status: ImportJobStatus.RUNNING, attempts: attempt }, $min: { startedAt: new Date() } },
    );
  }

  async markDelayed(id: Types.ObjectId, until: Date, reason: string) {
    await this.model.updateOne({ _id: id }, { $set: { status: ImportJobStatus.DELAYED, 'progress.message': reason } });
    await this.log(id, 'info', `Delayed until ${until.toISOString()}: ${reason}`);
  }

  async progress(id: Types.ObjectId, current: number, total: number, message?: string) {
    await this.model.updateOne({ _id: id }, { $set: { progress: { current, total, message } } });
  }

  async checkpoint(id: Types.ObjectId, partial: Record<string, unknown>) {
    await this.model.updateOne({ _id: id }, { $set: { 'output.partial': partial } });
  }

  async log(id: Types.ObjectId, level: LogLevel, message: string, data?: Record<string, unknown>) {
    await this.model.updateOne(
      { _id: id },
      { $push: { logs: { $each: [{ at: new Date(), level, message, data }], $slice: -RETENTION.jobLogLines } } },
    );
  }

  async complete(job: ImportJobDocument, output: Record<string, unknown> | undefined, resultCounts: Record<string, number> = {}) {
    const finishedAt = new Date();
    await this.model.updateOne(
      { _id: job._id },
      {
        $set: {
          status: ImportJobStatus.COMPLETED,
          output,
          resultCounts,
          finishedAt,
          durationMs: job.startedAt ? finishedAt.getTime() - job.startedAt.getTime() : undefined,
          'progress.message': 'Completed',
        },
        $unset: { activeKey: 1 },
      },
    );
  }

  async fail(job: ImportJobDocument, error: Error, options: { attempt: number; retryable: boolean; final: boolean; deadLetter: boolean }) {
    const update: Record<string, unknown> = {
      $push: {
        errorLog: {
          $each: [{ at: new Date(), message: error.message, code: (error as { code?: string }).code, attempt: options.attempt, retryable: options.retryable }],
          $slice: -50,
        },
      },
    };
    if (options.final) {
      const finishedAt = new Date();
      update.$set = {
        status: options.deadLetter ? ImportJobStatus.DEAD_LETTERED : ImportJobStatus.FAILED,
        finishedAt,
        durationMs: job.startedAt ? finishedAt.getTime() - job.startedAt.getTime() : undefined,
        'progress.message': error.message,
      };
      update.$unset = { activeKey: 1 };
    } else {
      update.$set = { status: ImportJobStatus.QUEUED, 'progress.message': `Retrying after: ${error.message}` };
    }
    await this.model.updateOne({ _id: job._id }, update);
    await this.log(job._id, options.final ? 'error' : 'warn', error.message, { attempt: options.attempt, final: options.final });
  }

  // Marks every unfinished stage of a run cancelled.
  async cancelRun(runId: Types.ObjectId, cancelledBy?: string, reason?: string): Promise<ImportJobDocument[]> {
    const open = await this.model.find({ runId, status: { $in: ACTIVE_IMPORT_JOB_STATUSES } });
    await this.model.updateMany(
      { runId, status: { $in: ACTIVE_IMPORT_JOB_STATUSES } },
      {
        $set: {
          status: ImportJobStatus.CANCELLED,
          finishedAt: new Date(),
          cancelledBy: cancelledBy ? new Types.ObjectId(cancelledBy) : undefined,
          cancelReason: reason,
          'progress.message': reason ?? 'Cancelled',
        },
        $unset: { activeKey: 1 },
      },
    );
    return open;
  }

  // Stage hand-over data is only needed while the run is in flight (data minimisation).
  async clearRunOutputs(runId: Types.ObjectId) {
    await this.model.updateMany({ runId }, { $unset: { output: 1, payload: 1 } });
  }

  // Resets a failed or dead-lettered stage so it can be queued again.
  async resetForRetry(job: ImportJobDocument): Promise<ImportJobDocument | null> {
    const key = job.normalisedUrl ? activeKey(job.type, job.normalisedUrl) : undefined;
    try {
      return await this.model.findOneAndUpdate(
        { _id: job._id, status: { $in: [ImportJobStatus.FAILED, ImportJobStatus.DEAD_LETTERED, ImportJobStatus.CANCELLED] } },
        { $set: { status: ImportJobStatus.QUEUED, activeKey: key, 'progress.message': 'Retry requested' }, $unset: { finishedAt: 1, durationMs: 1 } },
        { new: true },
      );
    } catch (err) {
      if (isDuplicateKey(err)) return null;
      throw err;
    }
  }
}
