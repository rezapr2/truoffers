import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BusinessMemberRole } from '../common/enums';
import { Business, BusinessDocument } from '../schemas/business.schema';
import { Notification, NotificationDocument } from '../schemas/notification.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { EmailService } from './email.service';

export interface NotifyInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
  businessId?: Types.ObjectId | string;
  // Also email each recipient with this template
  email?: { template: string; vars?: Record<string, unknown> };
}

/** In-app notifications plus the matching email, for users or for the people who run a business. */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name) private readonly model: Model<NotificationDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    private readonly email: EmailService,
  ) {}

  async notifyUsers(userIds: Array<Types.ObjectId | string>, input: NotifyInput) {
    const ids = [...new Set(userIds.map(String))].filter((id) => Types.ObjectId.isValid(id));
    if (ids.length === 0) return;
    const recipients = await this.users
      .find({ _id: { $in: ids }, status: { $nin: ['deleted'] } })
      .select('_id email')
      .lean();
    await this.model.insertMany(
      recipients.map((user) => ({
        userId: user._id,
        businessId: input.businessId ? new Types.ObjectId(String(input.businessId)) : undefined,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link,
      })),
    );
    if (input.email) {
      for (const user of recipients) {
        await this.email.send({ to: user.email, template: input.email.template, vars: input.email.vars });
      }
    }
  }

  /** Everyone on the business's team, or only its owners (billing, verification). */
  async notifyBusiness(businessId: Types.ObjectId | string, input: NotifyInput, audience: 'owners' | 'team' = 'team') {
    const business = await this.businesses.findById(businessId).select('members ownerId').lean();
    if (!business) return;
    const members = (business.members ?? []).filter((m) => audience === 'team' || m.role === BusinessMemberRole.OWNER);
    const userIds = members.map((m) => m.userId);
    if (business.ownerId && !userIds.some((id) => String(id) === String(business.ownerId))) userIds.push(business.ownerId);
    if (userIds.length === 0) {
      this.logger.debug(`Business ${String(businessId)} has nobody to notify (${input.type})`);
      return;
    }
    await this.notifyUsers(userIds, { ...input, businessId });
  }

  list(userId: string, options: { businessId?: string; unreadOnly?: boolean; limit?: number }) {
    const query: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
    if (options.businessId && Types.ObjectId.isValid(options.businessId)) {
      query.$or = [{ businessId: new Types.ObjectId(options.businessId) }, { businessId: { $exists: false } }];
    }
    if (options.unreadOnly) query.readAt = { $exists: false };
    return this.model.find(query).sort({ createdAt: -1 }).limit(Math.min(100, options.limit ?? 50)).lean();
  }

  unreadCount(userId: string) {
    return this.model.countDocuments({ userId: new Types.ObjectId(userId), readAt: { $exists: false } });
  }

  async markRead(userId: string, ids?: string[]) {
    const query: Record<string, unknown> = { userId: new Types.ObjectId(userId), readAt: { $exists: false } };
    if (ids?.length) query._id = { $in: ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id)) };
    const result = await this.model.updateMany(query, { $set: { readAt: new Date() } });
    return { updated: result.modifiedCount };
  }
}
