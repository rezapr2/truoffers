import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type MenuItemDocument = HydratedDocument<MenuItem>;

@Schema({ timestamps: true })
export class MenuItem {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Business', required: true, index: true })
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

  // Set on items mirrored from the business's ordering platform ("foodbell"); owners' own items have none.
  @Prop()
  source?: string;
}

export const MenuItemSchema = SchemaFactory.createForClass(MenuItem);
