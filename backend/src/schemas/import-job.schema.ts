import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { ImportJobStatus, ImportJobType } from '../common/scraper.enums';
import { RETENTION } from '../scraper/scraper.constants';

export type ImportJobDocument = HydratedDocument<ImportJob>;

@Schema({ _id: false })
export class JobProgress {
  @Prop({ default: 0 }) current: number;
  @Prop({ default: 0 }) total: number;
  @Prop() message?: string;
}
export const JobProgressSchema = SchemaFactory.createForClass(JobProgress);

@Schema({ _id: false })
export class JobLogLine {
  @Prop({ type: Date, required: true }) at: Date;
  @Prop({ type: String, enum: ['info', 'warn', 'error'], default: 'info' }) level: 'info' | 'warn' | 'error';
  @Prop({ required: true }) message: string;
  @Prop({ type: Object }) data?: Record<string, unknown>;
}
export const JobLogLineSchema = SchemaFactory.createForClass(JobLogLine);

@Schema({ _id: false })
export class JobError {
  @Prop({ type: Date, required: true }) at: Date;
  @Prop({ required: true }) message: string;
  @Prop() code?: string;
  @Prop({ default: 1 }) attempt: number;
  @Prop({ default: true }) retryable: boolean;
}
export const JobErrorSchema = SchemaFactory.createForClass(JobError);

// One document per queued stage. The root job of a run has runId === _id.
@Schema({ timestamps: true })
export class ImportJob {
  @Prop({ type: String, enum: Object.values(ImportJobType), required: true, index: true })
  type: ImportJobType;

  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  runId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'ImportJob' })
  parentJobId?: Types.ObjectId;

  @Prop()
  batchId?: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  submittedBy?: Types.ObjectId;

  @Prop({ type: [String], default: [] })
  submittedUrls: string[];

  @Prop()
  normalisedUrl?: string;

  @Prop({ index: true })
  domain?: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'ScrapedWebsite', index: true })
  scrapedWebsiteRef?: Types.ObjectId;

  @Prop()
  adapterId?: string;

  @Prop()
  adapterVersion?: string;

  @Prop({ type: String, enum: Object.values(ImportJobStatus), default: ImportJobStatus.QUEUED })
  status: ImportJobStatus;

  @Prop({ type: JobProgressSchema, default: () => ({ current: 0, total: 0 }) })
  progress: JobProgress;

  @Prop({ type: Object, default: {} })
  resultCounts: Record<string, number>;

  @Prop({ type: [JobLogLineSchema], default: [] })
  logs: JobLogLine[];

  // "errors" is reserved by Mongoose documents.
  @Prop({ type: [JobErrorSchema], default: [] })
  errorLog: JobError[];

  @Prop({ default: 0 })
  attempts: number;

  @Prop()
  queueName?: string;

  @Prop()
  bullJobId?: string;

  // type|normalisedUrl while queued/running/delayed: at most one active job per stage and URL (spec §12).
  @Prop()
  activeKey?: string;

  // Structured stage input/output handed between stages. Never page bodies; cleared when the run finishes.
  @Prop({ type: Object })
  payload?: Record<string, unknown>;

  @Prop({ type: Object })
  output?: Record<string, unknown>;

  @Prop({ type: Date })
  startedAt?: Date;

  @Prop({ type: Date })
  finishedAt?: Date;

  @Prop()
  durationMs?: number;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  cancelledBy?: Types.ObjectId;

  @Prop()
  cancelReason?: string;
}

export const ImportJobSchema = SchemaFactory.createForClass(ImportJob);
ImportJobSchema.index(
  { activeKey: 1 },
  { unique: true, partialFilterExpression: { activeKey: { $type: 'string' } } },
);
ImportJobSchema.index({ status: 1, createdAt: -1 });
ImportJobSchema.index({ runId: 1, createdAt: 1 });
ImportJobSchema.index({ finishedAt: 1 }, { expireAfterSeconds: RETENTION.runHistoryDays * 24 * 60 * 60 });
