import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AnalyticsEventDocument = HydratedDocument<AnalyticsEvent>;

// Event taxonomy per section 16.2 of the blueprint:
// page_view, postcode_search, filter_apply, offer_impression, offer_flip,
// offer_detail_view, business_profile_view, order_click, call_click,
// directions_click, redeem_click, qr_scan, claim_start, claim_complete,
// offer_created, upgrade_click, subscription_start, supplier_lead_submit
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class AnalyticsEvent {
  @Prop({ required: true, index: true })
  eventName: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  userId?: Types.ObjectId;

  @Prop({ index: true })
  sessionId?: string;

  @Prop({ type: Types.ObjectId, index: true })
  businessId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, index: true })
  offerId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  supplierId?: Types.ObjectId;

  @Prop()
  postcodeArea?: string;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const AnalyticsEventSchema = SchemaFactory.createForClass(AnalyticsEvent);
AnalyticsEventSchema.index({ eventName: 1, createdAt: -1 });
AnalyticsEventSchema.index({ businessId: 1, eventName: 1, createdAt: -1 });
