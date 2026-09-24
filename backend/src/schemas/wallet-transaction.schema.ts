import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type WalletTransactionDocument = HydratedDocument<WalletTransaction>;

@Schema({ timestamps: true })
export class WalletTransaction {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ type: String, enum: ['topup', 'spend', 'refund'], required: true })
  type: string;

  @Prop({ required: true })
  amount: number;

  @Prop()
  note?: string;

  // The payment a top-up came from (a Stripe Checkout Session id): unique, so a redelivered webhook credits once.
  @Prop()
  reference?: string;
}

export const WalletTransactionSchema = SchemaFactory.createForClass(WalletTransaction);
WalletTransactionSchema.index(
  { reference: 1 },
  { unique: true, partialFilterExpression: { reference: { $type: 'string' } } },
);
