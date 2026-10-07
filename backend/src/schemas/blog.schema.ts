import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type BlogPostDocument = HydratedDocument<BlogPost>;

/** Blog posts written in the admin panel (Content → Blog). The body is plain text like help pages. */
@Schema({ timestamps: true, collection: 'blogposts' })
export class BlogPost {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ required: true, trim: true })
  title: string;

  // The summary on the blog index and in search results
  @Prop({ default: '' })
  excerpt: string;

  @Prop({ default: '' })
  body: string;

  @Prop()
  coverUrl?: string;

  // e.g. "City guides", "For owners"
  @Prop({ type: [String], default: [] })
  tags: string[];

  // draft | published
  @Prop({ default: 'draft', index: true })
  status: string;

  @Prop({ type: Date, index: true })
  publishedAt?: Date;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  authorId?: Types.ObjectId;

  @Prop()
  authorName?: string;

  @Prop()
  seoTitle?: string;

  @Prop()
  seoDescription?: string;
}

export const BlogPostSchema = SchemaFactory.createForClass(BlogPost);
BlogPostSchema.index({ status: 1, publishedAt: -1 });
