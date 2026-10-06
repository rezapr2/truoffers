import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { PaymentStatus } from '../common/enums';

export type PaymentDocument = HydratedDocument<Payment>;
export type CouponDocument = HydratedDocument<Coupon>;
export type StripeEventDocument = HydratedDocument<StripeEvent>;

/** Invoices and one-off payments, mirrored from Stripe by webhooks (or created directly in mock mode). */
@Schema({ timestamps: true })
export class Payment {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Business', index: true })
  businessId?: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Subscription' })
  subscriptionId?: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Promotion' })
  promotionId?: Types.ObjectId;

  // subscription | promotion
  @Prop({ required: true })
  kind: string;

  @Prop({ required: true })
  description: string;

  // Pounds. amount + vat = total.
  @Prop({ required: true, default: 0 })
  amount: number;

  @Prop({ default: 0 })
  vat: number;

  @Prop({ required: true, default: 0 })
  total: number;

  @Prop({ default: 'gbp' })
  currency: string;

  @Prop({ type: String, enum: Object.values(PaymentStatus), default: PaymentStatus.OPEN, index: true })
  status: PaymentStatus;

  @Prop({ default: 0 })
  refundedAmount: number;

  // Our own invoice number, e.g. TO-2026-000123
  @Prop()
  number?: string;

  @Prop() stripeInvoiceId?: string;
  @Prop() stripePaymentIntentId?: string;
  @Prop() stripeChargeId?: string;
  @Prop() stripeCheckoutSessionId?: string;

  // Stripe's hosted PDF; mock payments have a printable page in the dashboard instead
  @Prop() pdfUrl?: string;
  @Prop() hostedUrl?: string;

  @Prop({ type: Date }) periodStart?: Date;
  @Prop({ type: Date }) periodEnd?: Date;
  @Prop({ type: Date }) paidAt?: Date;

  @Prop({ default: false })
  mock: boolean;

  @Prop()
  couponCode?: string;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.index({ stripeInvoiceId: 1 }, { sparse: true });
PaymentSchema.index({ stripePaymentIntentId: 1 }, { sparse: true });
PaymentSchema.index({ createdAt: -1 });

/** Spec /admin/coupons: discount codes for businesses, e.g. 3 months 50% off Standard. */
@Schema({ timestamps: true })
export class Coupon {
  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  code: string;

  @Prop()
  description?: string;

  @Prop()
  percentOff?: number;

  // Pounds
  @Prop()
  amountOff?: number;

  // once | repeating | forever
  @Prop({ default: 'once' })
  duration: string;

  @Prop()
  durationInMonths?: number;

  // Plan keys it applies to; empty = every paid plan
  @Prop({ type: [String], default: [] })
  appliesToPlans: string[];

  @Prop()
  maxUses?: number;

  @Prop({ default: 0 })
  timesUsed: number;

  @Prop({ type: Date })
  expiresAt?: Date;

  @Prop({ default: true })
  active: boolean;

  @Prop() stripeCouponId?: string;
  @Prop() stripePromotionCodeId?: string;
}

export const CouponSchema = SchemaFactory.createForClass(Coupon);

// Stripe can send an event more than once; each is processed once.
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class StripeEvent {
  @Prop({ required: true, unique: true })
  eventId: string;

  @Prop({ required: true })
  type: string;
}

export const StripeEventSchema = SchemaFactory.createForClass(StripeEvent);
StripeEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 3600, name: 'stripe_event_ttl' });
