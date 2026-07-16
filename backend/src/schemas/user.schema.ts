import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { Role } from '../common/enums';

export type UserDocument = HydratedDocument<User>;

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

  @Prop({ type: String, enum: Object.values(Role), default: Role.CUSTOMER })
  role: Role;

  @Prop({ default: 'active' })
  status: string;

  // Customer profile fields
  @Prop()
  postcode?: string;

  @Prop({ type: [String], default: [] })
  favouriteCuisines: string[];

  @Prop({ type: [{ type: String }], default: [] })
  savedOffers: string[];

  @Prop({ type: [{ type: String }], default: [] })
  followedBusinesses: string[];
}

export const UserSchema = SchemaFactory.createForClass(User);
