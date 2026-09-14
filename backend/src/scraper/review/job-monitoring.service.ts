import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type Redis from 'ioredis';
import { Model, Types } from 'mongoose';
import { ImportJobStatus, ImportJobType } from '../../common/scraper.enums';
import { ImportJob, ImportJobDocument } from '../../schemas/import-job.schema';
import { WORKER_HEARTBEAT_PREFIX } from '../queue/queue.constants';
import { ScraperControlService } from '../queue/scraper-control.service';
import { ScraperQueueService } from '../queue/scraper-queue.service';
import { REDIS_CLIENT } from '../scraper.tokens';

const LIST_PROJECTION = '-output -payload -logs';

@Injectable()
export class JobMonitoringService {
  constructor(
    @InjectModel(ImportJob.name) private readonly jobs: Model<ImportJobDocument>,
    private readonly queue: ScraperQueueService,
    private readonly control: ScraperControlService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async list(filter: { status?: ImportJobStatus; type?: ImportJobType; domain?: string; page?: number; limit?: number }) {
    const query: Record<string, unknown> = {};
    if (filter.status) query.status = filter.status;
    if (filter.type) query.type = filter.type;
    if (filter.domain) query.domain = filter.domain.toLowerCase();
    const limit = Math.min(100, filter.limit ?? 50);
    const page = Math.max(1, filter.page ?? 1);
    const [items, total] = await Promise.all([
      this.jobs.find(query).select(LIST_PROJECTION).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('submittedBy', 'name email').lean(),
      this.jobs.countDocuments(query),
    ]);
    return { items, total, page, pages: Math.ceil(total / limit) };
  }

  async run(runId: string) {
    if (!Types.ObjectId.isValid(runId)) throw new NotFoundException('Run not found');
    const stages = await this.jobs.find({ runId: new Types.ObjectId(runId) }).select('-output -payload').sort({ createdAt: 1 }).lean();
    if (stages.length === 0) throw new NotFoundException('Run not found');
    return { runId, domain: stages[0].domain, stages };
  }

  async get(id: string) {
    const job = Types.ObjectId.isValid(id) ? await this.jobs.findById(id).select('-output -payload').populate('submittedBy cancelledBy', 'name email').lean() : null;
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  async status() {
    const [counts, halted, paused, workerKeys, statusCounts] = await Promise.all([
      this.queue.counts(),
      this.control.isHalted(),
      this.queue.isPaused(),
      this.redis.keys(`${WORKER_HEARTBEAT_PREFIX}*`),
      this.jobs.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);
    const workers = await Promise.all(
      workerKeys.map(async (key) => ({ id: key.slice(WORKER_HEARTBEAT_PREFIX.length), lastSeen: await this.redis.get(key) })),
    );
    return {
      halted,
      paused,
      queues: counts,
      workers,
      jobs: Object.fromEntries(statusCounts.map((s) => [s._id, s.count])),
    };
  }
}
