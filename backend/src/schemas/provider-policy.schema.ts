import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { ProviderPolicyBasis, ProviderPolicyStatus } from '../common/scraper.enums';

export type ProviderPolicyDocument = HydratedDocument<ProviderPolicy>;

// How a site is recognised as hosted by this provider. Patterns are plain case-insensitive substrings, never regex.
@Schema({ _id: false })
export class ProviderDetection {
  @Prop({ type: [String], default: [] }) hostSuffixes: string[];
  @Prop({ type: [String], default: [] }) cnameSuffixes: string[];
  @Prop({ type: [String], default: [] }) footerPatterns: string[];
  @Prop({ type: [String], default: [] }) generatorPatterns: string[];
  @Prop({ type: [String], default: [] }) assetHosts: string[];
}
export const ProviderDetectionSchema = SchemaFactory.createForClass(ProviderDetection);

@Schema({ timestamps: true })
export class ProviderPolicy {
  @Prop({ required: true, unique: true, trim: true })
  name: string;

  @Prop({ type: String, enum: Object.values(ProviderPolicyStatus), default: ProviderPolicyStatus.UNKNOWN })
  status: ProviderPolicyStatus;

  @Prop({ type: String, enum: Object.values(ProviderPolicyBasis) })
  basis?: ProviderPolicyBasis;

  @Prop({ trim: true })
  agreementReference?: string;

  @Prop()
  basisNotes?: string;

  @Prop({ type: ProviderDetectionSchema, default: () => ({}) })
  detection: ProviderDetection;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  reviewedBy?: Types.ObjectId;

  @Prop({ type: Date })
  reviewedAt?: Date;

  // Created by the crawler when it met an unrecognised provider; always starts as unknown.
  @Prop({ default: false })
  autoCreated: boolean;
}

export const ProviderPolicySchema = SchemaFactory.createForClass(ProviderPolicy);

// Spec §2.3: a provider is allowed only with a recorded basis. Enforced here so no code path can skip it.
ProviderPolicySchema.pre('validate', function (next) {
  if (this.status !== ProviderPolicyStatus.ALLOWED) return next();
  if (!this.basis) {
    return next(new Error('An allowed provider needs a recorded basis'));
  }
  if (this.basis === ProviderPolicyBasis.WRITTEN_AGREEMENT && !this.agreementReference?.trim()) {
    return next(new Error('A written agreement basis needs an agreement reference'));
  }
  if (this.basis === ProviderPolicyBasis.TERMS_REVIEW && !this.basisNotes?.trim()) {
    return next(new Error('A terms review basis needs notes describing the review'));
  }
  next();
});
