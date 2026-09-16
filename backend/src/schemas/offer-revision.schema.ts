import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { OfferRevisionStatus, OfferVerification } from '../common/scraper.enums';
import type { PublishableOffer, RevisionTrackedField, RevisionValues } from '../scraper/lifecycle/offer-mapping';
import type { FieldEvidence } from '../scraper/extraction/adapter.types';
import { OfferSource, OfferSourceSchema } from './offer.schema';

export type OfferRevisionDocument = HydratedDocument<OfferRevision>;

/**
 * Spec §9/§12: a recheck found a published imported offer with changed terms. The public offer stays as it
 * was until an admin applies or discards this. Closed revisions are kept as the offer's revision history.
 */
@Schema({ timestamps: true })
export class OfferRevision {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Offer', required: true, index: true })
  offerRef: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Business', required: true })
  businessRef: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'ScrapedWebsite', index: true })
  scrapedWebsiteRef?: Types.ObjectId;

  @Prop()
  domain?: string;

  @Prop({ type: String, enum: Object.values(OfferRevisionStatus), default: OfferRevisionStatus.PENDING })
  status: OfferRevisionStatus;

  // Tracked values as published when the change was found, and as the website now shows them.
  @Prop({ type: Object, required: true })
  previous: RevisionValues;

  @Prop({ type: Object, required: true })
  proposedValues: RevisionValues;

  @Prop({ type: [String], default: [] })
  changedFields: RevisionTrackedField[];

  // The extracted offer that applying this revision publishes (without sources and evidence, kept below).
  @Prop({ type: Object, required: true })
  proposed: Omit<PublishableOffer, 'sources' | 'evidence'>;

  @Prop({ required: true })
  proposedFingerprint: string;

  @Prop({ type: [OfferSourceSchema], default: [] })
  sources: OfferSource[];

  @Prop({ type: Object, default: {} })
  evidence: Record<string, FieldEvidence>;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'ImportJob' })
  runRef?: Types.ObjectId;

  @Prop({ type: Date, required: true })
  firstDetectedAt: Date;

  @Prop({ type: Date, required: true })
  lastDetectedAt: Date;

  @Prop({ default: 1 })
  detectionCount: number;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  reviewedBy?: Types.ObjectId;

  @Prop({ type: Date })
  reviewedAt?: Date;

  @Prop()
  reviewNote?: string;

  @Prop({ type: String, enum: [OfferVerification.UNVERIFIED, OfferVerification.ADMIN_VERIFIED] })
  appliedVerification?: OfferVerification;

  // Why a revision was closed without a decision.
  @Prop()
  closedReason?: string;

  @Prop({ type: Date })
  excerptsRedactAfter?: Date;

  @Prop({ type: Date })
  excerptsRedactedAt?: Date;
}

export const OfferRevisionSchema = SchemaFactory.createForClass(OfferRevision);
// At most one open revision per offer; later changes update it.
OfferRevisionSchema.index({ offerRef: 1 }, { unique: true, partialFilterExpression: { status: OfferRevisionStatus.PENDING }, name: 'one_pending_revision_per_offer' });
OfferRevisionSchema.index({ status: 1, lastDetectedAt: -1 });
