import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ClaimMethod, ClaimStatus } from '../common/enums';

export type ClaimDocument = HydratedDocument<Claim>;

@Schema({ timestamps: true })
export class Claim {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true })
  businessId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
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

  @Prop({ type: String, enum: Object.values(ClaimStatus), default: ClaimStatus.PENDING })
  status: ClaimStatus;

  @Prop({ default: 'medium' })
  riskLevel: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  reviewedBy?: Types.ObjectId;

  @Prop()
  reviewNote?: string;
}

export const ClaimSchema = SchemaFactory.createForClass(Claim);
