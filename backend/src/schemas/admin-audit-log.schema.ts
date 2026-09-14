import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ActorKind, AuditAction } from '../common/scraper.enums';

export type AdminAuditLogDocument = HydratedDocument<AdminAuditLog>;

@Schema({ _id: false })
export class AuditActor {
  @Prop({ type: String, enum: Object.values(ActorKind), required: true }) kind: ActorKind;
  @Prop({ type: Types.ObjectId, ref: 'User' }) userId?: Types.ObjectId;
  @Prop() role?: string;
  @Prop() component?: string;
  @Prop() ip?: string;
}
export const AuditActorSchema = SchemaFactory.createForClass(AuditActor);

// Append-only.
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class AdminAuditLog {
  @Prop({ type: AuditActorSchema, required: true })
  actor: AuditActor;

  @Prop({ type: String, enum: Object.values(AuditAction), required: true })
  action: AuditAction;

  @Prop({ required: true })
  targetType: string;

  @Prop()
  targetId?: string;

  @Prop({ type: Object })
  before?: Record<string, unknown>;

  @Prop({ type: Object })
  after?: Record<string, unknown>;

  @Prop()
  note?: string;
}

export const AdminAuditLogSchema = SchemaFactory.createForClass(AdminAuditLog);
AdminAuditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
AdminAuditLogSchema.index({ action: 1, createdAt: -1 });
AdminAuditLogSchema.index({ createdAt: -1 });

const immutable = new Error('Audit log entries are append-only');

AdminAuditLogSchema.pre('save', function (next) {
  next(this.isNew ? undefined : immutable);
});

AdminAuditLogSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'],
  { document: false, query: true },
  function (next) {
    next(immutable);
  },
);

AdminAuditLogSchema.pre('deleteOne', { document: true, query: false }, function (next) {
  next(immutable);
});

AdminAuditLogSchema.pre('bulkWrite', function (next, ops) {
  const onlyInserts = ops.every((op) => 'insertOne' in op);
  next(onlyInserts ? undefined : immutable);
});
