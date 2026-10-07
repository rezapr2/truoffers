import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FilterQuery, Model, Types } from 'mongoose';
import { normaliseUkPhone } from '../common/business-identity';
import { AuthUser } from '../common/decorators';
import { PLAN_GRANTING_STATUSES, Role } from '../common/enums';
import { signValue } from '../platform/crypto';
import { EmailService, siteUrl } from '../platform/email.service';
import { renderTemplate } from '../platform/email-templates';
import { SettingsService } from '../platform/settings.service';
import { SmsService } from '../platform/sms.service';
import { AuditService } from '../scraper/audit/audit.service';
import { Business, BusinessDocument } from '../schemas/business.schema';
import { Campaign, CampaignAudience, CampaignDocument } from '../schemas/campaign.schema';
import { Notification, NotificationDocument } from '../schemas/notification.schema';
import { Subscription, SubscriptionDocument } from '../schemas/subscription.schema';
import { User, UserDocument, UserStatus } from '../schemas/user.schema';

const BATCH = 100;
const LOCK_MS = 3 * 60_000;
export const CAMPAIGN_ROLES = [Role.CUSTOMER, Role.BUSINESS_OWNER, Role.BUSINESS_STAFF, Role.SUPPLIER];
const BUSINESS_ROLES: string[] = [Role.BUSINESS_OWNER, Role.BUSINESS_STAFF];

export interface CampaignInput {
  name?: string;
  kind?: 'marketing' | 'service';
  channels?: { email?: boolean; sms?: boolean; inApp?: boolean };
  audience?: Partial<Omit<CampaignAudience, 'followersOf'>> & { followersOf?: string | null };
  subject?: string;
  body?: string;
  smsBody?: string;
  link?: string;
}

type Recipient = Pick<User, 'name' | 'email' | 'phone' | 'marketingEmails' | 'marketingSms'> & { _id: Types.ObjectId };

/** The unsubscribe link in marketing messages: opens a page that turns the consent off without signing in. */
export function unsubscribeLink(userId: string, channel: 'email' | 'sms', api = false): string {
  const query = `u=${userId}&c=${channel}&s=${signValue(`unsubscribe:${channel}`, userId)}`;
  return api ? siteUrl(`/api/users/unsubscribe?${query}`) : siteUrl(`/unsubscribe?${query}`);
}

