import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type LoginEventDocument = HydratedDocument<LoginEvent>;

// Login history shown on a user in /admin/users.
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class LoginEvent {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', index: true })
  userId?: Types.ObjectId;

  @Prop({ lowercase: true })
  email?: string;

  @Prop({ required: true })
  success: boolean;

  // password | google | apple | 2fa | impersonation
  @Prop({ required: true })
  method: string;

  // Why a failed attempt failed: bad_password, banned, bad_2fa_code, ...
  @Prop()
  reason?: string;

  @Prop()
  ip?: string;

  @Prop()
  userAgent?: string;
}

export const LoginEventSchema = SchemaFactory.createForClass(LoginEvent);
LoginEventSchema.index({ userId: 1, createdAt: -1 });
// Kept for a year.
LoginEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 3600, name: 'login_event_ttl' });
