import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RedemptionDocument = HydratedDocument<Redemption>;

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Redemption {
  @Prop({ type: Types.ObjectId, ref: 'Offer', required: true, index: true })
  offerId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  customerId?: Types.ObjectId;

  @Prop()
  sessionId?: string;

  @Prop()
  code?: string;

  // code_copy | show_screen | link | qr | phone
  @Prop({ default: 'code_copy' })
  channel: string;

  @Prop({ default: 0 })
  orderValue: number;
}

export const RedemptionSchema = SchemaFactory.createForClass(Redemption);
