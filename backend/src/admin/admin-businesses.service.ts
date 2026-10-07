import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthUser } from '../common/decorators';
import {
  BusinessMemberRole,
  BusinessSource,
  BusinessStatus,
  OfferStatus,
  PLAN_GRANTING_STATUSES,
  Role,
  VerificationLevel,
} from '../common/enums';
import { memberRole } from '../common/business-access';
import { recountActiveOffers } from '../common/offer-counts';
import { checkLink } from '../common/order-link';
import { OfferOrigin } from '../common/scraper.enums';
import { AuthService } from '../auth/auth.service';
import { BusinessesService, escapeRegex } from '../businesses/businesses.service';
import { CreateBusinessDto, UpdateBusinessDto } from '../businesses/businesses.dto';
import { NotificationsService } from '../platform/notifications.service';
import { SettingsService } from '../platform/settings.service';
import { AuditService } from '../scraper/audit/audit.service';
import { Business, BusinessDocument } from '../schemas/business.schema';
import { Claim, ClaimDocument } from '../schemas/claim.schema';
import { MenuItem, MenuItemDocument } from '../schemas/menu.schema';
import { Offer, OfferDocument } from '../schemas/offer.schema';
import { Payment, PaymentDocument } from '../schemas/payment.schema';
import { BusinessStrike, BusinessStrikeDocument, ReportCase, ReportCaseDocument } from '../schemas/report.schema';
import { Subscription, SubscriptionDocument } from '../schemas/subscription.schema';
import { User, UserDocument, UserStatus } from '../schemas/user.schema';
import { LoginEvent, LoginEventDocument } from '../schemas/login-event.schema';

export interface BusinessQuery {
  q?: string;
  level?: string;
  status?: string;
  city?: string;
  plan?: string;
  source?: string;
  flag?: string;
  page?: string;
}

const PAGE_SIZE = 30;

