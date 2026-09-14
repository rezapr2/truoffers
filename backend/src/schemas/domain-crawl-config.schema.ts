import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DomainCrawlConfigDocument = HydratedDocument<DomainCrawlConfig>;

// Per-domain overrides. Keyed by host, or by registrable domain to cover every subdomain.
@Schema({ timestamps: true })
export class DomainCrawlConfig {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  domain: string;

  // Minimum milliseconds between requests; defaults to the global setting.
  @Prop({ min: 250 })
  rateLimitMs?: number;

  @Prop({ min: 1, max: 1000 })
  pageCap?: number;

  @Prop({ default: false })
  paused: boolean;

  @Prop()
  pausedReason?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  pausedBy?: Types.ObjectId;

  // Path prefixes never fetched on this domain (admin "block source" on a single URL).
  @Prop({ type: [String], default: [] })
  blockedPaths: string[];
}

export const DomainCrawlConfigSchema = SchemaFactory.createForClass(DomainCrawlConfig);
