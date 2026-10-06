import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { ReportReason, ReportStatus } from '../common/enums';

export type ReportDocument = HydratedDocument<Report>;
export type BusinessStrikeDocument = HydratedDocument<BusinessStrike>;
export type ReportBlockDocument = HydratedDocument<ReportBlock>;
export type ReportCaseDocument = HydratedDocument<ReportCase>;

/** One visitor's report of a false offer (spec "Offer reports"). */
@Schema({ timestamps: true })
export class Report {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Offer', required: true, index: true })
  offerId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  reporterId?: Types.ObjectId;

  @Prop({ lowercase: true, trim: true })
  reporterEmail?: string;

  // Hash of the device id (and IP for guests): one report per offer per person/device per 7 days
  @Prop({ index: true })
  reporterKey?: string;

  @Prop({ type: String, enum: Object.values(ReportReason), required: true })
  reason: ReportReason;

  @Prop({ maxlength: 500 })
  note?: string;

  // Private storage key of an optional receipt or screen photo
  @Prop()
  photoKey?: string;

  @Prop({ type: String, enum: Object.values(ReportStatus), default: ReportStatus.OPEN, index: true })
  status: ReportStatus;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  decidedBy?: Types.ObjectId;

  @Prop()
  decisionNote?: string;

  @Prop({ type: Date })
  decidedAt?: Date;

  @Prop({ type: Date })
  reporterNotifiedAt?: Date;
}

export const ReportSchema = SchemaFactory.createForClass(Report);
ReportSchema.index({ offerId: 1, status: 1, createdAt: -1 });

/**
 * The decision about all the reports on one offer: what the queue shows per offer, what the business sees
 * after the decision, and its one appeal.
 */
@Schema({ _id: false })
export class ReportAppeal {
  @Prop({ required: true }) message: string;
  @Prop({ type: Date, required: true }) at: Date;
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' }) by?: Types.ObjectId;
  // open | accepted | declined
  @Prop({ default: 'open' }) status: string;
  @Prop() response?: string;
  @Prop({ type: Date }) decidedAt?: Date;
}

@Schema({ _id: false })
export class BusinessReply {
  @Prop({ required: true }) message: string;
  @Prop({ type: Date, required: true }) at: Date;
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' }) by?: Types.ObjectId;
}

@Schema({ timestamps: true })
export class ReportCase {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Offer', required: true, index: true })
  offerId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  // open | info_requested | upheld | rejected
  @Prop({ type: String, enum: Object.values(ReportStatus), default: ReportStatus.OPEN, index: true })
  status: ReportStatus;

  @Prop({ default: 0 })
  reportCount: number;

  @Prop({ type: Date })
  firstReportAt?: Date;

  @Prop({ type: Date })
  latestReportAt?: Date;

  // The offer was hidden automatically (threshold reached) and goes live again if the reports are rejected
  @Prop({ default: false })
  autoHidden: boolean;

  // The offer's status before it was hidden, to restore
  @Prop()
  statusBeforeHide?: string;

  @Prop({ type: String, enum: Object.values(ReportReason) })
  decisionReason?: ReportReason;

  @Prop()
  decisionNote?: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  decidedBy?: Types.ObjectId;

  @Prop({ type: Date })
  decidedAt?: Date;

  // "Ask business": 48 hours to reply or edit the offer
  @Prop({ type: Date })
  infoRequestedAt?: Date;

  @Prop({ type: Date })
  infoDeadline?: Date;

  @Prop()
  infoMessage?: string;

  @Prop({ type: [SchemaFactory.createForClass(BusinessReply)], default: [] })
  businessReplies: BusinessReply[];

  @Prop({ type: SchemaFactory.createForClass(ReportAppeal) })
  appeal?: ReportAppeal;
}

export const ReportCaseSchema = SchemaFactory.createForClass(ReportCase);
ReportCaseSchema.index({ status: 1, reportCount: -1, firstReportAt: 1 });

/** An upheld report counts against the business; three in 90 days flag it for a suspension review. */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class BusinessStrike {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'ReportCase', required: true })
  reportCaseId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Offer' })
  offerId?: Types.ObjectId;

  // Removed again when an appeal is accepted
  @Prop({ type: Date })
  revokedAt?: Date;

  createdAt?: Date;
}

export const BusinessStrikeSchema = SchemaFactory.createForClass(BusinessStrike);

/** A reporter who abuses the form. */
@Schema({ timestamps: true })
export class ReportBlock {
  @Prop({ lowercase: true, trim: true, index: true })
  email?: string;

  @Prop({ index: true })
  reporterKey?: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', index: true })
  userId?: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  blockedBy?: Types.ObjectId;

  @Prop()
  reason?: string;
}

export const ReportBlockSchema = SchemaFactory.createForClass(ReportBlock);
