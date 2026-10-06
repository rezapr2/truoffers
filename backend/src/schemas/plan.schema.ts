import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PlanDocument = HydratedDocument<Plan>;

export type AnalyticsLevel = 'views' | 'full' | 'full_report';

@Schema({ _id: false })
export class PlanLimits {
  // -1 = unlimited
  @Prop({ default: 2 }) maxLiveOffers: number;
  @Prop({ default: 5 }) maxPhotos: number;
  @Prop({ default: 1 }) maxBranches: number;
}

@Schema({ _id: false })
export class PlanFlags {
  @Prop({ default: false }) scheduledOffers: boolean;
  @Prop({ default: false }) couponCodes: boolean;
  // views: impressions and profile views only; full: every metric per offer and per day, CSV;
  // full_report: full plus a monthly email report
  @Prop({ type: String, enum: ['views', 'full', 'full_report'], default: 'views' }) analytics: AnalyticsLevel;
  @Prop({ default: false }) aiOfferWriter: boolean;
  @Prop({ default: false }) qrCodes: boolean;
  // 0 normal, 1 boost, 2 higher boost: breaks ties after promoted slots and verification
  @Prop({ default: 0 }) rankingBoost: number;
  @Prop({ default: false }) prioritySupport: boolean;
  // Professional: one free Top-of-search week each calendar month
  @Prop({ default: 0 }) freeTopOfSearchWeeksPerMonth: number;
}

@Schema({ _id: false })
export class PlanStripe {
  @Prop() productId?: string;
  @Prop() monthlyPriceId?: string;
  @Prop() annualPriceId?: string;
  // The amounts (pence) the price IDs were created for, so a price change makes new Stripe prices
  @Prop() monthlyAmount?: number;
  @Prop() annualAmount?: number;
  @Prop({ type: Date }) syncedAt?: Date;
}

/** Plans are edited in /admin/plans; the public /pricing page and every limit check read from here. */
@Schema({ timestamps: true })
export class Plan {
  // URL-safe identifier, e.g. "standard". Unchangeable once subscriptions use it.
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  key: string;

  @Prop({ required: true })
  name: string;

  // takeaway | supplier
  @Prop({ required: true, default: 'takeaway' })
  audience: string;

  @Prop({ required: true, default: 0 })
  monthlyPrice: number;

  @Prop({ required: true, default: 0 })
  annualPrice: number;

  // Overrides the site's VAT rate for this plan when set
  @Prop()
  vatRatePercent?: number;

  @Prop({ default: 0 })
  trialDays: number;

  // Short line under the name, e.g. "Most independent takeaways"
  @Prop()
  bestFor?: string;

  @Prop({ type: PlanLimits, default: () => ({}) })
  limits: PlanLimits;

  @Prop({ type: PlanFlags, default: () => ({}) })
  flags: PlanFlags;

  // Marketing bullets shown on /pricing
  @Prop({ type: [String], default: [] })
  features: string[];

  // Offers from verified businesses on this plan publish without review when they pass the moderation rules
  @Prop({ default: false })
  autoApprove: boolean;

  // Shown on /pricing and offered in the dashboard
  @Prop({ default: true })
  isPublic: boolean;

  // Archived plans keep their subscribers but can't be chosen
  @Prop({ default: false })
  archived: boolean;

  @Prop({ default: 0 })
  sortOrder: number;

  // e.g. "Most popular"
  @Prop()
  badgeText?: string;

  @Prop({ type: PlanStripe, default: () => ({}) })
  stripe: PlanStripe;
}

export const PlanSchema = SchemaFactory.createForClass(Plan);
