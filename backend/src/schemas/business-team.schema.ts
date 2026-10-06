import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { BusinessMemberRole } from '../common/enums';

export type BusinessInviteDocument = HydratedDocument<BusinessInvite>;
export type BusinessChangeRequestDocument = HydratedDocument<BusinessChangeRequest>;

/** An owner's invitation for someone to join the business's team (spec T1.3). */
@Schema({ timestamps: true })
export class BusinessInvite {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ required: true, lowercase: true, trim: true })
  email: string;

  @Prop({ type: String, enum: Object.values(BusinessMemberRole), required: true })
  role: BusinessMemberRole;

  @Prop({ required: true, unique: true, select: false })
  tokenHash: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  invitedBy: Types.ObjectId;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop({ type: Date })
  acceptedAt?: Date;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  acceptedBy?: Types.ObjectId;

  @Prop({ type: Date })
  revokedAt?: Date;
}

export const BusinessInviteSchema = SchemaFactory.createForClass(BusinessInvite);

@Schema({ _id: false })
export class FieldChange {
  @Prop({ required: true }) field: string;
  @Prop({ type: SchemaTypes.Mixed }) from?: unknown;
  @Prop({ type: SchemaTypes.Mixed }) to?: unknown;
}

/**
 * Spec "Re-verification": once a takeaway is verified, changes to its name, address, phone or order link wait
 * for a moderator. The badge stays meanwhile.
 */
@Schema({ timestamps: true })
export class BusinessChangeRequest {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  requestedBy: Types.ObjectId;

  @Prop({ type: [SchemaFactory.createForClass(FieldChange)], default: [] })
  changes: FieldChange[];

  // pending | approved | rejected | superseded
  @Prop({ default: 'pending', index: true })
  status: string;

  // Order link check at the time of the request (matches the business's domain or a known ordering provider)
  @Prop()
  orderLinkCheck?: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  reviewedBy?: Types.ObjectId;

  @Prop({ type: Date })
  reviewedAt?: Date;

  @Prop()
  note?: string;
}

export const BusinessChangeRequestSchema = SchemaFactory.createForClass(BusinessChangeRequest);
