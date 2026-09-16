import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Query, SchemaTypes, Types } from 'mongoose';
import {
  CandidateStatus,
  ConfidenceBand,
  DuplicateKind,
  OFFER_TYPES,
  OPEN_CANDIDATE_STATUSES,
  OfferType,
  WEEKDAYS,
  Weekday,
} from '../common/scraper.enums';
import type { FieldEvidence } from '../scraper/extraction/adapter.types';
import { OfferSource, OfferSourceSchema } from './offer.schema';

export type ExtractedOfferCandidateDocument = HydratedDocument<ExtractedOfferCandidate>;

@Schema({ _id: false })
export class CandidateDuplicate {
  @Prop({ type: String, enum: Object.values(DuplicateKind), required: true })
  kind: DuplicateKind;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Offer' })
  offerRef?: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'ExtractedOfferCandidate' })
  candidateRef?: Types.ObjectId;

  // field -> { previous, proposed }
  @Prop({ type: Object })
  diff?: Record<string, { previous: unknown; proposed: unknown }>;
}
export const CandidateDuplicateSchema = SchemaFactory.createForClass(CandidateDuplicate);

@Schema({ _id: false })
export class CandidateEdit {
  @Prop({ required: true })
  field: string;

  @Prop({ type: Object })
  before?: unknown;

  @Prop({ type: Object })
  after?: unknown;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  editedBy: Types.ObjectId;

  @Prop({ type: Date, required: true })
  editedAt: Date;
}
export const CandidateEditSchema = SchemaFactory.createForClass(CandidateEdit);

@Schema({ _id: false })
export class ConfidenceSignal {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  points: number;
}
export const ConfidenceSignalSchema = SchemaFactory.createForClass(ConfidenceSignal);

@Schema({ timestamps: true })
export class ExtractedOfferCandidate {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'ImportJob', required: true, index: true })
  runRef: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'ScrapedWebsite', required: true, index: true })
  scrapedWebsiteRef: Types.ObjectId;

  @Prop({ required: true })
  domain: string;

  // Branches the offer applies to; offers found on shared pages apply to every branch.
  @Prop({ type: [String], default: ['/'] })
  branchPaths: string[];

  // ---- Normalised offer (spec §6) ----

  @Prop({ required: true, trim: true })
  title: string;

  @Prop()
  shortDescription?: string;

  @Prop()
  terms?: string;

  @Prop({ type: String, enum: OFFER_TYPES, required: true })
  offerType: OfferType;

  @Prop() discountPercentage?: number;
  @Prop() discountAmount?: number;
  @Prop() originalPrice?: number;
  @Prop() promotionalPrice?: number;

  @Prop({ type: String, default: 'GBP' })
  currency: 'GBP';

  @Prop() promoCode?: string;
  @Prop() minimumOrder?: number;
  @Prop() requiredSpend?: number;
  @Prop() freeItem?: string;
  @Prop() collectionEligible?: boolean;
  @Prop() deliveryEligible?: boolean;
  @Prop() newCustomersOnly?: boolean;

  @Prop({ type: [String], default: undefined })
  applicableProducts?: string[];

  @Prop({ type: [String], enum: WEEKDAYS, default: undefined })
  eligibleWeekdays?: Weekday[];

  @Prop() dailyStartTime?: string;
  @Prop() dailyEndTime?: string;
  @Prop() startDate?: string;
  @Prop() endDate?: string;

  @Prop({ type: [OfferSourceSchema], default: [] })
  sources: OfferSource[];

  @Prop({ type: Object, default: {} })
  evidence: Record<string, FieldEvidence>;

  @Prop({ required: true })
  extractionMethod: string;

  @Prop({ required: true })
  adapterId: string;

  @Prop({ required: true })
  adapterVersion: string;

  @Prop({ required: true })
  confidenceScore: number;

  @Prop({ type: String, enum: Object.values(ConfidenceBand), required: true })
  confidenceBand: ConfidenceBand;

  @Prop({ type: [ConfidenceSignalSchema], default: [] })
  confidenceSignals: ConfidenceSignal[];

  @Prop({ type: [String], default: [] })
  flags: string[];

  @Prop({ required: true })
  contentFingerprint: string;

  @Prop({ type: Date, required: true })
  lastCheckedAt: Date;

  @Prop({ type: CandidateDuplicateSchema })
  duplicate?: CandidateDuplicate;

  @Prop({ type: [String], default: [] })
  conflicts: string[];

  // Set when an expired offer reappears as a new offer period.
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Offer' })
  previousOfferRef?: Types.ObjectId;

  // ---- Review ----

  @Prop({ type: String, enum: Object.values(CandidateStatus), default: CandidateStatus.PENDING_REVIEW })
  status: CandidateStatus;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  reviewedBy?: Types.ObjectId;

  @Prop({ type: Date })
  reviewedAt?: Date;

  @Prop()
  reviewNote?: string;

  @Prop({ type: [CandidateEditSchema], default: [] })
  edits: CandidateEdit[];

  @Prop({ type: [SchemaTypes.ObjectId], ref: 'Offer', default: [] })
  approvedOfferRefs: Types.ObjectId[];

  @Prop({ type: SchemaTypes.ObjectId, ref: 'ExtractedOfferCandidate' })
  mergedInto?: Types.ObjectId;

  // scrapedWebsite:branches:fingerprint while the candidate is open; maintained by the hooks below.
  @Prop()
  openKey?: string;

  @Prop({ type: Date })
  excerptsRedactAfter?: Date;

  @Prop({ type: Date })
  excerptsRedactedAt?: Date;
}

export const ExtractedOfferCandidateSchema = SchemaFactory.createForClass(ExtractedOfferCandidate);
ExtractedOfferCandidateSchema.index(
  { openKey: 1 },
  { unique: true, partialFilterExpression: { openKey: { $type: 'string' } } },
);
ExtractedOfferCandidateSchema.index({ status: 1, confidenceBand: 1, createdAt: -1 });
ExtractedOfferCandidateSchema.index({ scrapedWebsiteRef: 1, contentFingerprint: 1 });
ExtractedOfferCandidateSchema.index({ excerptsRedactAfter: 1 });

export function candidateOpenKey(candidate: {
  scrapedWebsiteRef: unknown;
  branchPaths?: string[];
  contentFingerprint: string;
  status: CandidateStatus;
}): string | undefined {
  if (!OPEN_CANDIDATE_STATUSES.includes(candidate.status)) return undefined;
  const branches = [...(candidate.branchPaths ?? ['/'])].sort().join(',');
  return `${String(candidate.scrapedWebsiteRef)}:${branches}:${candidate.contentFingerprint}`;
}

ExtractedOfferCandidateSchema.pre('save', function (next) {
  this.openKey = candidateOpenKey(this);
  next();
});

ExtractedOfferCandidateSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], { document: false, query: true }, function (next) {
  const query = this as Query<unknown, unknown>;
  const update = (query.getUpdate() ?? {}) as Record<string, any>;
  const status = update.status ?? update.$set?.status;
  if (status && !OPEN_CANDIDATE_STATUSES.includes(status)) {
    query.setUpdate({ ...update, $unset: { ...(update.$unset ?? {}), openKey: 1 } });
  }
  next();
});
