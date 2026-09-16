import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { ProviderPolicyBasis } from '../common/scraper.enums';

export type AuthorisedNetworkDocument = HydratedDocument<AuthorisedNetwork>;

/**
 * A group of websites an admin is authorised to crawl because a provider (or other party) publishes
 * the list, e.g. an ordering platform's client sitemap under a data-sharing agreement. Domains listed in
 * its sitemaps are registered as authorised; domains merely linked from them stay pending.
 */
@Schema({ timestamps: true })
export class AuthorisedNetwork {
  @Prop({ required: true, unique: true, trim: true })
  name: string;

  @Prop({ type: [String], default: [] })
  sitemapUrls: string[];

  @Prop({ type: String, enum: Object.values(ProviderPolicyBasis), required: true })
  basis: ProviderPolicyBasis;

  @Prop({ trim: true })
  agreementReference?: string;

  @Prop()
  basisNotes?: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'ProviderPolicy' })
  providerRef?: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  registeredBy?: Types.ObjectId;

  @Prop({ default: true })
  active: boolean;

  @Prop({ type: Date })
  lastDiscoveredAt?: Date;

  @Prop({ default: 0 })
  domainsRegistered: number;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'ImportJob' })
  lastJobRef?: Types.ObjectId;
}

export const AuthorisedNetworkSchema = SchemaFactory.createForClass(AuthorisedNetwork);

AuthorisedNetworkSchema.pre('validate', function (next) {
  if (this.basis === ProviderPolicyBasis.WRITTEN_AGREEMENT && !this.agreementReference?.trim()) {
    return next(new Error('A written agreement basis needs an agreement reference'));
  }
  if (this.basis === ProviderPolicyBasis.TERMS_REVIEW && !this.basisNotes?.trim()) {
    return next(new Error('A terms review basis needs notes describing the review'));
  }
  if (this.sitemapUrls.length === 0) return next(new Error('Add at least one sitemap URL'));
  next();
});
