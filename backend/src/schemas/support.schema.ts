import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type SupportTicketDocument = HydratedDocument<SupportTicket>;

export const SUPPORT_TOPICS = ['account', 'claim', 'listing', 'offer', 'billing', 'report', 'partnership', 'other'] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];
// open: waiting on us; pending: waiting on the customer; closed
export const SUPPORT_STATUSES = ['open', 'pending', 'closed'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

@Schema({ _id: true, timestamps: { createdAt: true, updatedAt: false } })
export class SupportMessage {
  // customer | staff | system
  @Prop({ required: true }) from: string;
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' }) userId?: Types.ObjectId;
  @Prop() name?: string;
  @Prop({ required: true }) body: string;
  // Staff-only notes, never shown or sent to the customer
  @Prop({ default: false }) internal: boolean;
  createdAt?: Date;
}
export const SupportMessageSchema = SchemaFactory.createForClass(SupportMessage);

/** Blueprint §11 support_tickets: the contact form, dashboard requests and the admin support inbox. */
@Schema({ timestamps: true, collection: 'supporttickets' })
export class SupportTicket {
  // Human reference, e.g. T-10234
  @Prop({ required: true, unique: true })
  number: string;

  @Prop({ required: true, trim: true })
  subject: string;

  @Prop({ type: String, enum: SUPPORT_TOPICS, default: 'other', index: true })
  topic: SupportTopic;

  @Prop({ type: String, enum: SUPPORT_STATUSES, default: 'open', index: true })
  status: SupportStatus;

  // normal | high
  @Prop({ default: 'normal' })
  priority: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, lowercase: true, trim: true, index: true })
  email: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', index: true })
  userId?: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Business', index: true })
  businessId?: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  assignedTo?: Types.ObjectId;

  @Prop({ type: [SupportMessageSchema], default: [] })
  messages: SupportMessage[];

  // Lets someone without an account open the conversation from the link in their email (encrypted, so
  // later emails can carry the same link)
  @Prop({ select: false })
  accessTokenEnc?: string;

  @Prop({ type: Date })
  lastCustomerMessageAt?: Date;

  @Prop({ type: Date })
  lastStaffReplyAt?: Date;

  @Prop({ type: Date })
  closedAt?: Date;
}

export const SupportTicketSchema = SchemaFactory.createForClass(SupportTicket);
SupportTicketSchema.index({ status: 1, lastCustomerMessageAt: 1 });
