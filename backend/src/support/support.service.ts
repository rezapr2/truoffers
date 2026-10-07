import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { escapeRegex } from '../businesses/businesses.service';
import { isMember } from '../common/business-access';
import { AuthUser } from '../common/decorators';
import { STAFF_ROLES } from '../common/enums';
import { decryptSecret, encryptSecret, randomToken, safeEqual } from '../platform/crypto';
import { EmailService, siteUrl } from '../platform/email.service';
import { NotificationsService } from '../platform/notifications.service';
import { RecaptchaService } from '../platform/recaptcha.service';
import { AuditService } from '../scraper/audit/audit.service';
import { Business, BusinessDocument } from '../schemas/business.schema';
import { SupportStatus, SupportTicket, SupportTicketDocument, SupportTopic } from '../schemas/support.schema';
import { User, UserDocument } from '../schemas/user.schema';

const PAGE_SIZE = 30;
// A ticket waiting on the customer this long closes itself.
const AUTO_CLOSE_DAYS = 14;
const DAY = 24 * 3600_000;

export interface NewTicket {
  name?: string;
  email?: string;
  topic: SupportTopic;
  subject: string;
  message: string;
  businessId?: string;
  recaptchaToken?: string;
}

/** Blueprint §11: support tickets from the contact form and the dashboards, answered in the admin inbox. */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @InjectModel(SupportTicket.name) private readonly tickets: Model<SupportTicketDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    private readonly recaptcha: RecaptchaService,
    private readonly audit: AuditService,
  ) {}

  private async nextNumber(): Promise<string> {
    const counter = await this.tickets.db
      .collection<{ _id: string; seq: number }>('counters')
      .findOneAndUpdate({ _id: 'support_ticket' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
    return `T-${10000 + (counter?.seq ?? 1)}`;
  }

  private link(ticket: { _id: Types.ObjectId | string }, token: string | undefined) {
    return siteUrl(`/support/${ticket._id}${token ? `?t=${token}` : ''}`);
  }

  /** What the customer may see: no internal notes, no assignment. */
  private customerView(ticket: SupportTicket & { _id: Types.ObjectId }) {
    return {
      _id: ticket._id,
      number: ticket.number,
      subject: ticket.subject,
      topic: ticket.topic,
      status: ticket.status,
      name: ticket.name,
      createdAt: (ticket as unknown as { createdAt: Date }).createdAt,
      messages: ticket.messages
        .filter((m) => !m.internal)
        .map((m) => ({ _id: (m as unknown as { _id: Types.ObjectId })._id, from: m.from, name: m.from === 'staff' ? 'TruOffers support' : m.name, body: m.body, createdAt: m.createdAt })),
    };
  }

  async create(input: NewTicket, user: AuthUser | undefined, ip?: string) {
    if (!user && !(await this.recaptcha.verify(input.recaptchaToken, ip))) {
      throw new BadRequestException('Please confirm you are not a robot and try again.');
    }
    const account = user ? await this.users.findById(user.userId).select('name email').lean() : null;
    const name = account?.name ?? input.name?.trim();
    const email = account?.email ?? input.email?.trim().toLowerCase();
    if (!name || !email) throw new BadRequestException('Tell us your name and email so we can reply.');

    let businessId: Types.ObjectId | undefined;
    if (input.businessId && user && Types.ObjectId.isValid(input.businessId)) {
      const business = await this.businesses.findById(input.businessId).select('members').lean();
      if (business && isMember(business, user.userId)) businessId = business._id;
    }
    const token = randomToken(24);
    const now = new Date();
    const ticket = await this.tickets.create({
      number: await this.nextNumber(),
      subject: input.subject.trim(),
      topic: input.topic,
      name,
      email,
      userId: user ? new Types.ObjectId(user.userId) : undefined,
      businessId,
      accessTokenEnc: encryptSecret(token),
      lastCustomerMessageAt: now,
      messages: [{ from: 'customer', userId: user ? new Types.ObjectId(user.userId) : undefined, name, body: input.message.trim() }],
    });
    await this.email.send({ to: email, template: 'support_ticket_received', vars: { name, number: ticket.number, subject: ticket.subject, link: this.link(ticket, token) } });
    return { _id: ticket._id, number: ticket.number, link: `/support/${ticket._id}?t=${token}` };
  }

  /** The requester, signed in or holding the link from their email. Staff use the admin endpoints. */
  private async loadForCustomer(id: string, token: string | undefined, user: AuthUser | undefined) {
    const ticket = Types.ObjectId.isValid(id) ? await this.tickets.findById(id).select('+accessTokenEnc') : null;
    if (!ticket) throw new NotFoundException('Support request not found');
    const owner = user && ticket.userId && String(ticket.userId) === user.userId;
    const stored = decryptSecret(ticket.accessTokenEnc);
    const viaLink = !!token && !!stored && safeEqual(token, stored);
    if (!owner && !viaLink) throw new NotFoundException('Support request not found');
    return ticket;
  }

  async getForCustomer(id: string, token: string | undefined, user: AuthUser | undefined) {
    return this.customerView((await this.loadForCustomer(id, token, user)).toObject());
  }

  async customerReply(id: string, body: string, token: string | undefined, user: AuthUser | undefined) {
    const ticket = await this.loadForCustomer(id, token, user);
    const now = new Date();
    ticket.messages.push({ from: 'customer', userId: user ? new Types.ObjectId(user.userId) : undefined, name: ticket.name, body: body.trim() } as never);
    ticket.set({ status: 'open', lastCustomerMessageAt: now, closedAt: undefined });
    await ticket.save();
    return this.customerView(ticket.toObject());
  }

  async mine(user: AuthUser) {
    return this.tickets
      .find({ userId: new Types.ObjectId(user.userId) })
      .select('number subject topic status createdAt updatedAt lastStaffReplyAt businessId')
      .populate('businessId', 'name')
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();
  }

  // ---------------------------------------------------------------------------------------------------
  // Staff
  // ---------------------------------------------------------------------------------------------------

  async list(query: { status?: string; topic?: string; assigned?: string; q?: string; page?: string }, staffId: string, limit = PAGE_SIZE) {
    const filter: Record<string, unknown> = {};
    const status = query.status || 'open';
    if (status !== 'all') filter.status = { $in: status.split(',') };
    if (query.topic) filter.topic = query.topic;
    if (query.assigned === 'me') filter.assignedTo = new Types.ObjectId(staffId);
    else if (query.assigned === 'unassigned') filter.assignedTo = { $exists: false };
    if (query.q) {
      const regex = new RegExp(escapeRegex(query.q.trim()), 'i');
      filter.$or = [{ number: regex }, { subject: regex }, { email: regex }, { name: regex }];
    }
    const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
    const [items, total, counts] = await Promise.all([
      this.tickets
        .find(filter)
        .select('-messages')
        // Oldest waiting first, like the other queues
        .sort(status === 'open' ? { lastCustomerMessageAt: 1 } : { updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('assignedTo', 'name')
        .populate('businessId', 'name slug')
        .lean(),
      this.tickets.countDocuments(filter),
      this.tickets.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);
    const now = Date.now();
    return {
      items: items.map((t) => ({ ...t, waitingHours: t.status === 'open' && t.lastCustomerMessageAt ? Math.round((now - new Date(t.lastCustomerMessageAt).getTime()) / 3600_000) : null })),
      total,
      page,
      pages: Math.ceil(total / limit),
      counts: Object.fromEntries(counts.map((c) => [c._id, c.count])),
    };
  }

  async detail(id: string) {
    const ticket = Types.ObjectId.isValid(id)
      ? await this.tickets.findById(id).populate('assignedTo', 'name email').populate('businessId', 'name slug verificationLevel status').populate('messages.userId', 'name').lean()
      : null;
    if (!ticket) throw new NotFoundException('Ticket not found');
    const [account, others] = await Promise.all([
      this.users.findOne({ email: ticket.email }).select('name email role status createdAt').lean(),
      this.tickets.find({ email: ticket.email, _id: { $ne: ticket._id } }).select('number subject status createdAt').sort({ createdAt: -1 }).limit(10).lean(),
    ]);
    return { ticket, account, others };
  }

  async staffReply(id: string, body: string, internal: boolean, staff: AuthUser) {
    const ticket = Types.ObjectId.isValid(id) ? await this.tickets.findById(id).select('+accessTokenEnc') : null;
    if (!ticket) throw new NotFoundException('Ticket not found');
    const now = new Date();
    ticket.messages.push({ from: 'staff', userId: new Types.ObjectId(staff.userId), name: staff.name, body: body.trim(), internal } as never);
    if (!internal) ticket.set({ status: 'pending', lastStaffReplyAt: now, closedAt: undefined });
    if (!ticket.assignedTo) ticket.assignedTo = new Types.ObjectId(staff.userId);
    await ticket.save();
    if (!internal) {
      const token = decryptSecret(ticket.accessTokenEnc);
      await this.email.send({
        to: ticket.email,
        template: 'support_reply',
        vars: { name: ticket.name, number: ticket.number, subject: ticket.subject, message: body.trim(), link: this.link(ticket, token) },
      });
      if (ticket.userId) {
        await this.notifications.notifyUsers([ticket.userId], { type: 'support_reply', title: `Reply to ${ticket.number}: ${ticket.subject}`, body: body.trim().slice(0, 200), link: `/support/${ticket._id}` });
      }
    }
    await this.audit.record({ action: internal ? 'support.note_added' : 'support.replied', targetType: 'SupportTicket', targetId: ticket._id, after: { number: ticket.number, status: ticket.status } });
    return this.detail(id);
  }

  async update(id: string, patch: { status?: SupportStatus; assignedTo?: string | null; priority?: string; topic?: SupportTopic }) {
    const ticket = Types.ObjectId.isValid(id) ? await this.tickets.findById(id) : null;
    if (!ticket) throw new NotFoundException('Ticket not found');
    const before = { status: ticket.status, assignedTo: ticket.assignedTo ? String(ticket.assignedTo) : null, priority: ticket.priority, topic: ticket.topic };
    if (patch.assignedTo !== undefined) {
      if (patch.assignedTo) {
        const staff = await this.users.exists({ _id: patch.assignedTo, role: { $in: STAFF_ROLES } });
        if (!staff) throw new ForbiddenException('Tickets can only be assigned to staff');
        ticket.assignedTo = new Types.ObjectId(patch.assignedTo);
      } else ticket.assignedTo = undefined;
    }
    if (patch.priority) ticket.priority = patch.priority;
    if (patch.topic) ticket.topic = patch.topic;
    if (patch.status && patch.status !== ticket.status) {
      ticket.status = patch.status;
      ticket.closedAt = patch.status === 'closed' ? new Date() : undefined;
    }
    await ticket.save();
    await this.audit.record({
      action: 'support.updated',
      targetType: 'SupportTicket',
      targetId: ticket._id,
      before,
      after: { status: ticket.status, assignedTo: ticket.assignedTo ? String(ticket.assignedTo) : null, priority: ticket.priority, topic: ticket.topic },
    });
    return this.detail(id);
  }

  openCount() {
    return this.tickets.countDocuments({ status: 'open' });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async autoClose() {
    const cutoff = new Date(Date.now() - AUTO_CLOSE_DAYS * DAY);
    const stale = await this.tickets.find({ status: 'pending', lastStaffReplyAt: { $lt: cutoff } }).limit(200);
    for (const ticket of stale) {
      ticket.messages.push({ from: 'system', body: `Closed after ${AUTO_CLOSE_DAYS} days without a reply. Reply here to open it again.` } as never);
      ticket.set({ status: 'closed', closedAt: new Date() });
      await ticket.save();
    }
    if (stale.length) this.logger.log(`Closed ${stale.length} support ticket(s) waiting on the customer`);
  }
}