/** Blueprint §14.1 campaign manager: email, SMS and in-app messages to a chosen audience. */
@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    @InjectModel(Campaign.name) private readonly campaigns: Model<CampaignDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Subscription.name) private readonly subscriptions: Model<SubscriptionDocument>,
    @InjectModel(Notification.name) private readonly notifications: Model<NotificationDocument>,
    private readonly email: EmailService,
    private readonly sms: SmsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------------------------------
  // Audience
  // ---------------------------------------------------------------------------------------------------

  /** Everyone the audience describes, before consent. Each role has its own filters. */
  async audienceFilter(audience: Partial<CampaignAudience>): Promise<FilterQuery<UserDocument>> {
    const roles = (audience.roles?.length ? audience.roles : CAMPAIGN_ROLES).filter((r) => (CAMPAIGN_ROLES as string[]).includes(r));
    const clauses: FilterQuery<UserDocument>[] = [];

    const customerRoles = roles.filter((r) => r === Role.CUSTOMER);
    if (customerRoles.length) {
      const areas = (audience.postcodeAreas ?? []).map((a) => a.trim().toUpperCase()).filter(Boolean);
      clauses.push({
        role: Role.CUSTOMER,
        ...(areas.length ? { postcode: { $in: areas.map((a) => new RegExp(`^${a.replace(/[^A-Z0-9]/g, '')}(\\s|\\d|$)`, 'i')) } } : {}),
      });
    }

    const businessRoles = roles.filter((r) => BUSINESS_ROLES.includes(r));
    if (businessRoles.length) {
      const businessFilter: Record<string, unknown> = { status: { $ne: 'archived' } };
      let restricted = false;
      if (audience.verificationLevels?.length) {
        businessFilter.verificationLevel = { $in: audience.verificationLevels };
        restricted = true;
      }
      if (audience.towns?.length) {
        businessFilter.town = { $in: audience.towns.map((t) => new RegExp(`^${t.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')) };
        restricted = true;
      }
      if (audience.plans?.length) {
        const paid = await this.subscriptions.find({ status: { $in: PLAN_GRANTING_STATUSES } }).select('businessId planKey').lean();
        const wanted = new Set(audience.plans);
        const onPaidPlan = paid.filter((s) => s.businessId && wanted.has(s.planKey)).map((s) => s.businessId!);
        const allPaid = paid.map((s) => s.businessId).filter(Boolean);
        businessFilter._id = wanted.has('free') ? { $nin: allPaid.filter((id) => !onPaidPlan.some((p) => String(p) === String(id))) } : { $in: onPaidPlan };
        restricted = true;
      }
      if (restricted) {
        const members = await this.businesses.find(businessFilter).distinct('members.userId');
        clauses.push({ role: { $in: businessRoles }, _id: { $in: members } });
      } else {
        clauses.push({ role: { $in: businessRoles } });
      }
    }

    if (roles.includes(Role.SUPPLIER)) clauses.push({ role: Role.SUPPLIER });

    const filter: FilterQuery<UserDocument> = { status: UserStatus.ACTIVE, $or: clauses.length ? clauses : [{ _id: null }] };
    if (audience.followersOf) filter.followedBusinesses = String(audience.followersOf);
    return filter;
  }

  async preview(input: CampaignInput) {
    const kind = input.kind ?? 'marketing';
    const filter = await this.audienceFilter(this.audienceOf(input.audience));
    const marketing = kind === 'marketing';
    const [total, email, phones, smsReady] = await Promise.all([
      this.users.countDocuments(filter),
      this.users.countDocuments({ ...filter, ...(marketing ? { marketingEmails: true } : {}) }),
      this.users.find({ ...filter, phone: { $nin: [null, ''] }, ...(marketing ? { marketingSms: true } : {}) }).select('phone').lean(),
      this.sms.configured(),
    ]);
    // Only numbers a text can actually go to
    const sms = phones.filter((u) => normaliseUkPhone(u.phone)).length;
    return { total, email, sms, inApp: total, smsConfigured: smsReady };
  }

  private audienceOf(audience: CampaignInput['audience']): Partial<CampaignAudience> {
    if (!audience) return {};
    const { followersOf, ...rest } = audience;
    return { ...rest, followersOf: followersOf && Types.ObjectId.isValid(followersOf) ? new Types.ObjectId(followersOf) : undefined };
  }

  // ---------------------------------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------------------------------

  list(status?: string) {
    return this.campaigns
      .find(status ? { status: { $in: status.split(',') } } : {})
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('createdBy', 'name')
      .populate('audience.followersOf', 'name')
      .lean();
  }

  async get(id: string) {
    const campaign = Types.ObjectId.isValid(id) ? await this.campaigns.findById(id).populate('audience.followersOf', 'name slug').lean() : null;
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  private fields(input: CampaignInput) {
    const fields: Record<string, unknown> = {};
    for (const key of ['name', 'kind', 'subject', 'body', 'smsBody', 'link'] as const) if (input[key] !== undefined) fields[key] = input[key];
    if (input.channels) fields.channels = { email: !!input.channels.email, sms: !!input.channels.sms, inApp: !!input.channels.inApp };
    if (input.audience) fields.audience = this.audienceOf(input.audience);
    return fields;
  }

  async create(input: CampaignInput, admin: AuthUser) {
    if (!input.name?.trim()) throw new BadRequestException('Give the campaign a name');
    const campaign = await this.campaigns.create({ ...this.fields(input), createdBy: new Types.ObjectId(admin.userId) });
    await this.audit.record({ action: 'campaign.created', targetType: 'Campaign', targetId: campaign._id, after: { name: campaign.name, kind: campaign.kind } });
    return campaign;
  }

  private async loadEditable(id: string) {
    const campaign = Types.ObjectId.isValid(id) ? await this.campaigns.findById(id) : null;
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (!['draft', 'scheduled'].includes(campaign.status)) throw new BadRequestException(`This campaign is ${campaign.status} and can no longer change`);
    return campaign;
  }

  async update(id: string, input: CampaignInput) {
    const campaign = await this.loadEditable(id);
    campaign.set(this.fields(input));
    await campaign.save();
    return campaign;
  }

  async remove(id: string) {
    const campaign = await this.loadEditable(id);
    await campaign.deleteOne();
    await this.audit.record({ action: 'campaign.deleted', targetType: 'Campaign', targetId: id, before: { name: campaign.name } });
    return { deleted: true };
  }

  private assertReady(campaign: CampaignDocument) {
    const { email, sms, inApp } = campaign.channels ?? {};
    if (!email && !sms && !inApp) throw new BadRequestException('Choose at least one channel');
    if ((email || inApp) && !campaign.subject.trim()) throw new BadRequestException('Write a subject (it is also the in-app title)');
    if (email && !campaign.body.trim()) throw new BadRequestException('Write the email');
    if (sms && !campaign.smsBody.trim()) throw new BadRequestException('Write the text message');
    if (sms && campaign.smsBody.length > 459) throw new BadRequestException('Keep the text message to 3 parts (459 characters)');
  }

  /** Send now (no date) or at a later time. */
  async schedule(id: string, at: Date | undefined, admin: AuthUser) {
    const campaign = await this.loadEditable(id);
    this.assertReady(campaign);
    const when = at && at.getTime() > Date.now() ? at : new Date();
    campaign.set({ status: 'scheduled', scheduledAt: when });
    await campaign.save();
    await this.audit.record({ action: 'campaign.scheduled', targetType: 'Campaign', targetId: campaign._id, after: { scheduledAt: when, by: admin.email } });
    if (when.getTime() <= Date.now()) void this.process(String(campaign._id)).catch((err) => this.logger.error(`Campaign ${campaign._id} failed: ${(err as Error).message}`));
    return campaign;
  }

  async cancel(id: string) {
    const campaign = Types.ObjectId.isValid(id) ? await this.campaigns.findById(id) : null;
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (!['scheduled', 'sending'].includes(campaign.status)) throw new BadRequestException(`This campaign is ${campaign.status}`);
    const before = campaign.status;
    campaign.set({ status: before === 'scheduled' ? 'draft' : 'cancelled', ...(before === 'sending' ? { finishedAt: new Date() } : {}) });
    await campaign.save();
    await this.audit.record({ action: 'campaign.cancelled', targetType: 'Campaign', targetId: campaign._id, before: { status: before }, after: { status: campaign.status } });
    return campaign;
  }

  /** A copy to the admin themself, on every chosen channel, whatever their consent. */
  async test(id: string, admin: AuthUser) {
    const campaign = Types.ObjectId.isValid(id) ? await this.campaigns.findById(id) : null;
    if (!campaign) throw new NotFoundException('Campaign not found');
    const me = await this.users.findById(admin.userId).select('name email phone marketingEmails marketingSms').lean();
    if (!me) throw new NotFoundException('User not found');
    const result = await this.deliver(campaign, me as Recipient, { test: true });
    return result;
  }

  // ---------------------------------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------------------------------

  private personalise(text: string, user: Recipient, siteName: string) {
    return renderTemplate(text, { name: user.name?.split(' ')[0] || 'there', siteName });
  }

  private async deliver(campaign: CampaignDocument, user: Recipient, options: { test?: boolean } = {}) {
    const settings = await this.settings.get();
    const marketing = campaign.kind === 'marketing' && !options.test;
    const label = `campaign:${campaign._id}`;
    const prefix = options.test ? '[Test] ' : '';
    const outcome = { email: 'skipped', sms: 'skipped', inApp: 'skipped' };

    if (campaign.channels.email && user.email && (!marketing || user.marketingEmails)) {
      const body = this.personalise(campaign.body, user, settings.siteName) + (campaign.link ? `\n\n${campaign.link.startsWith('http') ? campaign.link : siteUrl(campaign.link)}` : '');
      const result = await this.email.sendDirect({
        to: user.email,
        label,
        subject: prefix + this.personalise(campaign.subject, user, settings.siteName),
        body,
        unsubscribeUrl: campaign.kind === 'marketing' ? unsubscribeLink(String(user._id), 'email') : undefined,
      });
      outcome.email = result.status === 'failed' ? 'failed' : 'sent';
    }
    const phone = normaliseUkPhone(user.phone);
    if (campaign.channels.sms && phone && (!marketing || user.marketingSms)) {
      const text = prefix + this.personalise(campaign.smsBody, user, settings.siteName) + (campaign.kind === 'marketing' ? ' Reply STOP to opt out.' : '');
      const result = await this.sms.send(phone, text, label);
      outcome.sms = result.status === 'failed' ? 'failed' : 'sent';
    }
    if (campaign.channels.inApp) {
      await this.notifications.create({
        userId: user._id,
        type: 'campaign',
        title: prefix + this.personalise(campaign.subject, user, settings.siteName),
        body: this.personalise(campaign.body, user, settings.siteName).slice(0, 280),
        link: campaign.link,
      });
      outcome.inApp = 'sent';
    }
    return outcome;
  }

  /** Sends a scheduled or interrupted campaign batch by batch, resuming after the last user done. */
  async process(id: string) {
    const now = new Date();
    const campaign = await this.campaigns.findOneAndUpdate(
      {
        _id: id,
        $or: [
          { status: 'scheduled', scheduledAt: { $lte: now } },
          { status: 'sending', $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: { $lt: now } }] },
        ],
      },
      { $set: { status: 'sending', lockedUntil: new Date(Date.now() + LOCK_MS) } },
      { new: true },
    );
    if (!campaign) return;
    if (!campaign.startedAt) {
      campaign.startedAt = now;
      campaign.recipients = await this.users.countDocuments(await this.audienceFilter(campaign.audience));
      await campaign.save();
    }
    const filter = await this.audienceFilter(campaign.audience);
    for (;;) {
      const fresh = await this.campaigns.findById(campaign._id).select('status cursor').lean();
      if (!fresh || fresh.status !== 'sending') return; // cancelled
      const batch = await this.users
        .find({ ...filter, ...(fresh.cursor ? { _id: { ...(filter._id as object), $gt: fresh.cursor } } : {}) })
        .sort({ _id: 1 })
        .limit(BATCH)
        .select('name email phone marketingEmails marketingSms')
        .lean();
      if (!batch.length) break;
      const inc: Record<string, number> = {};
      for (const user of batch) {
        const outcome = await this.deliver(campaign, user as Recipient);
        for (const channel of ['email', 'sms', 'inApp'] as const) {
          if (!campaign.channels[channel]) continue;
          const key = `${channel}.${outcome[channel]}`;
          inc[key] = (inc[key] ?? 0) + 1;
        }
      }
      await this.campaigns.updateOne({ _id: campaign._id }, { $inc: inc, $set: { cursor: batch[batch.length - 1]._id, lockedUntil: new Date(Date.now() + LOCK_MS) } });
    }
    await this.campaigns.updateOne({ _id: campaign._id, status: 'sending' }, { $set: { status: 'sent', finishedAt: new Date() }, $unset: { lockedUntil: 1 } });
    const done = await this.campaigns.findById(campaign._id).lean();
    await this.audit.record({ action: 'campaign.sent', targetType: 'Campaign', targetId: campaign._id, after: { recipients: done?.recipients, email: done?.email, sms: done?.sms, inApp: done?.inApp } });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    if (process.env.NODE_ENV === 'test') return;
    const due = await this.campaigns
      .find({ $or: [{ status: 'scheduled', scheduledAt: { $lte: new Date() } }, { status: 'sending', lockedUntil: { $lt: new Date() } }] })
      .select('_id')
      .limit(5)
      .lean();
    for (const c of due) await this.process(String(c._id)).catch((err) => this.logger.error(`Campaign ${c._id} failed: ${(err as Error).message}`));
  }
}
