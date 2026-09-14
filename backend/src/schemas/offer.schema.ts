import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { DiscountType, OfferStatus, RedemptionType } from '../common/enums';
import {
  OfferManagedBy,
  OfferOrigin,
  OfferVerification,
  WEEKDAYS,
  Weekday,
} from '../common/scraper.enums';
import type { FieldEvidence } from '../scraper/extraction/adapter.types';
import { applyOfferLifecycleGuard } from './offer-lifecycle.guard';

export type OfferDocument = HydratedDocument<Offer>;

// Where an imported value was found. Excerpts are capped at 500 characters when built.
@Schema({ _id: false })
export class OfferSource {
  @Prop({ required: true })
  url: string;

  @Prop()
  pageTitle?: string;

  @Prop({ default: '' })
  excerpt: string;

  @Prop({ type: Date, required: true })
  checkedAt: Date;
}
export const OfferSourceSchema = SchemaFactory.createForClass(OfferSource);

// `collection` (the collection-eligible flag) predates this and shadows a reserved Mongoose name.
@Schema({ timestamps: true, suppressReservedKeysWarning: true })
export class Offer {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop()
  description?: string;

  @Prop({ type: String, enum: Object.values(DiscountType), required: true })
  discountType: DiscountType;

  // percent => 20 means 20% ; fixed => 5 means £5
  @Prop({ default: 0 })
  value: number;

  // Short display label e.g. "20% off", "2 for 1", "Free del."
  @Prop({ required: true })
  displayLabel: string;

  @Prop({ default: 0 })
  minOrder: number;

  @Prop({ type: String, enum: Object.values(RedemptionType), required: true })
  redemptionType: RedemptionType;

  @Prop()
  code?: string;

  @Prop()
  redemptionUrl?: string;

  @Prop()
  terms?: string;

  @Prop({ type: [String], default: [] })
  excludedItems: string[];

  @Prop({ default: true })
  collection: boolean;

  @Prop({ default: true })
  delivery: boolean;

  @Prop({ type: Date })
  startsAt?: Date;

  @Prop({ type: Date })
  endsAt?: Date;

  // Limited quantity cap (0 = unlimited)
  @Prop({ default: 0 })
  maxRedemptions: number;

  @Prop({ default: 0 })
  redemptionCount: number;

  @Prop({ type: String, enum: Object.values(OfferStatus), default: OfferStatus.PENDING })
  status: OfferStatus;

  @Prop()
  moderationNote?: string;

  // Analytics counters (denormalised for fast dashboards)
  @Prop({ default: 0 })
  impressions: number;

  @Prop({ default: 0 })
  flips: number;

  @Prop({ default: 0 })
  detailViews: number;

  @Prop({ default: 0 })
  orderClicks: number;

  // ---- Provenance and lifecycle (imported offers) ----

  @Prop({ type: String, enum: Object.values(OfferOrigin), default: OfferOrigin.MERCHANT, index: true })
  origin: OfferOrigin;

  @Prop({ type: String, enum: Object.values(OfferVerification), default: OfferVerification.UNVERIFIED })
  verification: OfferVerification;

  @Prop({ type: String, enum: Object.values(OfferManagedBy) })
  managedBy?: OfferManagedBy;

  @Prop({ type: [OfferSourceSchema], default: [] })
  sources: OfferSource[];

  @Prop({ type: Object, default: {} })
  evidence: Record<string, FieldEvidence>;

  @Prop()
  adapterId?: string;

  @Prop()
  adapterVersion?: string;

  @Prop()
  confidenceScore?: number;

  @Prop()
  contentFingerprint?: string;

  // businessId:contentFingerprint while the offer is live; maintained by the lifecycle guard.
  @Prop()
  dedupeKey?: string;

  @Prop({ type: Date })
  lastCheckedAt?: Date;

  @Prop({ default: false })
  sourceChanged: boolean;

  @Prop({ type: Types.ObjectId, ref: 'ExtractedOfferCandidate' })
  candidateRef?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ScrapedWebsite', index: true })
  scrapedWebsiteRef?: Types.ObjectId;

  // The spec offer type when discountType alone can't express it.
  @Prop()
  offerTypeRaw?: string;

  @Prop({ type: [String], enum: WEEKDAYS, default: undefined })
  eligibleWeekdays?: Weekday[];

  @Prop()
  dailyStartTime?: string;

  @Prop()
  dailyEndTime?: string;

  @Prop()
  newCustomersOnly?: boolean;

  @Prop()
  freeItem?: string;

  @Prop({ type: [String], default: undefined })
  applicableProducts?: string[];

  @Prop()
  originalPrice?: number;

  @Prop()
  promotionalPrice?: number;

  @Prop()
  requiredSpend?: number;

  @Prop({ type: Date })
  expiredAt?: Date;

  @Prop({ type: Date })
  removedAt?: Date;

  @Prop()
  removedReason?: string;

  @Prop({ type: Date })
  excerptsRedactedAt?: Date;
}

export const OfferSchema = SchemaFactory.createForClass(Offer);
OfferSchema.index({ status: 1, endsAt: 1 });
OfferSchema.index({ businessId: 1, contentFingerprint: 1 });
OfferSchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);
applyOfferLifecycleGuard(OfferSchema);
