import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Actor, ActorContext } from '../../common/actor-context';
import { ActorKind, AuditAction } from '../../common/scraper.enums';
import { AdminAuditLog, AdminAuditLogDocument } from '../../schemas/admin-audit-log.schema';

export interface AuditEntry {
  action: AuditAction;
  targetType: string;
  targetId?: string | Types.ObjectId;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  note?: string;
}

// Spec §12: written for every approval, rejection, merge, adapter change, opt-out and emergency stop.
@Injectable()
export class AuditService {
  constructor(@InjectModel(AdminAuditLog.name) private readonly model: Model<AdminAuditLogDocument>) {}

  async record(entry: AuditEntry, actor: Actor = ActorContext.current()): Promise<void> {
    await this.model.create({
      actor: {
        kind: actor.kind,
        userId: 'userId' in actor && actor.userId ? new Types.ObjectId(actor.userId) : undefined,
        role: 'role' in actor ? actor.role : undefined,
        component: actor.kind === ActorKind.SYSTEM ? actor.component : undefined,
        ip: ActorContext.ip(),
      },
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ? String(entry.targetId) : undefined,
      before: entry.before,
      after: entry.after,
      note: entry.note,
    });
  }

  list(filter: { action?: AuditAction; targetType?: string; targetId?: string; limit?: number; before?: Date }) {
    const query: Record<string, unknown> = {};
    if (filter.action) query.action = filter.action;
    if (filter.targetType) query.targetType = filter.targetType;
    if (filter.targetId) query.targetId = filter.targetId;
    if (filter.before) query.createdAt = { $lt: filter.before };
    return this.model
      .find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(200, filter.limit ?? 50))
      .populate('actor.userId', 'name email')
      .lean();
  }
}
