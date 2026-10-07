import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SiteSettingsDocument = HydratedDocument<SiteSettings>;

export const DEFAULT_ORDERING_DOMAINS = [
  'foodbell.co.uk',
  'foodhub.co.uk',
  'foodhub.com',
  'grub24.co.uk',
  'just-eat.co.uk',
  'deliveroo.co.uk',
  'ubereats.com',
];

@Schema({ _id: false })
export class ReportRules {
  // Open reports from different people on one offer within `windowDays` that hide it automatically
  @Prop({ default: 3 }) autoHideThreshold: number;
  @Prop({ default: 7 }) windowDays: number;
  // Upheld reports against one business within `strikeWindowDays` that flag it for a suspension review
  @Prop({ default: 3 }) strikeThreshold: number;
  @Prop({ default: 90 }) strikeWindowDays: number;
}

@Schema({ _id: false })
export class ModerationRules {
  @Prop({ type: [String], default: [] }) bannedWords: string[];
  // A percentage discount above this goes to the moderator queue
  @Prop({ default: 70 }) maxDiscountPercent: number;
  // An offer link must point at the business's own domain or a known ordering provider
  @Prop({ default: true }) checkLinkDomain: boolean;
}

/**
 * Secrets are stored encrypted (see platform/crypto.ts) and never sent back to the browser; the admin page
 * only learns whether each one is set. An environment variable of the same purpose is the fallback.
 */
@Schema({ _id: false })
export class SettingsSecrets {
  @Prop() stripeSecretKey?: string;
  @Prop() stripeWebhookSecret?: string;
  @Prop() twilioAccountSid?: string;
  @Prop() twilioAuthToken?: string;
  @Prop() twilioVerifyServiceSid?: string;
  // Campaign SMS (Programmable Messaging): a Messaging Service SID with a UK sender
  @Prop() twilioMessagingServiceSid?: string;
  @Prop() resendApiKey?: string;
  @Prop() recaptchaSecretKey?: string;
  // Signs requests to and from Foodbell (src/foodbell); Foodbell holds the same value
  @Prop() foodbellSharedSecret?: string;
}

// One document, key "site".
@Schema({ timestamps: true, collection: 'sitesettings' })
export class SiteSettings {
  @Prop({ required: true, unique: true, default: 'site' })
  key: string;

  @Prop({ default: 'TruOffers' }) siteName: string;
  @Prop({ default: 'hello@truoffers.co.uk' }) contactEmail: string;
  @Prop() contactPhone?: string;
  @Prop() contactAddress?: string;

  @Prop({ default: 20 }) vatRatePercent: number;
  // Plan prices are shown and charged excluding VAT unless this is on
  @Prop({ default: false }) pricesIncludeVat: boolean;

  @Prop({ default: false }) maintenanceMode: boolean;
  @Prop({ default: 'TruOffers is down for maintenance. We will be back shortly.' }) maintenanceMessage: string;

  @Prop({ type: ReportRules, default: () => ({}) }) reports: ReportRules;
  @Prop({ type: ModerationRules, default: () => ({}) }) moderation: ModerationRules;

  @Prop({ type: [String], default: () => [...DEFAULT_ORDERING_DOMAINS] }) knownOrderingDomains: string[];

  @Prop({ default: 'TruOffers <hello@truoffers.co.uk>' }) emailFrom: string;
  @Prop() recaptchaSiteKey?: string;

  // Foodbell's API, e.g. https://api.foodbell.co.uk/api (src/foodbell)
  @Prop({ default: 'https://api.foodbell.co.uk/api' }) foodbellApiUrl: string;

  @Prop({ type: SettingsSecrets, default: () => ({}) }) secrets: SettingsSecrets;

  // Cached Stripe tax rate for the current VAT percentage
  @Prop() stripeTaxRateId?: string;
  @Prop() stripeTaxRatePercent?: number;
}

export const SiteSettingsSchema = SchemaFactory.createForClass(SiteSettings);
