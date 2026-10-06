import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { DiscountType } from '../common/enums';

export type AreaDocument = HydratedDocument<Area>;
export type OfferTypeConfigDocument = HydratedDocument<OfferTypeConfig>;
export type SiteContentDocument = HydratedDocument<SiteContent>;
export type HelpPageDocument = HydratedDocument<HelpPage>;

/** A city or area with its own page (/takeaways/{slug}). */
@Schema({ timestamps: true })
export class Area {
  @Prop({ required: true, trim: true })
  name: string;

  // Lower-case town name, as in the URL
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug: string;

  @Prop()
  icon?: string;

  @Prop({ default: 0 })
  sortOrder: number;

  @Prop()
  seoText?: string;

  // Postcode districts the area covers, e.g. M1, M14
  @Prop({ type: [String], default: [] })
  postcodeDistricts: string[];

  @Prop({ default: true })
  active: boolean;
}

export const AreaSchema = SchemaFactory.createForClass(Area);

/** Labels, icons and order for the fixed offer types the editor offers. */
@Schema({ timestamps: true, collection: 'offertypes' })
export class OfferTypeConfig {
  @Prop({ type: String, enum: Object.values(DiscountType), required: true, unique: true })
  key: DiscountType;

  @Prop({ required: true })
  label: string;

  @Prop()
  icon?: string;

  @Prop({ default: 0 })
  sortOrder: number;

  // Shown in the business's offer editor
  @Prop({ default: true })
  active: boolean;
}

export const OfferTypeConfigSchema = SchemaFactory.createForClass(OfferTypeConfig);

/**
 * Editable site content by key: "home" (featured takeaways, top picks, flash deals; each manual or auto),
 * "faqs" and "banners".
 */
@Schema({ timestamps: true })
export class SiteContent {
  @Prop({ required: true, unique: true })
  key: string;

  @Prop({ type: Object, default: {} })
  value: Record<string, unknown>;
}

export const SiteContentSchema = SchemaFactory.createForClass(SiteContent);

@Schema({ timestamps: true })
export class HelpPage {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ required: true })
  title: string;

  // Plain text with blank lines between paragraphs
  @Prop({ default: '' })
  body: string;

  @Prop({ default: true })
  published: boolean;

  @Prop({ default: 0 })
  sortOrder: number;
}

export const HelpPageSchema = SchemaFactory.createForClass(HelpPage);
