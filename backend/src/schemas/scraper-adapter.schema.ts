import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { ScraperAdapterStatus, ScraperAdapterType } from '../common/scraper.enums';

export type ScraperAdapterDocument = HydratedDocument<ScraperAdapter>;

@Schema({ timestamps: true })
export class ScraperAdapter {
  // Stable id recorded on every candidate, e.g. "generic-jsonld".
  @Prop({ required: true })
  key: string;

  @Prop({ required: true })
  name: string;

  @Prop({ type: String, enum: Object.values(ScraperAdapterType), required: true })
  type: ScraperAdapterType;

  @Prop()
  provider?: string;

  @Prop({ required: true })
  version: string;

  @Prop({ required: true })
  priority: number;

  @Prop({ type: String, enum: Object.values(ScraperAdapterStatus), default: ScraperAdapterStatus.ACTIVE })
  status: ScraperAdapterStatus;

  @Prop()
  pausedReason?: string;

  @Prop({ type: Object, default: {} })
  configuration: Record<string, unknown>;

  @Prop({ type: Object, default: {} })
  selectors: Record<string, unknown>;

  @Prop({ type: [String], default: [] })
  urlPatterns: string[];

  @Prop({ type: [String], default: [] })
  requiredMarkers: string[];

  @Prop({ type: [String], default: [] })
  exampleDomains: string[];

  // Hours between rechecks of websites this adapter reads (spec §10). Operational, so shared by every version.
  @Prop({ min: 1, max: 24 * 30 })
  recheckIntervalHours?: number;

  @Prop({ type: Object })
  testResults?: Record<string, unknown>;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  approvedBy?: Types.ObjectId;

  @Prop({ type: Date })
  approvedAt?: Date;

  // Phase 2: versioned selector adapters. Versions are immutable once tested; exactly one is current per key.
  @Prop({ default: true })
  isCurrent: boolean;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'WebsiteFingerprint' })
  fingerprintRef?: Types.ObjectId;

  @Prop()
  basedOnVersion?: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: Date })
  testedAt?: Date;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'ImportJob' })
  lastTestJobRef?: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  withdrawnBy?: Types.ObjectId;

  @Prop({ type: Date })
  withdrawnAt?: Date;

  @Prop()
  withdrawnReason?: string;
}

export const ScraperAdapterSchema = SchemaFactory.createForClass(ScraperAdapter);
ScraperAdapterSchema.index({ key: 1, version: 1 }, { unique: true });
// At most one current version per adapter key.
ScraperAdapterSchema.index({ key: 1 }, { unique: true, partialFilterExpression: { isCurrent: true } });
