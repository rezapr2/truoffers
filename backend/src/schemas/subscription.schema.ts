import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { SubscriptionStatus } from '../common/enums';

export type SubscriptionDocument = HydratedDocument<Subscription>;

/** A business's plan. Stripe is the source of truth; webhooks keep this copy in step. */
@Schema({ timestamps: true })
export class Subscription {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Business', index: true })
  businessId?: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Supplier', index: true })
  supplierId?: Types.ObjectId;

  // Who bought it
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  planKey: string;

  // monthly | annual
  @Prop({ default: 'monthly' })
  interval: string;

  // What the business pays each interval, before VAT
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

  @Prop()
  stripeCheckoutSessionId?: string;

  @Prop({ type: Date })
  currentPeriodEnd?: Date;

  @Prop({ type: Date })
  trialEndsAt?: Date;

  // Cancelled by the owner: the plan runs to the end of the period, then the business is on Free
  @Prop({ default: false })
  cancelAtPeriodEnd: boolean;

  // A downgrade waiting for the end of the period
  @Prop()
  pendingPlanKey?: string;

  @Prop()
  pendingInterval?: string;

  // Given by an admin without payment
  @Prop({ default: false })
  comp: boolean;

  @Prop()
  compNote?: string;

  @Prop()
  couponCode?: string;

  // Failed payments: when it first failed and how many reminders have gone out (max 3)
  @Prop({ type: Date })
  pastDueSince?: Date;

  @Prop({ default: 0 })
  reminderCount: number;

  @Prop({ type: Date })
  lastReminderAt?: Date;

  @Prop({ type: Date })
  renewalReminderSentFor?: Date;

  @Prop({ type: Date })
  cancelledAt?: Date;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
SubscriptionSchema.index({ status: 1, currentPeriodEnd: 1 });
SubscriptionSchema.index({ stripeSubscriptionId: 1 }, { sparse: true });
