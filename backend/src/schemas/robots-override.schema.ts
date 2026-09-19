import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';

// Consent to read websites despite their robots.txt, recorded by a super admin. On a website it is the owner's
// consent; on a provider policy it rests on the provider's written agreement. Everything else in the crawl gate
// still applies.
@Schema({ _id: false })
export class RobotsOverride {
  // Who agreed, how, and when, in the admin's words.
  @Prop({ required: true, minlength: 10, maxlength: 500 }) note: string;
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true }) recordedBy: Types.ObjectId;
  @Prop({ required: true }) recordedAt: Date;
}
export const RobotsOverrideSchema = SchemaFactory.createForClass(RobotsOverride);
