import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { ClaimMethod, ClaimStatus } from '../common/enums';

export type ClaimDocument = HydratedDocument<Claim>;

@Schema({ timestamps: true })
export class Claim {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Business', required: true })
  businessId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(ClaimMethod), required: true })
  method: ClaimMethod;

  @Prop()
  evidence?: string;

  // For phone OTP flow (dev: code returned in response; prod: sent via SMS)
  @Prop({ select: false })
  otpCode?: string;

  @Prop({ default: false })
  otpVerified: boolean;

  // Wrong codes entered so far, and when the code stops working; the claim is rejected once either runs out.
  @Prop({ default: 0 })
  otpAttempts: number;

  @Prop()
  otpExpiresAt?: Date;

  @Prop({ type: String, enum: Object.values(ClaimStatus), default: ClaimStatus.PENDING })
  status: ClaimStatus;

  @Prop({ default: 'medium' })
  riskLevel: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  reviewedBy?: Types.ObjectId;

  @Prop()
  reviewNote?: string;
}

export const ClaimSchema = SchemaFactory.createForClass(Claim);
// Phone-code claims started recently for a business (the per-business limit on code guessing).
ClaimSchema.index({ businessId: 1, method: 1, createdAt: -1 });
