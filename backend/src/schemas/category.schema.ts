import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type CategoryDocument = HydratedDocument<Category>;

// A cuisine. Edited in /admin/taxonomy.
@Schema({ timestamps: true })
export class Category {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true })
  slug: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Category' })
  parentId?: Types.ObjectId;

  @Prop({ default: 0 })
  businessCount: number;

  // The icon shown on tiles: an emoji
  @Prop()
  emoji?: string;

  @Prop({ default: 0 })
  sortOrder: number;

  // Intro text for the cuisine's pages (SEO)
  @Prop()
  seoText?: string;

  @Prop({ default: true })
  active: boolean;
}

export const CategorySchema = SchemaFactory.createForClass(Category);
