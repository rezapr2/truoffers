import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { RobotsStatus } from '../common/scraper.enums';

export type RobotsCacheDocument = HydratedDocument<RobotsCache>;

// robots.txt per origin (scheme + host + port), per RFC 9309.
@Schema()
export class RobotsCache {
  @Prop({ required: true, unique: true })
  origin: string;

  @Prop({ required: true })
  domain: string;

  @Prop({ type: String, enum: Object.values(RobotsStatus), required: true })
  status: RobotsStatus;

  // Raw rules (capped at 500 KiB); empty when unavailable/unreachable.
  @Prop({ default: '' })
  rules: string;

  @Prop()
  httpStatus?: number;

  @Prop({ type: Date, required: true })
  fetchedAt: Date;

  @Prop({ type: Date, required: true })
  expiresAt: Date;
}

export const RobotsCacheSchema = SchemaFactory.createForClass(RobotsCache);
RobotsCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
