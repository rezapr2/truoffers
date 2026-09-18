import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { CRAWL_DEFAULTS } from '../scraper/scraper.constants';

export type ScraperSettingsDocument = HydratedDocument<ScraperSettings>;

export const SCRAPER_SETTINGS_KEY = 'global';

// Singleton: one document with key "global".
@Schema({ timestamps: true })
export class ScraperSettings {
  @Prop({ required: true, unique: true, default: SCRAPER_SETTINGS_KEY })
  key: string;

  // AI extraction also needs ANTHROPIC_API_KEY; both must be present.
  @Prop({ default: false })
  aiExtractionEnabled: boolean;

  // Spec §5: Chromium rendering, used only where the static adapters found no offers. Needs a render worker.
  @Prop({ default: false })
  renderingEnabled: boolean;

  // Spec §2.3 provider review. Off (the default): websites on an ordering platform are crawled unless the
  // platform's policy is blocked. On: they're held until the platform's policy is allowed, with a recorded basis.
  @Prop({ default: false })
  providerReviewRequired: boolean;

  @Prop({ default: CRAWL_DEFAULTS.rateLimitMs, min: 250 })
  defaultRateLimitMs: number;

  @Prop({ default: CRAWL_DEFAULTS.pageCap, min: 1, max: 1000 })
  defaultPageCap: number;

  // Admin additions to the code-level never-crawl list. The built-in list can't be reduced.
  @Prop({ type: [String], default: [] })
  extraNeverCrawlDomains: string[];

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;
}

export const ScraperSettingsSchema = SchemaFactory.createForClass(ScraperSettings);
