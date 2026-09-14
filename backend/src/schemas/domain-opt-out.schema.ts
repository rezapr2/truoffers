import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { OptOutSource } from '../common/scraper.enums';

export type DomainOptOutDocument = HydratedDocument<DomainOptOut>;

@Schema({ _id: false })
export class OptOutRequester {
  @Prop() name?: string;
  @Prop() email?: string;
}
export const OptOutRequesterSchema = SchemaFactory.createForClass(OptOutRequester);

@Schema({ _id: false })
export class OptOutListing {
  @Prop({ type: Types.ObjectId, ref: 'Offer' }) offerId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Business' }) businessId?: Types.ObjectId;
}
export const OptOutListingSchema = SchemaFactory.createForClass(OptOutListing);

// Covers the domain and all of its subdomains.
@Schema({ timestamps: true })
export class DomainOptOut {
  @Prop({ required: true, lowercase: true, trim: true, index: true })
  domain: string;

  @Prop()
  reason?: string;

  @Prop({ type: String, enum: Object.values(OptOutSource), required: true })
  source: OptOutSource;

  @Prop({ type: OptOutRequesterSchema })
  requestedBy?: OptOutRequester;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: OptOutListingSchema })
  relatedListing?: OptOutListing;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  acknowledgedBy?: Types.ObjectId;

  @Prop({ type: Date })
  acknowledgedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  liftedBy?: Types.ObjectId;

  @Prop({ type: Date })
  liftedAt?: Date;

  // Equals domain until the opt-out is lifted, so only one active opt-out exists per domain.
  @Prop()
  activeKey?: string;
}

export const DomainOptOutSchema = SchemaFactory.createForClass(DomainOptOut);
DomainOptOutSchema.index(
  { activeKey: 1 },
  { unique: true, partialFilterExpression: { activeKey: { $type: 'string' } } },
);
DomainOptOutSchema.index({ source: 1, acknowledgedAt: 1, createdAt: -1 });
