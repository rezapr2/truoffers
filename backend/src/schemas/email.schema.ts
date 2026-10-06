import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type EmailTemplateDocument = HydratedDocument<EmailTemplate>;
export type EmailLogDocument = HydratedDocument<EmailLog>;

// An admin's edit of one of the built-in templates (platform/email-templates.ts). Absent = the default.
@Schema({ timestamps: true })
export class EmailTemplate {
  @Prop({ required: true, unique: true })
  key: string;

  @Prop({ required: true })
  subject: string;

  @Prop({ required: true })
  body: string;

  @Prop({ default: true })
  enabled: boolean;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;
}

export const EmailTemplateSchema = SchemaFactory.createForClass(EmailTemplate);

/**
 * Every transactional email, sent or not. Without an email provider configured the log is the only
 * delivery, which keeps local development and tests readable.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class EmailLog {
  @Prop({ required: true, index: true })
  to: string;

  @Prop({ required: true, index: true })
  template: string;

  @Prop({ required: true })
  subject: string;

  @Prop({ required: true })
  body: string;

  // sent | logged (no provider) | failed | disabled (template switched off)
  @Prop({ required: true })
  status: string;

  @Prop()
  provider?: string;

  @Prop()
  providerId?: string;

  @Prop()
  error?: string;
}

export const EmailLogSchema = SchemaFactory.createForClass(EmailLog);
EmailLogSchema.index({ createdAt: -1 });
// Bodies may carry one-time links; the log keeps them for 90 days.
EmailLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600, name: 'email_log_ttl' });
