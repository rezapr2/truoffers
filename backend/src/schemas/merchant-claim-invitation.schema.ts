import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type MerchantClaimInvitationDocument = HydratedDocument<MerchantClaimInvitation>;

// One attempt to reach the business, recorded so admins can see who was contacted and how.
@Schema({ _id: false })
export class OutreachContact {
  @Prop({ required: true }) channel: string;
  @Prop({ type: Date, required: true }) at: Date;
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' }) by?: Types.ObjectId;
  @Prop() note?: string;
}
export const OutreachContactSchema = SchemaFactory.createForClass(OutreachContact);

/**
 * Spec §14: an invitation for a takeaway to claim the listing its imported offers are on. The token is stored
 * only as a hash, so the claim link exists in the messages an admin copies, never in the database. Following
 * the link pre-selects the business; ownership still goes through the normal claim verification.
 */
@Schema({ timestamps: true })
export class MerchantClaimInvitation {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Business', required: true, index: true })
  businessRef: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'ScrapedWebsite' })
  scrapedWebsiteRef?: Types.ObjectId;

  @Prop()
  domain?: string;

  @Prop({ required: true, unique: true })
  tokenHash: string;

  // The first characters of the token, so an admin can tell two invitations apart without the link.
  @Prop({ required: true })
  tokenHint: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  generatedBy?: Types.ObjectId;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop({ type: Date })
  claimedAt?: Date;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  claimedBy?: Types.ObjectId;

  @Prop({ type: Date })
  revokedAt?: Date;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  revokedBy?: Types.ObjectId;

  @Prop({ type: [OutreachContactSchema], default: [] })
  contacts: OutreachContact[];
}

export const MerchantClaimInvitationSchema = SchemaFactory.createForClass(MerchantClaimInvitation);
MerchantClaimInvitationSchema.index({ businessRef: 1, createdAt: -1 });
