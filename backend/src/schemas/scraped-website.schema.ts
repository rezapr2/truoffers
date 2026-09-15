import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  AuthorisationSource,
  BranchMatchStatus,
  DomainAuthorisationStatus,
  FingerprintMatchCategory,
  MarkerCategory,
  RobotsStatus,
} from '../common/scraper.enums';
import type { FieldEvidence } from '../scraper/extraction/adapter.types';

export type ScrapedWebsiteDocument = HydratedDocument<ScrapedWebsite>;

// Business details as found on the website, kept so a reviewer can compare them with the matched listing.
@Schema({ _id: false })
export class ExtractedBusinessSnapshot {
  @Prop() name?: string;
  @Prop() telephone?: string;
  @Prop() phoneE164?: string;
  @Prop() address?: string;
  @Prop() postcode?: string;
  @Prop() town?: string;
  @Prop() website?: string;
  @Prop() orderUrl?: string;
  @Prop() sourceUrl?: string;

  @Prop({ type: Object, default: {} })
  evidence: Record<string, FieldEvidence>;
}
export const ExtractedBusinessSnapshotSchema = SchemaFactory.createForClass(ExtractedBusinessSnapshot);

@Schema({ _id: false })
export class MatchSuggestion {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true })
  businessRef: Types.ObjectId;

  @Prop({ required: true })
  score: number;

  @Prop({ type: [String], default: [] })
  signals: string[];
}
export const MatchSuggestionSchema = SchemaFactory.createForClass(MatchSuggestion);

@Schema({ _id: false })
export class WebsiteBranch {
  // "/" for single-location sites, the branch page path, or "/@<POSTCODE>" for branches listed on a shared page.
  @Prop({ required: true })
  branchPath: string;

  @Prop()
  branchLabel?: string;

  @Prop({ type: Types.ObjectId, ref: 'Business' })
  businessRef?: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(BranchMatchStatus), required: true })
  matchStatus: BranchMatchStatus;

  @Prop()
  matchScore?: number;

  @Prop({ type: [String], default: [] })
  matchSignals: string[];

  @Prop({ type: [MatchSuggestionSchema], default: [] })
  suggestions: MatchSuggestion[];

  @Prop({ type: ExtractedBusinessSnapshotSchema })
  extracted?: ExtractedBusinessSnapshot;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  decidedBy?: Types.ObjectId;

  @Prop({ type: Date })
  decidedAt?: Date;

  @Prop({ type: Date })
  lastSeenAt?: Date;
}
export const WebsiteBranchSchema = SchemaFactory.createForClass(WebsiteBranch);

@Schema({ _id: false })
export class RobotsInfo {
  @Prop({ type: String, enum: Object.values(RobotsStatus) })
  status?: RobotsStatus;

  @Prop()
  crawlDelaySec?: number;

  @Prop({ type: Date })
  fetchedAt?: Date;
}
export const RobotsInfoSchema = SchemaFactory.createForClass(RobotsInfo);

// Structural traits read from the site's homepage, kept so fingerprints can be matched without refetching.
@Schema({ _id: false })
export class SiteMarkerRecord {
  @Prop({ type: String, enum: Object.values(MarkerCategory), required: true }) category: MarkerCategory;
  @Prop({ required: true }) value: string;
}
export const SiteMarkerRecordSchema = SchemaFactory.createForClass(SiteMarkerRecord);

@Schema({ timestamps: true })
export class ScrapedWebsite {
  // Normalised host: lowercase, punycode, no "www." — one document per domain.
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  domain: string;

  @Prop({ required: true, index: true })
  registrableDomain: string;

  @Prop({ required: true })
  seedUrl: string;

  @Prop({ type: String, enum: Object.values(DomainAuthorisationStatus), required: true, index: true })
  authorisationStatus: DomainAuthorisationStatus;

  @Prop({ type: String, enum: Object.values(AuthorisationSource), required: true })
  authorisationSource: AuthorisationSource;

  @Prop()
  authorisationNote?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  authorisedBy?: Types.ObjectId;

  @Prop({ type: Date })
  authorisedAt?: Date;

  // Domain whose pages linked here (discovered domains only).
  @Prop()
  discoveredFrom?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  submittedBy?: Types.ObjectId;

  @Prop()
  batchId?: string;

  @Prop({ type: Types.ObjectId, ref: 'ProviderPolicy', index: true })
  providerRef?: Types.ObjectId;

  @Prop({ type: [String], default: [] })
  providerSignals: string[];

  @Prop()
  adapterId?: string;

  @Prop()
  adapterVersion?: string;

  @Prop({ type: RobotsInfoSchema })
  robots?: RobotsInfo;

  @Prop({ type: [WebsiteBranchSchema], default: [] })
  businesses: WebsiteBranch[];

  @Prop({ type: Date })
  lastSuccessfulCheckAt?: Date;

  @Prop({ type: Date })
  lastFailedCheckAt?: Date;

  @Prop()
  lastError?: string;

  @Prop({ default: 0 })
  failureCount: number;

  @Prop({ type: Date })
  nextCheckAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'ImportJob' })
  lastRunRef?: Types.ObjectId;

  // Phase 2: template fingerprinting and authorised networks.
  @Prop({ type: [SiteMarkerRecordSchema], default: undefined })
  siteMarkers?: SiteMarkerRecord[];

  @Prop({ type: Date })
  markersExtractedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'WebsiteFingerprint', index: true })
  fingerprintRef?: Types.ObjectId;

  @Prop()
  matchScore?: number;

  @Prop({ type: String, enum: Object.values(FingerprintMatchCategory) })
  matchCategory?: FingerprintMatchCategory;

  @Prop({ type: Date })
  fingerprintMatchedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'AuthorisedNetwork', index: true })
  networkRef?: Types.ObjectId;
}

export const ScrapedWebsiteSchema = SchemaFactory.createForClass(ScrapedWebsite);
ScrapedWebsiteSchema.index({ 'businesses.businessRef': 1 });
ScrapedWebsiteSchema.index({ 'businesses.matchStatus': 1 });
ScrapedWebsiteSchema.index({ authorisationStatus: 1, updatedAt: -1 });
