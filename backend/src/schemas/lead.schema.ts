import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { LeadStatus } from '../common/enums';

export type LeadDocument = HydratedDocument<Lead>;

@Schema({ timestamps: true })
export class Lead {
  @Prop({ type: Types.ObjectId, ref: 'Supplier', required: true, index: true })
  supplierId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  fromUserId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Business' })
  fromBusinessId?: Types.ObjectId;

  @Prop({ required: true })
  contactName: string;

  @Prop({ required: true })
  contactEmail: string;

  @Prop()
  contactPhone?: string;

  @Prop({ required: true })
  message: string;

  // quote_request | enquiry | callback
  @Prop({ default: 'enquiry' })
  type: string;

  @Prop({ type: String, enum: Object.values(LeadStatus), default: LeadStatus.NEW })
  status: LeadStatus;

  @Prop({ default: 0 })
  valueEstimate: number;
}

export const LeadSchema = SchemaFactory.createForClass(Lead);
