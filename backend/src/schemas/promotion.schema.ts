import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PromotionDocument = HydratedDocument<Promotion>;

export enum PromotionStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  ENDED = 'ended',
}

// Promoted placement: while active, the business (or one specific offer) is
// boosted in search results and tagged "Sponsored". A flat daily rate is
// charged from the ad wallet by a cron job; the promotion auto-pauses when
// the wallet can't cover the next day.
@Schema({ timestamps: true })
export class Promotion {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  // Optional: boost only this offer instead of the whole business
  @Prop({ type: Types.ObjectId, ref: 'Offer' })
  offerId?: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  dailyRate: number;

  @Prop({ type: String, enum: Object.values(PromotionStatus), default: PromotionStatus.ACTIVE })
  status: PromotionStatus;

  @Prop({ type: Date, default: () => new Date() })
  startedAt: Date;

  @Prop({ type: Date })
  endedAt?: Date;

  // Last day the daily rate was charged (dedupes the daily cron)
  @Prop({ type: Date })
  lastChargedAt?: Date;

  @Prop({ default: 0 })
  totalSpent: number;
}

export const PromotionSchema = SchemaFactory.createForClass(Promotion);
PromotionSchema.index({ status: 1, businessId: 1 });
