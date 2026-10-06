import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { PromotionPlacement, PromotionStatus } from '../common/enums';

export { PromotionStatus } from '../common/enums';

export type PromotionDocument = HydratedDocument<Promotion>;
export type PromotionProductDocument = HydratedDocument<PromotionProduct>;

// day | week | deal (a fixed run, e.g. a 48-hour flash deal)
@Schema({ _id: false })
export class PromotionPrice {
  @Prop({ required: true }) unit: string;
  @Prop({ required: true }) price: number;
  // Length of one unit: 1 day, 7 days, or the deal's own length
  @Prop({ required: true }) hours: number;
}
export const PromotionPriceSchema = SchemaFactory.createForClass(PromotionPrice);

/**
 * Spec "Promotion products": what a verified business can buy for an offer. Prices, slots and approval are
 * edited in /admin/promotions.
 */
@Schema({ timestamps: true })
export class PromotionProduct {
  @Prop({ type: String, enum: Object.values(PromotionPlacement), required: true, unique: true })
  key: PromotionPlacement;

  @Prop({ required: true })
  name: string;

  // Where it shows, for the owner
  @Prop()
  description?: string;

  @Prop({ type: [PromotionPriceSchema], default: [] })
  prices: PromotionPrice[];

  // area: a postcode district (e.g. M14); category_city: a cuisine in a town; site: site-wide
  @Prop({ required: true })
  scope: string;

  // Slots per area / per cuisine per city / site-wide
  @Prop({ required: true, default: 1 })
  slots: number;

  // How many of this product one business may have running at once
  @Prop({ default: 1 })
  maxActivePerBusiness: number;

  // A moderator must approve each booking before it runs
  @Prop({ default: false })
  approvalRequired: boolean;

  @Prop({ default: 2 })
  minVerificationLevel: number;

  @Prop({ default: true })
  active: boolean;

  @Prop({ default: 0 })
  sortOrder: number;
}

export const PromotionProductSchema = SchemaFactory.createForClass(PromotionProduct);

@Schema({ _id: false })
export class PromotionScope {
  // Postcode district for top of search
  @Prop({ uppercase: true }) area?: string;
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Category' }) categoryId?: Types.ObjectId;
  // Lower-case town for category features
  @Prop({ lowercase: true }) city?: string;
}

/** A booked promotion for one offer. Labelled "Promoted" wherever it shows (UK CAP code). */
@Schema({ timestamps: true })
export class Promotion {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Offer' })
  offerId?: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(PromotionPlacement) })
  productKey?: PromotionPlacement;

  @Prop({ type: PromotionScope, default: () => ({}) })
  scope: PromotionScope;

  @Prop({ type: Date })
  startsAt?: Date;

  @Prop({ type: Date })
  endsAt?: Date;

  @Prop()
  unit?: string;

  @Prop({ default: 1 })
  quantity: number;

  // Pounds, before VAT
  @Prop({ default: 0 })
  price: number;

  @Prop({ type: String, enum: Object.values(PromotionStatus), default: PromotionStatus.PENDING_PAYMENT, index: true })
  status: PromotionStatus;

  // purchase | admin_grant | plan_credit
  @Prop({ default: 'purchase' })
  source: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Payment' })
  paymentId?: Types.ObjectId;

  @Prop()
  stripeCheckoutSessionId?: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  grantedBy?: Types.ObjectId;

  @Prop()
  note?: string;

  @Prop({ type: Date }) liveNotifiedAt?: Date;
  @Prop({ type: Date }) endedNotifiedAt?: Date;
  @Prop({ type: Date }) cancelledAt?: Date;

  // ---- Wallet-funded daily promotions from before the MVP (ended by the migration) ----
  @Prop() dailyRate?: number;
  @Prop({ type: Date }) startedAt?: Date;
  @Prop({ type: Date }) endedAt?: Date;
  @Prop({ type: Date }) lastChargedAt?: Date;
  @Prop({ default: 0 }) totalSpent: number;
  @Prop() legacy?: boolean;
}

export const PromotionSchema = SchemaFactory.createForClass(Promotion);
PromotionSchema.index({ status: 1, businessId: 1 });
PromotionSchema.index({ productKey: 1, status: 1, startsAt: 1, endsAt: 1 });
