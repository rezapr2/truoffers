import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { DiscountType, OfferStatus, RedemptionType } from '../common/enums';

export type OfferDocument = HydratedDocument<Offer>;

@Schema({ timestamps: true })
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
}

export const OfferSchema = SchemaFactory.createForClass(Offer);
OfferSchema.index({ status: 1, endsAt: 1 });
