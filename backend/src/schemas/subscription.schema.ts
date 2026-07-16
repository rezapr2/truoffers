import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PlanKey, SubscriptionStatus } from '../common/enums';

export type SubscriptionDocument = HydratedDocument<Subscription>;

@Schema({ timestamps: true })
export class Subscription {
  @Prop({ type: Types.ObjectId, ref: 'Business', index: true })
  businessId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Supplier', index: true })
  supplierId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(PlanKey), required: true })
  planKey: PlanKey;

  @Prop({ default: 'monthly' })
  interval: string; // monthly | annual

  @Prop({ required: true })
  price: number;

  @Prop({
    type: String,
    enum: Object.values(SubscriptionStatus),
    default: SubscriptionStatus.ACTIVE,
  })
  status: SubscriptionStatus;

  @Prop()
  stripeSubscriptionId?: string;

  @Prop()
  stripeCustomerId?: string;

  @Prop({ type: Date })
  currentPeriodEnd?: Date;

  @Prop({ type: Date })
  cancelledAt?: Date;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
