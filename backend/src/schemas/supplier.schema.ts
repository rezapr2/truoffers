import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { VerificationStatus } from '../common/enums';

export type SupplierDocument = HydratedDocument<Supplier>;

@Schema({ timestamps: true })
export class Supplier {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true })
  slug: string;

  @Prop()
  description?: string;

  // e.g. packaging, epos, accounting, recruitment, delivery
  @Prop({ required: true, index: true })
  category: string;

  @Prop({ default: 'UK-wide' })
  serviceArea: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  ownerId?: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(VerificationStatus),
    default: VerificationStatus.UNCLAIMED,
  })
  verificationStatus: VerificationStatus;

  @Prop()
  phone?: string;

  @Prop()
  email?: string;

  @Prop()
  website?: string;

  @Prop()
  logoUrl?: string;

  @Prop({ default: false })
  featured: boolean;

  @Prop({ default: 0 })
  leadCount: number;
}

export const SupplierSchema = SchemaFactory.createForClass(Supplier);
