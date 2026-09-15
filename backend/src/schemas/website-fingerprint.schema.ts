import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { MarkerCategory } from '../common/scraper.enums';

export type WebsiteFingerprintDocument = HydratedDocument<WebsiteFingerprint>;

// One structural trait of a website template, e.g. css_class "sf-offer-card" or generator "saffron theme".
@Schema({ _id: false })
export class FingerprintMarker {
  @Prop({ type: String, enum: Object.values(MarkerCategory), required: true })
  category: MarkerCategory;

  @Prop({ required: true })
  value: string;

  @Prop({ default: 1, min: 0, max: 10 })
  weight: number;

  // Must be present for an exact or high-confidence match.
  @Prop({ default: false })
  required: boolean;

  // Present on a site means it is not this template.
  @Prop({ default: false })
  negative: boolean;
}
export const FingerprintMarkerSchema = SchemaFactory.createForClass(FingerprintMarker);

@Schema({ _id: false })
export class FingerprintThresholds {
  @Prop({ default: 95, min: 1, max: 100 }) exact: number;
  @Prop({ default: 80, min: 1, max: 100 }) high: number;
  @Prop({ default: 55, min: 1, max: 100 }) possible: number;
}
export const FingerprintThresholdsSchema = SchemaFactory.createForClass(FingerprintThresholds);

// Example output of the adapter builder's analysis, kept for the builder UI. Excerpts only, never page bodies.
@Schema({ _id: false })
export class ExampleAnalysis {
  @Prop({ required: true }) domain: string;
  @Prop({ type: Types.ObjectId, ref: 'ScrapedWebsite' }) websiteRef?: Types.ObjectId;
  @Prop({ type: [String], default: [] }) pages: string[];
  @Prop({ default: 0 }) markers: number;
  @Prop({ type: Object, default: [] }) offersFound: { title: string; excerpt: string; pageUrl: string }[];
  @Prop() error?: string;
}
export const ExampleAnalysisSchema = SchemaFactory.createForClass(ExampleAnalysis);

@Schema({ timestamps: true })
export class WebsiteFingerprint {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  key: string;

  @Prop({ default: 1 })
  version: number;

  // Inactive fingerprints are kept for history but never matched.
  @Prop({ default: true })
  active: boolean;

  @Prop({ type: Types.ObjectId, ref: 'ProviderPolicy' })
  providerRef?: Types.ObjectId;

  @Prop({ type: [String], default: [] })
  exampleDomains: string[];

  @Prop({ type: [FingerprintMarkerSchema], default: [] })
  markers: FingerprintMarker[];

  // Per-category weights; categories left out use the defaults in fingerprinting/scoring.ts.
  @Prop({ type: Object, default: {} })
  categoryWeights: Partial<Record<MarkerCategory, number>>;

  @Prop({ type: FingerprintThresholdsSchema, default: () => ({}) })
  thresholds: FingerprintThresholds;

  // Set by the create_fingerprint job: what it saw on each example and the selector config it suggests.
  @Prop({ type: [ExampleAnalysisSchema], default: [] })
  examples: ExampleAnalysis[];

  @Prop({ type: Object })
  suggestedConfig?: Record<string, unknown>;

  @Prop({ type: Date })
  analysedAt?: Date;

  // Set when retention removed the offer excerpts from `examples`; cleared by the next analysis.
  @Prop({ type: Date })
  excerptsRedactedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'ImportJob' })
  lastJobRef?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;
}

export const WebsiteFingerprintSchema = SchemaFactory.createForClass(WebsiteFingerprint);
WebsiteFingerprintSchema.index({ active: 1 });

WebsiteFingerprintSchema.pre('validate', function (next) {
  const t = this.thresholds;
  if (t && !(t.possible < t.high && t.high <= t.exact)) {
    return next(new Error('Thresholds must satisfy possible < high <= exact'));
  }
  next();
});
