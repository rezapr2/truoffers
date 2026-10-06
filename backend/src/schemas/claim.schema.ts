import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { ClaimDocumentType, ClaimKind, ClaimMethod, ClaimRejectReason, ClaimStatus } from '../common/enums';

export type ClaimDocument = HydratedDocument<Claim>;
export type ClaimFileDocument = HydratedDocument<ClaimFile>;

// Spec T2.3: a code by SMS or call to the number on the listing; 3 attempts, 10-minute expiry.
@Schema({ _id: false })
export class PhoneCheck {
  // The number the code went to (the listing's), E.164
  @Prop() phone?: string;
  @Prop() channel?: string;
  @Prop() mode?: string;
  @Prop({ select: false }) codeHash?: string;
  @Prop({ type: Date }) sentAt?: Date;
  @Prop({ type: Date }) expiresAt?: Date;
  @Prop({ default: 0 }) attempts: number;
  @Prop({ default: 0 }) sends: number;
  @Prop({ type: Date }) passedAt?: Date;
}

// Spec evidence 2: a code emailed to an address on the business's domain, or a meta tag / file on its website.
@Schema({ _id: false })
export class DomainCheck {
  @Prop() domain?: string;
  // email | meta | file
  @Prop() method?: string;
  @Prop() email?: string;
  @Prop({ select: false }) codeHash?: string;
  @Prop({ type: Date }) codeExpiresAt?: Date;
  @Prop({ default: 0 }) attempts: number;
  // The token the owner places on their website
  @Prop() siteToken?: string;
  @Prop({ type: Date }) passedAt?: Date;
  @Prop() lastError?: string;
}

// Spec evidence 4: the owner picks their Food Hygiene Rating listing; name and postcode must match.
@Schema({ _id: false })
export class FhrsCheck {
  @Prop() fhrsId?: string;
  @Prop() name?: string;
  @Prop() address?: string;
  @Prop() postcode?: string;
  @Prop() rating?: string;
  @Prop({ default: false }) nameMatches: boolean;
  @Prop({ default: false }) postcodeMatches: boolean;
  @Prop({ type: Date }) checkedAt?: Date;
}

// The moderator's checklist on the review screen.
@Schema({ _id: false })
export class ClaimChecklist {
  @Prop({ default: false }) detailsMatch: boolean;
  @Prop({ default: false }) documentValid: boolean;
  @Prop({ default: false }) orderLinkOk: boolean;
  @Prop({ default: false }) noOtherOwner: boolean;
  @Prop({ default: false }) notLinkedToSuspended: boolean;
}

@Schema({ _id: true, timestamps: { createdAt: true, updatedAt: false } })
export class ClaimMessage {
  // owner | moderator | system
  @Prop({ required: true }) from: string;
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' }) userId?: Types.ObjectId;
  @Prop({ required: true }) body: string;
  createdAt?: Date;
}
export const ClaimMessageSchema = SchemaFactory.createForClass(ClaimMessage);

@Schema({ timestamps: true })
export class Claim {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Business', required: true, index: true })
  businessId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(ClaimKind), default: ClaimKind.EXISTING })
  kind: ClaimKind;

  @Prop({ type: String, enum: Object.values(ClaimStatus), default: ClaimStatus.DRAFT, index: true })
  status: ClaimStatus;

  @Prop({ type: PhoneCheck, default: () => ({}) })
  phoneCheck: PhoneCheck;

  @Prop({ default: false })
  phoneOtpPassed: boolean;

  @Prop({ type: DomainCheck, default: () => ({}) })
  domainCheck: DomainCheck;

  @Prop({ default: false })
  domainCheckPassed: boolean;

  @Prop({ type: FhrsCheck })
  fhrs?: FhrsCheck;

  @Prop({ default: false })
  fhrsMatch: boolean;

  // Written on paper in the shop-front photo (evidence 5)
  @Prop()
  shopPhotoCode?: string;

  @Prop({ type: ClaimChecklist, default: () => ({}) })
  checklist: ClaimChecklist;

  @Prop({ type: [ClaimMessageSchema], default: [] })
  messages: ClaimMessage[];

  // The moderator working on it
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  assignedTo?: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  reviewerId?: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(ClaimRejectReason) })
  reasonCode?: ClaimRejectReason;

  // What the moderator told the owner
  @Prop()
  notes?: string;

  @Prop({ type: Date })
  submittedAt?: Date;

  @Prop({ type: Date })
  infoRequestedAt?: Date;

  // A claim waiting for more information closes on this date
  @Prop({ type: Date })
  expiresAt?: Date;

  @Prop({ type: Date })
  decidedAt?: Date;

  // When a dispute is opened against the current owner(s)
  @Prop({ type: [SchemaTypes.ObjectId], ref: 'User', default: undefined })
  disputedOwnerIds?: Types.ObjectId[];

  // ---- Claims filed before the MVP flow ----
  @Prop({ type: String, enum: Object.values(ClaimMethod) })
  method?: ClaimMethod;

  @Prop()
  evidence?: string;
}

export const ClaimSchema = SchemaFactory.createForClass(Claim);
ClaimSchema.index({ status: 1, submittedAt: 1 });
ClaimSchema.index({ businessId: 1, userId: 1, status: 1 });

/** An evidence document. Stored privately and deleted 90 days after the decision. */
@Schema({ timestamps: { createdAt: 'uploadedAt', updatedAt: false }, collection: 'claimdocuments' })
export class ClaimFile {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Claim', required: true, index: true })
  claimId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(ClaimDocumentType), required: true })
  type: ClaimDocumentType;

  // Private storage key; never a public URL
  @Prop({ required: true })
  storageKey: string;

  @Prop()
  originalName?: string;

  @Prop()
  mime?: string;

  @Prop()
  size?: number;

  // pending | accepted | rejected (the moderator's view of this document)
  @Prop({ default: 'pending' })
  status: string;

  @Prop({ type: Date })
  deleteAfter?: Date;

  @Prop({ type: Date })
  deletedAt?: Date;

  uploadedAt?: Date;
}

export const ClaimFileSchema = SchemaFactory.createForClass(ClaimFile);
ClaimFileSchema.index({ deleteAfter: 1 }, { sparse: true });
