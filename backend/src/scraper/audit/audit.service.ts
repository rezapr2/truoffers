import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Actor, ActorContext } from '../../common/actor-context';
import { ActorKind, AuditAction } from '../../common/scraper.enums';
import { AdminAuditLog, AdminAuditLogDocument } from '../../schemas/admin-audit-log.schema';

export interface AuditEntry {
  // The import robot's actions are AuditAction values; the rest of the platform uses dotted names, e.g. "offer.approved".
  action: AuditAction | string;
  targetType: string;
  targetId?: string | Types.ObjectId;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  note?: string;
}

export interface AuditQuery {
  action?: string;
  targetType?: string;
  targetId?: string;
  actorId?: string;
  actorKind?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  before?: Date;
  page?: number;
}

// Spec §12 and the MVP's audit rule: who, what, when, before and after, for every admin, moderator and owner action.
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

  private filterOf(filter: AuditQuery) {
    const query: Record<string, unknown> = {};
    // A trailing dot matches every action in a family, e.g. "offer." for all offer actions.
    if (filter.action) query.action = filter.action.endsWith('.') ? new RegExp(`^${filter.action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) : filter.action;
    if (filter.targetType) query.targetType = filter.targetType;
    if (filter.targetId) query.targetId = filter.targetId;
    if (filter.actorId && Types.ObjectId.isValid(filter.actorId)) query['actor.userId'] = new Types.ObjectId(filter.actorId);
    if (filter.actorKind) query['actor.kind'] = filter.actorKind;
    const createdAt: Record<string, Date> = {};
    if (filter.from) createdAt.$gte = filter.from;
    if (filter.to) createdAt.$lte = filter.to;
    if (filter.before) createdAt.$lt = filter.before;
    if (Object.keys(createdAt).length) query.createdAt = createdAt;
    return query;
  }

  list(filter: AuditQuery) {
    const limit = Math.min(500, filter.limit ?? 50);
    return this.model
      .find(this.filterOf(filter))
      .sort({ createdAt: -1 })
      .skip(Math.max(0, (filter.page ?? 1) - 1) * limit)
      .limit(limit)
      .populate('actor.userId', 'name email')
      .lean();
  }

  async page(filter: AuditQuery) {
    const limit = Math.min(500, filter.limit ?? 50);
    const [items, total] = await Promise.all([this.list({ ...filter, limit }), this.model.countDocuments(this.filterOf(filter))]);
    return { items, total, page: filter.page ?? 1, pages: Math.ceil(total / limit) };
  }

  /** Every entry about one thing, e.g. a business's audit trail. */
  trail(targetType: string, targetId: string, limit = 100) {
    return this.model
      .find({ targetType, targetId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('actor.userId', 'name email')
      .lean();
  }
}
