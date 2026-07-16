import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WalletTransactionDocument = HydratedDocument<WalletTransaction>;

@Schema({ timestamps: true })
export class WalletTransaction {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ type: String, enum: ['topup', 'spend', 'refund'], required: true })
  type: string;

  @Prop({ required: true })
  amount: number;

  @Prop()
  note?: string;
}

export const WalletTransactionSchema = SchemaFactory.createForClass(WalletTransaction);
