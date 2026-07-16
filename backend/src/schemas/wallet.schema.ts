import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WalletDocument = HydratedDocument<Wallet>;

// Ad wallet: prepaid balance (GBP) spent on promoted placements.
@Schema({ timestamps: true })
export class Wallet {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, unique: true })
  businessId: Types.ObjectId;

  @Prop({ default: 0 })
  balance: number;

  @Prop({ default: 0 })
  totalToppedUp: number;

  @Prop({ default: 0 })
  totalSpent: number;
}

export const WalletSchema = SchemaFactory.createForClass(Wallet);
