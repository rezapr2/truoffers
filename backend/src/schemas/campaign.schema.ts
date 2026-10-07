import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type CampaignDocument = HydratedDocument<Campaign>;

export const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'sending', 'sent', 'cancelled'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

@Schema({ _id: false })
export class CampaignAudience {
  // customer, business_owner, business_staff, supplier
  @Prop({ type: [String], default: [] }) roles: string[];
  // People on the team of a business at one of these verification levels (business roles only)
  @Prop({ type: [Number], default: [] }) verificationLevels: number[];
  // People on the team of a business on one of these plans (free = no paid plan)
  @Prop({ type: [String], default: [] }) plans: string[];
  // Customers by postcode area (e.g. M14), businesses by town
  @Prop({ type: [String], default: [] }) towns: string[];
  @Prop({ type: [String], default: [] }) postcodeAreas: string[];
  // Followers of one takeaway
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Business' }) followersOf?: Types.ObjectId;
}

@Schema({ _id: false })
export class ChannelStats {
  @Prop({ default: 0 }) sent: number;
  @Prop({ default: 0 }) failed: number;
  // No consent, no phone number, or the channel isn't set up
  @Prop({ default: 0 }) skipped: number;
}

/**
 * Email, SMS and in-app campaigns (blueprint §14.1). Marketing campaigns reach only people who opted in to
 * that channel and carry an unsubscribe link; service campaigns (essential account news) reach everyone.
 */
@Schema({ timestamps: true, collection: 'campaigns' })
export class Campaign {
  @Prop({ required: true, trim: true }) name: string;

  // marketing | service
  @Prop({ default: 'marketing' }) kind: string;

  @Prop({ type: Object, default: () => ({ email: true, sms: false, inApp: false }) })
  channels: { email: boolean; sms: boolean; inApp: boolean };

  @Prop({ type: CampaignAudience, default: () => ({}) }) audience: CampaignAudience;

  @Prop({ default: '' }) subject: string;
  @Prop({ default: '' }) body: string;
  @Prop({ default: '' }) smsBody: string;
  // Where the in-app notification and the email button go
  @Prop() link?: string;

  @Prop({ type: String, enum: CAMPAIGN_STATUSES, default: 'draft', index: true }) status: CampaignStatus;
  @Prop({ type: Date, index: true }) scheduledAt?: Date;
  @Prop({ type: Date }) startedAt?: Date;
  @Prop({ type: Date }) finishedAt?: Date;

  // Resume point: users are sent to in _id order, so a restart carries on after the last one done
  @Prop({ type: SchemaTypes.ObjectId }) cursor?: Types.ObjectId;
  @Prop({ default: 0 }) recipients: number;
  @Prop({ type: ChannelStats, default: () => ({}) }) email: ChannelStats;
  @Prop({ type: ChannelStats, default: () => ({}) }) sms: ChannelStats;
  @Prop({ type: ChannelStats, default: () => ({}) }) inApp: ChannelStats;

  // Held while one process sends a batch, so two can never send the same campaign at once
  @Prop({ type: Date }) lockedUntil?: Date;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' }) createdBy?: Types.ObjectId;
  @Prop() lastError?: string;
}

export const CampaignSchema = SchemaFactory.createForClass(Campaign);
