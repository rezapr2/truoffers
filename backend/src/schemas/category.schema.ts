import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CategoryDocument = HydratedDocument<Category>;

@Schema({ timestamps: true })
export class Category {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true })
  slug: string;

  @Prop({ type: Types.ObjectId, ref: 'Category' })
  parentId?: Types.ObjectId;

  @Prop({ default: 0 })
  businessCount: number;

  @Prop()
  emoji?: string;
}

export const CategorySchema = SchemaFactory.createForClass(Category);