/** Spec T6.1 / "Businesses" module. */
@Injectable()
export class AdminBusinessesService {
  constructor(
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Offer.name) private readonly offers: Model<OfferDocument>,
    @InjectModel(Claim.name) private readonly claims: Model<ClaimDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Subscription.name) private readonly subscriptions: Model<SubscriptionDocument>,
    @InjectModel(Payment.name) private readonly payments: Model<PaymentDocument>,
    @InjectModel(MenuItem.name) private readonly menu: Model<MenuItemDocument>,
    @InjectModel(ReportCase.name) private readonly reportCases: Model<ReportCaseDocument>,
    @InjectModel(BusinessStrike.name) private readonly strikes: Model<BusinessStrikeDocument>,
    @InjectModel(LoginEvent.name) private readonly loginEvents: Model<LoginEventDocument>,
    private readonly businessesService: BusinessesService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  private async filter(query: BusinessQuery) {
    const filter: Record<string, unknown> = {};
    if (query.q) {
      const regex = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ name: regex }, { postcode: regex }, { slug: regex }, { phone: regex }];
    }
    if (query.level !== undefined && query.level !== '') filter.verificationLevel = Number(query.level);
    if (query.status) filter.status = query.status;
    else filter.status = { $ne: BusinessStatus.ARCHIVED };
    if (query.city) filter.town = new RegExp(`^${escapeRegex(query.city)}$`, 'i');
    if (query.source) filter.source = query.source;
    if (query.flag === 'suspension_review') filter['suspensionReview.flaggedAt'] = { $exists: true };
    if (query.flag === 'suspension_review') filter['suspensionReview.resolvedAt'] = { $exists: false };
    if (query.flag === 'frozen') filter.frozen = true;
    if (query.flag === 'foodbell') filter.isFoodbellClient = true;
    if (query.plan) {
      const paid = await this.subscriptions.find({ status: { $in: PLAN_GRANTING_STATUSES } }).select('businessId planKey').lean();
      const ids = paid.filter((s) => query.plan === 'free' || s.planKey === query.plan).map((s) => s.businessId);
      filter._id = query.plan === 'free' ? { $nin: ids } : { $in: ids };
    }
    return filter;
  }

  async list(query: BusinessQuery, limit = PAGE_SIZE) {
    const filter = await this.filter(query);
    const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
    const [items, total, settings] = await Promise.all([
      this.businesses
        .find(filter)
        .select('-phoneE164 -nameNormalized -postcodeCanonical -websiteHost')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('ownerId', 'name email')
        .lean(),
      this.businesses.countDocuments(filter),
      this.settings.get(),
    ]);
    const subs = await this.subscriptions
      .find({ businessId: { $in: items.map((b) => b._id) }, status: { $in: PLAN_GRANTING_STATUSES } })
      .select('businessId planKey status')
      .lean();
    const planOf = new Map(subs.map((s) => [String(s.businessId), s]));
    let rows = items.map((b) => ({
      ...b,
      plan: planOf.get(String(b._id))?.planKey ?? 'free',
      subscriptionStatus: planOf.get(String(b._id))?.status,
      orderLinkCheck: checkLink(b.orderUrl, b, settings.knownOrderingDomains),
    }));
    if (query.flag === 'order_link') rows = rows.filter((b) => b.orderLinkCheck === 'mismatch' || b.orderLinkCheck === 'invalid');
    return { items: rows, total, page, pages: Math.ceil(total / limit) };
  }

  /** The detail drawer: profile, team, offers, plan, payments, claims, reports, audit trail. */
  async detail(id: string) {
    const business = Types.ObjectId.isValid(id) ? await this.businesses.findById(id).populate('categories', 'name slug').lean() : null;
    if (!business) throw new NotFoundException('Business not found');
    const settings = await this.settings.get();
    const [members, offers, subscription, payments, claims, reportCases, strikes, trail] = await Promise.all([
      this.users.find({ _id: { $in: (business.members ?? []).map((m) => m.userId) } }).select('name email status lastLoginAt').lean(),
      this.offers.find({ businessId: business._id }).select('title status displayLabel origin external.provider startsAt endsAt impressions orderClicks createdAt').sort({ createdAt: -1 }).limit(50).lean(),
      this.subscriptions.findOne({ businessId: business._id }).sort({ createdAt: -1 }).lean(),
      this.payments.find({ businessId: business._id }).sort({ createdAt: -1 }).limit(20).lean(),
      this.claims.find({ businessId: business._id }).sort({ createdAt: -1 }).limit(10).populate('userId', 'name email').select('status kind userId submittedAt decidedAt reasonCode').lean(),
      this.reportCases.find({ businessId: business._id }).sort({ createdAt: -1 }).limit(20).populate('offerId', 'title').lean(),
      this.strikes.countDocuments({ businessId: business._id, revokedAt: { $exists: false }, createdAt: { $gte: new Date(Date.now() - settings.reports.strikeWindowDays * 24 * 3600_000) } }),
      this.audit.trail('Business', id, 50),
    ]);
    return {
      business: {
        ...business,
        members: (business.members ?? []).map((m) => ({ ...m, user: members.find((u) => String(u._id) === String(m.userId)) })),
      },
      orderLinkCheck: checkLink(business.orderUrl, business, settings.knownOrderingDomains),
      offers,
      subscription,
      payments,
      claims,
      reportCases,
      strikesInWindow: strikes,
      trail,
    };
  }

  async create(dto: CreateBusinessDto) {
    const business = await this.businessesService.create(dto, { source: BusinessSource.ADMIN });
    await this.audit.record({ action: 'business.created', targetType: 'Business', targetId: business._id, after: { name: business.name, postcode: business.postcode } });
    return business;
  }

  async update(id: string, dto: UpdateBusinessDto & { isFoodbellClient?: boolean; featured?: boolean }, admin: AuthUser) {
    const { business } = await this.businessesService.update(id, dto, admin);
    return business;
  }

  private async load(id: string) {
    const business = Types.ObjectId.isValid(id) ? await this.businesses.findById(id) : null;
    if (!business) throw new NotFoundException('Business not found');
    return business;
  }

  async setLevel(id: string, level: VerificationLevel, note?: string) {
    const business = await this.load(id);
    const before = business.verificationLevel;
    business.verificationLevel = level;
    if (level >= VerificationLevel.VERIFIED && !business.verifiedAt) {
      const now = new Date();
      business.verifiedAt = now;
      business.reverificationDueAt = new Date(new Date(now).setMonth(now.getMonth() + 12));
    }
    if (level >= VerificationLevel.VERIFIED && business.status === BusinessStatus.PENDING) business.status = BusinessStatus.ACTIVE;
    await business.save();
    await this.audit.record({ action: 'business.level_set', targetType: 'Business', targetId: business._id, before: { verificationLevel: before }, after: { verificationLevel: level }, note });
    return business;
  }

  async setFlags(id: string, flags: { isFoodbellClient?: boolean; featured?: boolean }) {
    const business = await this.load(id);
    const before = { isFoodbellClient: business.isFoodbellClient, featured: business.featured };
    if (flags.isFoodbellClient !== undefined) business.isFoodbellClient = flags.isFoodbellClient;
    if (flags.featured !== undefined) business.featured = flags.featured;
    await business.save();
    await this.audit.record({ action: 'business.flags_set', targetType: 'Business', targetId: business._id, before, after: { isFoodbellClient: business.isFoodbellClient, featured: business.featured } });
    return business;
  }

  /** Suspended listings and their offers disappear from the site; the owner keeps dashboard access. */
  async suspend(id: string, reason: string) {
    const business = await this.load(id);
    if (business.status === BusinessStatus.SUSPENDED) throw new BadRequestException('Already suspended');
    const before = business.status;
    business.set({ status: BusinessStatus.SUSPENDED, suspendedAt: new Date(), suspensionReason: reason });
    if (business.suspensionReview && !business.suspensionReview.resolvedAt) {
      business.set({ 'suspensionReview.resolvedAt': new Date(), 'suspensionReview.resolution': 'suspended' });
    }
    await business.save();
    await this.audit.record({ action: 'business.suspended', targetType: 'Business', targetId: business._id, before: { status: before }, after: { status: business.status }, note: reason });
    await this.notifications.notifyBusiness(business._id, {
      type: 'business_suspended',
      title: `${business.name} has been suspended`,
      body: reason,
      email: { template: 'business_suspended', vars: { businessName: business.name, reason } },
    });
    return business;
  }

  async unsuspend(id: string) {
    const business = await this.load(id);
    if (business.status !== BusinessStatus.SUSPENDED) throw new BadRequestException('This business is not suspended');
    business.set({ status: BusinessStatus.ACTIVE, suspendedAt: undefined, suspensionReason: undefined });
    await business.save();
    await recountActiveOffers(this.offers, this.businesses, business._id);
    await this.audit.record({ action: 'business.unsuspended', targetType: 'Business', targetId: business._id, before: { status: BusinessStatus.SUSPENDED }, after: { status: business.status } });
    return business;
  }

  /** Moderators can only suggest a suspension; strikes flag one automatically. An admin decides. */
  async flagForReview(id: string, reason: string, userId?: string) {
    const business = await this.load(id);
    business.set({ suspensionReview: { flaggedAt: new Date(), reason, flaggedBy: userId ? new Types.ObjectId(userId) : undefined } });
    await business.save();
    await this.audit.record({ action: 'business.suspension_suggested', targetType: 'Business', targetId: business._id, after: { reason } });
    return business;
  }

  async resolveReview(id: string, resolution: string) {
    const business = await this.load(id);
    if (!business.suspensionReview) throw new BadRequestException('There is no open review');
    business.set({ 'suspensionReview.resolvedAt': new Date(), 'suspensionReview.resolution': resolution });
    await business.save();
    await this.audit.record({ action: 'business.suspension_review_resolved', targetType: 'Business', targetId: business._id, after: { resolution } });
    return business;
  }

  /** Change owner: the new person becomes the (primary) owner and the previous owners leave the team. */
  async changeOwner(id: string, input: { email: string; keepPreviousOwners?: boolean }) {
    const business = await this.load(id);
    const user = await this.users.findOne({ email: input.email.toLowerCase().trim(), status: UserStatus.ACTIVE });
    if (!user) throw new NotFoundException('No active account with that email. Ask them to sign up first.');
    const before = business.members.filter((m) => m.role === BusinessMemberRole.OWNER).map((m) => String(m.userId));
    const removed = input.keepPreviousOwners ? [] : before.filter((u) => u !== user.id);
    business.members = business.members.filter((m) => !removed.includes(String(m.userId)) && String(m.userId) !== user.id);
    business.members.push({ userId: user._id, role: BusinessMemberRole.OWNER, addedAt: new Date() });
    business.ownerId = user._id;
    business.set({ frozen: false, disputeClaimId: undefined });
    await business.save();
    await this.users.updateOne({ _id: user._id, role: { $in: [Role.CUSTOMER, Role.BUSINESS_STAFF] } }, { $set: { role: Role.BUSINESS_OWNER } });
    await this.audit.record({ action: 'business.owner_changed', targetType: 'Business', targetId: business._id, before: { owners: before }, after: { owner: user.id, removed } });
    await this.notifications.notifyUsers([user._id], { type: 'owner_assigned', title: `You now manage ${business.name}`, link: '/dashboard', businessId: business._id });
    if (removed.length) await this.notifications.notifyUsers(removed, { type: 'owner_removed', title: `You no longer manage ${business.name}`, businessId: business._id });
    return business;
  }

  /**
   * Merge a duplicate listing into another: offers, team, claims, menu (if the target has none), followers and
   * a paid plan (if the target has none) move; the duplicate is archived and points at the listing kept.
   */
  async merge(sourceId: string, targetId: string) {
    if (sourceId === targetId) throw new BadRequestException('Pick a different listing to merge into');
    const [source, target] = await Promise.all([this.load(sourceId), this.load(targetId)]);
    if (source.status === BusinessStatus.ARCHIVED) throw new BadRequestException('That listing was already merged or archived');
    const moved = { offers: 0, duplicates: 0, members: 0, claims: 0, menu: 0, followers: 0, subscription: false };

    for (const offer of await this.offers.find({ businessId: source._id })) {
      offer.businessId = target._id;
      try {
        await offer.save();
        moved.offers++;
      } catch {
        // The target already has this offer live: keep the target's, remove the copy.
        offer.businessId = source._id;
        if (offer.origin === OfferOrigin.SCRAPER) {
          // Imported offers are never hard-deleted, so dedupe remembers them.
          offer.set({ status: OfferStatus.REMOVED, removedAt: new Date(), removedReason: 'Merged duplicate listing' });
          await offer.save();
        } else {
          await offer.deleteOne();
        }
        moved.duplicates++;
      }
    }
    for (const member of source.members) {
      if (!memberRole(target, String(member.userId))) {
        target.members.push(member);
        moved.members++;
      }
    }
    if (!target.ownerId && source.ownerId) target.ownerId = source.ownerId;
    moved.claims = (await this.claims.updateMany({ businessId: source._id }, { $set: { businessId: target._id } })).modifiedCount;
    if (!(await this.menu.exists({ businessId: target._id }))) {
      moved.menu = (await this.menu.updateMany({ businessId: source._id }, { $set: { businessId: target._id } })).modifiedCount;
    }
    const followers = await this.users.updateMany(
      { $and: [{ followedBusinesses: String(source._id) }, { followedBusinesses: { $ne: String(target._id) } }] },
      { $addToSet: { followedBusinesses: String(target._id) } },
    );
    await this.users.updateMany({ followedBusinesses: String(source._id) }, { $pull: { followedBusinesses: String(source._id) } });
    moved.followers = followers.modifiedCount;
    target.followerCount = (target.followerCount ?? 0) + moved.followers;
    const targetSub = await this.subscriptions.exists({ businessId: target._id, status: { $in: PLAN_GRANTING_STATUSES } });
    if (!targetSub) {
      const result = await this.subscriptions.updateMany({ businessId: source._id, status: { $in: PLAN_GRANTING_STATUSES } }, { $set: { businessId: target._id } });
      moved.subscription = result.modifiedCount > 0;
    }
    target.verificationLevel = Math.max(target.verificationLevel, source.verificationLevel);
    target.isFoodbellClient = target.isFoodbellClient || source.isFoodbellClient;
    await target.save();

    source.set({ status: BusinessStatus.ARCHIVED, mergedInto: target._id, members: [], ownerId: undefined, featured: false, activeOfferCount: 0 });
    // Frees the name/postcode slot so the kept listing can take the name if needed.
    source.set({ nameNormalized: undefined, postcodeCanonical: undefined });
    await source.save();
    await recountActiveOffers(this.offers, this.businesses, target._id);
    await this.audit.record({ action: 'business.merged', targetType: 'Business', targetId: target._id, after: { mergedFrom: String(source._id), ...moved } });
    await this.audit.record({ action: 'business.merged_into', targetType: 'Business', targetId: source._id, after: { mergedInto: String(target._id) } });
    return { target, moved };
  }

  /** "View as business": a short, read-only session as the owner. Logged. */
  async impersonate(id: string, admin: AuthUser) {
    const business = await this.load(id);
    const ownerId = business.ownerId ?? business.members.find((m) => m.role === BusinessMemberRole.OWNER)?.userId;
    if (!ownerId) throw new BadRequestException('This business has no owner to view as');
    const session = await this.auth.impersonationToken(admin.userId, String(ownerId));
    await this.audit.record({ action: 'business.impersonated', targetType: 'Business', targetId: business._id, after: { viewedAs: String(ownerId) } });
    await this.loginEvents.create({ userId: ownerId, success: true, method: 'impersonation', reason: `by ${admin.email}` });
    return { ...session, businessId: business._id };
  }

  async archive(id: string) {
    const business = await this.load(id);
    if (await this.subscriptions.exists({ businessId: business._id, status: { $in: PLAN_GRANTING_STATUSES }, comp: { $ne: true } })) {
      throw new ConflictException('Cancel the paid plan before archiving this business');
    }
    const before = business.status;
    business.status = BusinessStatus.ARCHIVED;
    await business.save();
    await this.audit.record({ action: 'business.archived', targetType: 'Business', targetId: business._id, before: { status: before }, after: { status: business.status } });
    return business;
  }
}
