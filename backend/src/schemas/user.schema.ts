import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { Role } from '../common/enums';

export type UserDocument = HydratedDocument<User>;

export enum UserStatus {
  ACTIVE = 'active',
  BANNED = 'banned',
  // GDPR erasure: the record stays (audit trails point at it) but holds no personal data
  DELETED = 'deleted',
}

@Schema({ _id: false })
export class TwoFactor {
  @Prop({ default: false }) enabled: boolean;
  // TOTP secret, encrypted like the settings secrets
  @Prop({ select: false }) secretEnc?: string;
  // Set during enrolment, moved to secretEnc once a code from it has been entered
  @Prop({ select: false }) pendingSecretEnc?: string;
  @Prop({ type: Date }) enrolledAt?: Date;
  // The last accepted time step, so a code can't be replayed
  @Prop({ select: false }) lastStep?: number;
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop()
  phone?: string;

  // Optional: social-login users have no password
  @Prop({ select: false })
  passwordHash?: string;

  // local | google | apple
  @Prop({ default: 'local' })
  provider: string;

  @Prop()
  providerId?: string;

  // The account type. Rights over a business come from its team (Business.members), not from this.
  @Prop({ type: String, enum: Object.values(Role), default: Role.CUSTOMER })
  role: Role;

  @Prop({ type: String, enum: Object.values(UserStatus), default: UserStatus.ACTIVE })
  status: UserStatus;

  @Prop({ type: Date })
  emailVerifiedAt?: Date;

  @Prop({ select: false })
  emailVerifyTokenHash?: string;

  @Prop({ type: Date, select: false })
  emailVerifyExpires?: Date;

  @Prop({ select: false })
  passwordResetTokenHash?: string;

  @Prop({ type: Date, select: false })
  passwordResetExpires?: Date;

  // Sessions issued before this stop working (password reset, ban lifted, 2FA reset)
  @Prop({ type: Date })
  sessionsValidAfter?: Date;

  @Prop({ type: TwoFactor, default: () => ({}) })
  twoFactor: TwoFactor;

  @Prop({ type: Date })
  lastLoginAt?: Date;

  @Prop({ type: Date })
  bannedAt?: Date;

  @Prop()
  banReason?: string;

  @Prop({ type: Date })
  deletedAt?: Date;

  // Customer profile fields
  @Prop()
  postcode?: string;

  @Prop({ type: [String], default: [] })
  favouriteCuisines: string[];

  @Prop({ type: [{ type: String }], default: [] })
  savedOffers: string[];

  @Prop({ type: [{ type: String }], default: [] })
  followedBusinesses: string[];

  // Email alerts when a followed takeaway posts an offer
  @Prop({ default: true })
  offerAlerts: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ role: 1 });
UserSchema.index({ followedBusinesses: 1 });
