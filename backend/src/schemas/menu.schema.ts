import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MenuItemDocument = HydratedDocument<MenuItem>;

@Schema({ timestamps: true })
export class MenuItem {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop()
  description?: string;

  @Prop({ required: true })
  price: number;

  // Menu section, e.g. "Pizzas", "Sides", "Drinks"
  @Prop({ default: 'Menu' })
  section: string;

  @Prop()
  imageUrl?: string;

  @Prop({ default: 0 })
  sortOrder: number;
}

export const MenuItemSchema = SchemaFactory.createForClass(MenuItem);
