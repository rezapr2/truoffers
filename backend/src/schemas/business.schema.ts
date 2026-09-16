import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { BusinessStatus, VerificationStatus } from '../common/enums';

export type BusinessDocument = HydratedDocument<Business>;

@Schema({ _id: false })
export class GeoPoint {
  @Prop({ type: String, enum: ['Point'], default: 'Point' })
  type: string;

  // [lng, lat]
  @Prop({ type: [Number], required: true })
  coordinates: number[];
}

@Schema({ _id: false })
export class OpeningHours {
  @Prop() monday?: string;
  @Prop() tuesday?: string;
  @Prop() wednesday?: string;
  @Prop() thursday?: string;
  @Prop() friday?: string;
  @Prop() saturday?: string;
  @Prop() sunday?: string;
}

@Schema({ _id: false })
export class ReviewsCache {
  @Prop({ default: 'google' })
  provider: string;

  @Prop({ default: 0 })
  rating: number;

  @Prop({ default: 0 })
  count: number;

  @Prop()
  lastSync?: Date;
}

// Set when a listing was created from an imported website; drives the public "Imported from" notice.
@Schema({ _id: false })
export class ImportSource {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'ScrapedWebsite', required: true })
  scrapedWebsiteRef: Types.ObjectId;

  @Prop({ required: true })
  domain: string;

  @Prop({ type: Date, required: true })
  importedAt: Date;

  @Prop({ type: Date })
  lastCheckedAt?: Date;
}

@Schema({ timestamps: true })
export class Business {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true })
  slug: string;

  @Prop()
  description?: string;

  @Prop({ type: String, enum: Object.values(BusinessStatus), default: BusinessStatus.ACTIVE })
  status: BusinessStatus;

  @Prop({
    type: String,
    enum: Object.values(VerificationStatus),
    default: VerificationStatus.UNCLAIMED,
  })
  verificationStatus: VerificationStatus;

  @Prop({ default: 0 })
  trustScore: number;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  ownerId?: Types.ObjectId;

  @Prop({ type: [SchemaTypes.ObjectId], ref: 'Category', default: [] })
  categories: Types.ObjectId[];

  // Primary location (MVP: single location; multi-branch in V2)
  @Prop()
  address?: string;

  @Prop({ required: true, uppercase: true, trim: true })
  postcode: string;

  // Outward code, e.g. "M14" — used for area search
  @Prop({ uppercase: true, index: true })
  postcodeArea?: string;

  @Prop({ index: true })
  town?: string;

  @Prop({ type: GeoPoint })
  location?: GeoPoint;

  @Prop()
  phone?: string;

  @Prop()
  email?: string;

  @Prop()
  website?: string;

  // Direct ordering link (Foodbell or own site)
  @Prop()
  orderUrl?: string;

  @Prop({ default: false })
  isFoodbellClient: boolean;

  @Prop({ type: OpeningHours })
  openingHours?: OpeningHours;

  @Prop()
  logoUrl?: string;

  @Prop()
  coverUrl?: string;

  @Prop({ type: [String], default: [] })
  photos: string[];

  @Prop({ type: ReviewsCache, default: () => ({}) })
  reviews: ReviewsCache;

  // Google Places ID — resolved automatically on first review sync
  @Prop()
  googlePlaceId?: string;

  @Prop({ default: 0 })
  followerCount: number;

  // Denormalised for list cards
  @Prop({ default: 0 })
  activeOfferCount: number;

  @Prop({ default: false })
  featured: boolean;

  // ---- Normalised identity, derived from name/phone/postcode/website (see common/business-identity.ts) ----

  @Prop({ index: true })
  phoneE164?: string;

  @Prop()
  postcodeCanonical?: string;

  @Prop()
  nameNormalized?: string;

  @Prop({ index: true })
  websiteHost?: string;

  @Prop({ type: ImportSource })
  importSource?: ImportSource;
}

export const BusinessSchema = SchemaFactory.createForClass(Business);
BusinessSchema.index({ location: '2dsphere' });
BusinessSchema.index({ name: 'text', description: 'text' });
// Phone is deliberately not unique: branches of one takeaway often share an ordering line.
BusinessSchema.index(
  { postcodeCanonical: 1, nameNormalized: 1 },
  {
    unique: true,
    partialFilterExpression: {
      postcodeCanonical: { $type: 'string' },
      nameNormalized: { $type: 'string' },
    },
  },
);
