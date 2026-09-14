import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
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

  @Prop({ type: Object })
  testResults?: Record<string, unknown>;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  approvedBy?: Types.ObjectId;

  @Prop({ type: Date })
  approvedAt?: Date;
}

export const ScraperAdapterSchema = SchemaFactory.createForClass(ScraperAdapter);
ScraperAdapterSchema.index({ key: 1, version: 1 }, { unique: true });
