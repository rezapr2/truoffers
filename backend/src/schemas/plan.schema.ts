import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { PlanKey } from '../common/enums';

export type PlanDocument = HydratedDocument<Plan>;

@Schema({ timestamps: true })
export class Plan {
  @Prop({ type: String, enum: Object.values(PlanKey), unique: true, required: true })
  key: PlanKey;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  audience: string; // 'takeaway' | 'supplier'

  @Prop({ required: true })
  monthlyPrice: number;

  @Prop({ required: true })
  annualPrice: number;

  @Prop()
  bestFor?: string;

  // Feature limits per section 6 of the blueprint
  @Prop({ type: Object, default: {} })
  limits: {
    maxLiveOffers?: number; // -1 = unlimited
    maxPhotos?: number;
    verifiedBadge?: boolean;
    analytics?: string; // none | basic | advanced
    featuredPlacement?: boolean;
    scheduledOffers?: boolean;
    couponCodes?: boolean;
    aiOfferWriter?: boolean;
    qrCodes?: boolean;
    prioritySupport?: boolean;
    multiBranch?: boolean;
  };

  @Prop({ type: [String], default: [] })
  features: string[];

  @Prop({ default: 0 })
  sortOrder: number;
}

export const PlanSchema = SchemaFactory.createForClass(Plan);
