import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { BusinessMemberRole, BusinessSource, BusinessStatus, VerificationLevel } from '../common/enums';

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

// One person on the business's team. Owners can buy plans, promote and manage the team; staff run offers and the profile.
@Schema({ _id: false })
export class BusinessMember {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(BusinessMemberRole), required: true })
  role: BusinessMemberRole;

  @Prop({ type: Date, default: () => new Date() })
  addedAt: Date;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  invitedBy?: Types.ObjectId;
}
export const BusinessMemberSchema = SchemaFactory.createForClass(BusinessMember);

@Schema({ _id: false })
export class SocialLinks {
  @Prop() facebook?: string;
  @Prop() instagram?: string;
  @Prop() tiktok?: string;
  @Prop() x?: string;
}

// A moderator's suggestion, or three upheld reports in 90 days: a super admin or admin decides.
@Schema({ _id: false })
export class SuspensionReview {
  @Prop({ type: Date, required: true }) flaggedAt: Date;
  @Prop({ required: true }) reason: string;
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' }) flaggedBy?: Types.ObjectId;
  @Prop({ type: Date }) resolvedAt?: Date;
  @Prop() resolution?: string;
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

  // 0 unclaimed, 1 claim pending, 2 verified, 3 verified plus (see VerificationLevel). Only a moderator reaches 2.
  @Prop({ type: Number, enum: [0, 1, 2, 3], default: VerificationLevel.UNCLAIMED, index: true })
  verificationLevel: VerificationLevel;

  @Prop({ type: Date })
  verifiedAt?: Date;

  // Twelve months after verification the owner is asked to verify again; the badge stays meanwhile.
  @Prop({ type: Date })
  reverificationDueAt?: Date;

  @Prop({ type: Date })
  reverificationNotifiedAt?: Date;

  // A second person passed the phone check while the listing had an owner: edits wait for an admin.
  @Prop({ default: false })
  frozen: boolean;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Claim' })
  disputeClaimId?: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(BusinessSource), default: BusinessSource.ADMIN })
  source: BusinessSource;

  @Prop({ default: 0 })
  trustScore: number;

  // The primary owner (who claimed it). The whole team, owners included, is in `members`.
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  ownerId?: Types.ObjectId;

  @Prop({ type: [BusinessMemberSchema], default: [] })
  members: BusinessMember[];

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

  // Shown as the separate "Foodbell partner" tag; never stands in for TruOffers verification.
  @Prop({ default: false })
  isFoodbellClient: boolean;

  @Prop({ default: true })
  delivery: boolean;

  @Prop({ default: true })
  collection: boolean;

  @Prop({ type: SocialLinks, default: () => ({}) })
  socialLinks: SocialLinks;

  // An uploaded PDF menu, as well as or instead of menu sections
  @Prop()
  menuPdfUrl?: string;

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

  // ---- Food Hygiene Rating Scheme, matched during verification ----
  @Prop()
  fhrsId?: string;

  @Prop()
  fhrsRating?: string;

  // ---- Admin ----

  @Prop({ type: Date })
  suspendedAt?: Date;

  @Prop()
  suspensionReason?: string;

  @Prop({ type: SuspensionReview })
  suspensionReview?: SuspensionReview;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Business' })
  mergedInto?: Types.ObjectId;

  @Prop()
  stripeCustomerId?: string;
}

export const BusinessSchema = SchemaFactory.createForClass(Business);
BusinessSchema.index({ location: '2dsphere' });
BusinessSchema.index({ name: 'text', description: 'text' });
BusinessSchema.index({ 'members.userId': 1 });
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
