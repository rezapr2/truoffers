import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import slugify from 'slugify';
import { Business, BusinessDocument } from '../schemas/business.schema';
import { BusinessChangeRequest, BusinessChangeRequestDocument, BusinessInvite, BusinessInviteDocument } from '../schemas/business-team.schema';
import { Claim, ClaimDocument } from '../schemas/claim.schema';
import { MenuItem, MenuItemDocument } from '../schemas/menu.schema';
import { Offer, OfferDocument } from '../schemas/offer.schema';
import { Category, CategoryDocument } from '../schemas/category.schema';
import { User, UserDocument } from '../schemas/user.schema';
import {
  BusinessMemberRole,
  BusinessSource,
  BusinessStatus,
  OfferStatus,
  OPEN_CLAIM_STATUSES,
  PLAN_COUNTED_OFFER_STATUSES,
  PUBLIC_OFFER_STATUSES,
  Role,
  VerificationLevel,
} from '../common/enums';
import { AuthUser } from '../common/decorators';
import { BusinessAccessService, memberRole } from '../common/business-access';
import { Capability, can } from '../common/permissions';
import { PUBLIC_BUSINESS_PROJECTION, PUBLIC_OFFER_PROJECTION } from '../common/public-offer';
import { geocodePostcode, normalisePostcode, outwardCode } from '../common/postcode.util';
import { deriveBusinessIdentity } from '../common/business-identity';
import { checkLink, LinkCheck, normaliseUrl } from '../common/order-link';
import { AuditService } from '../scraper/audit/audit.service';
import { randomToken, sha256 } from '../platform/crypto';
import { EmailService, siteUrl } from '../platform/email.service';
import { NotificationsService } from '../platform/notifications.service';
import { SettingsService } from '../platform/settings.service';
import { PlansService } from '../plans/plans.service';
import { CreateBusinessDto, CreateMenuItemDto, UpdateBusinessDto, UpdateMenuItemDto } from './businesses.dto';

// Listings are unique by canonical postcode and normalised name.
function duplicateListing(err: unknown): unknown {
  const { code, keyPattern } = err as { code?: number; keyPattern?: Record<string, unknown> };
  return code === 11000 && keyPattern && 'nameNormalized' in keyPattern
    ? new ConflictException('A listing with this name already exists at this postcode')
    : err;
}

// Dishes mirrored from the business's Foodbell site change there (src/foodbell), not here.
function assertOwnMenuItem(item: { source?: string }) {
  if (item.source === 'foodbell') throw new BadRequestException('This dish comes from your Foodbell menu. Change it in Foodbell and TruOffers updates within a minute.');
}

export function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Spec "Locked fields": once verified, changes to these wait for a moderator. The phone is the line we proved,
// so it is locked as soon as the claim passed the phone check.
const LOCKED_WHEN_VERIFIED = ['name', 'address', 'postcode', 'town', 'orderUrl'] as const;
const LOCKED_WHEN_CLAIMED = ['phone'] as const;

export function lockedFields(level: VerificationLevel): string[] {
  const fields: string[] = [];
  if (level >= VerificationLevel.CLAIM_PENDING) fields.push(...LOCKED_WHEN_CLAIMED);
  if (level >= VerificationLevel.VERIFIED) fields.push(...LOCKED_WHEN_VERIFIED);
  return fields;
}

const INVITE_DAYS = 7;
const PROFILE_FIELDS = [
  'name', 'description', 'address', 'postcode', 'town', 'phone', 'email', 'website', 'orderUrl', 'categories',
  'openingHours', 'logoUrl', 'coverUrl', 'photos', 'delivery', 'collection', 'socialLinks', 'menuPdfUrl',
] as const;

/** "Not verified" with Claim this business, "Claim in review", or "✓ TruOffers verified". */
export function claimState(level: VerificationLevel | undefined) {
  if ((level ?? 0) >= VerificationLevel.VERIFIED) return 'verified';
  return level === VerificationLevel.CLAIM_PENDING ? 'in_review' : 'unclaimed';
}

@Injectable()
export class BusinessesService {
  constructor(
    @InjectModel(Business.name) private businessModel: Model<BusinessDocument>,
    @InjectModel(Claim.name) private claimModel: Model<ClaimDocument>,
    @InjectModel(MenuItem.name) private menuModel: Model<MenuItemDocument>,
    @InjectModel(Offer.name) private offerModel: Model<OfferDocument>,
    @InjectModel(Category.name) private categoryModel: Model<CategoryDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(BusinessInvite.name) private inviteModel: Model<BusinessInviteDocument>,
    @InjectModel(BusinessChangeRequest.name) private changeModel: Model<BusinessChangeRequestDocument>,
    private readonly access: BusinessAccessService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly plans: PlansService,
  ) {}

  // ---------------------------------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------------------------------

  async list(params: {
    town?: string;
    category?: string;
    verified?: boolean;
    featured?: boolean;
    q?: string;
    page?: number;
    limit?: number;
  }) {
    const filter: Record<string, unknown> = { status: BusinessStatus.ACTIVE };
    if (params.town) filter.town = new RegExp(`^${escapeRegex(params.town)}$`, 'i');
    if (params.verified) filter.verificationLevel = { $gte: VerificationLevel.VERIFIED };
    if (params.featured) filter.featured = true;
    if (params.category) {
      const cat = await this.categoryModel.findOne({ slug: params.category });
      if (cat) filter.categories = cat._id;
    }
    if (params.q) {
      // Spec T2.1: search by name or postcode.
      const q = params.q.trim();
      const compact = q.toUpperCase().replace(/\s+/g, '');
      filter.$or = [
        { name: new RegExp(escapeRegex(q), 'i') },
        ...(/^[A-Z]{1,2}\d/.test(compact) ? [{ postcode: new RegExp(`^${escapeRegex(compact).replace(/(\d[A-Z]{2})$/, ' ?$1')}`, 'i') }] : []),
      ];
    }

    const page = Math.max(1, params.page || 1);
    const limit = Math.min(50, params.limit || 20);
    const [items, total] = await Promise.all([
      this.businessModel
        .find(filter)
        .select(PUBLIC_BUSINESS_PROJECTION)
        .sort({ featured: -1, verificationLevel: -1, trustScore: -1, 'reviews.rating': -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('categories', 'name slug emoji')
        .lean(),
      this.businessModel.countDocuments(filter),
    ]);
    return { items: items.map((b) => ({ ...b, claimState: claimState(b.verificationLevel) })), total, page, pages: Math.ceil(total / limit) };
  }

  /** Live numbers for the homepage, so the stats always agree with the directory. */
  async publicStats() {
    const now = new Date();
    const activeBusinessIds = await this.businessModel.distinct('_id', { status: BusinessStatus.ACTIVE });
    const [listed, verified, liveOffers] = await Promise.all([
      this.businessModel.countDocuments({ status: BusinessStatus.ACTIVE }),
      this.businessModel.countDocuments({ status: BusinessStatus.ACTIVE, verificationLevel: { $gte: VerificationLevel.VERIFIED } }),
      this.offerModel.countDocuments({
        businessId: { $in: activeBusinessIds },
        status: { $in: PUBLIC_OFFER_STATUSES },
        $or: [{ endsAt: null }, { endsAt: { $gte: now } }],
      }),
    ]);
    return { listed, verified, liveOffers };
  }

  async towns() {
    return this.businessModel.aggregate([
      { $match: { status: BusinessStatus.ACTIVE, town: { $ne: null } } },
      { $group: { _id: '$town', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $project: { town: '$_id', count: 1, _id: 0 } },
    ]);
  }

  // Suspended, pending and closed listings are not public, including by direct link.
  async findBySlug(slug: string) {
    const business = await this.businessModel
      .findOne({ slug, status: BusinessStatus.ACTIVE })
      .select(PUBLIC_BUSINESS_PROJECTION)
      .populate('categories', 'name slug emoji')
      .lean();
    if (!business) throw new NotFoundException('Business not found');
    const now = new Date();
    const [offers, menu, checkingAvailability] = await Promise.all([
      this.offerModel
        .find({
          businessId: business._id,
          status: { $in: PUBLIC_OFFER_STATUSES },
          $or: [{ endsAt: null }, { endsAt: { $gte: now } }],
        })
        .select(PUBLIC_OFFER_PROJECTION)
        .sort({ createdAt: -1 })
        .lean(),
      // A menu mirrored from Foodbell (src/foodbell) is the menu while it lasts; items typed in here wait behind it.
      this.menuModel
        .exists({ businessId: business._id, source: 'foodbell' })
        .then((mirrored) => this.menuModel.find({ businessId: business._id, ...(mirrored ? { source: 'foodbell' } : {}) }).sort({ section: 1, sortOrder: 1 }).lean()),
      // Spec §9: imported offers hidden while a recheck confirms whether they are still offered.
      this.offerModel.countDocuments({ businessId: business._id, status: OfferStatus.POSSIBLY_REMOVED, $or: [{ endsAt: null }, { endsAt: { $gte: now } }] }),
    ]);
    return { business: { ...business, claimState: claimState(business.verificationLevel) }, offers, menu, checkingAvailability };
  }

  // ---------------------------------------------------------------------------------------------------
  // Creating listings
  // ---------------------------------------------------------------------------------------------------

  async create(
    dto: CreateBusinessDto,
    options: {
      source: BusinessSource;
      status?: BusinessStatus;
      importSource?: { scrapedWebsiteRef: Types.ObjectId; domain: string; importedAt: Date; lastCheckedAt?: Date };
    },
  ) {
    const slug = await this.uniqueSlug(dto.name);
    const postcode = normalisePostcode(dto.postcode);
    const geo = await geocodePostcode(postcode);
    const website = normaliseUrl(dto.website) ?? undefined;
    const orderUrl = normaliseUrl(dto.orderUrl) ?? undefined;
    if (dto.orderUrl && !orderUrl) throw new BadRequestException('The order link is not a valid web address');
    const business = await this.businessModel
      .create({
        ...dto,
        website,
        orderUrl,
        ...deriveBusinessIdentity({ name: dto.name, phone: dto.phone, postcode, website }),
        slug,
        postcode,
        postcodeArea: outwardCode(postcode),
        location: geo ? { type: 'Point', coordinates: [geo.lng, geo.lat] } : undefined,
        verificationLevel: VerificationLevel.UNCLAIMED,
        status: options.status ?? BusinessStatus.ACTIVE,
        source: options.source,
        categories: (dto.categories || []).map((id) => new Types.ObjectId(id)),
        importSource: options.importSource,
      })
      .catch((err) => {
        throw duplicateListing(err);
      });
    if (business.categories.length) {
      await this.categoryModel.updateMany({ _id: { $in: business.categories } }, { $inc: { businessCount: 1 } });
    }
    return business;
  }

  /** Spec T2.2: listings that may be the same takeaway (same phone, or same postcode and similar name). */
  async possibleDuplicates(input: { name: string; phone?: string; postcode: string }) {
    const identity = deriveBusinessIdentity({ name: input.name, phone: input.phone, postcode: normalisePostcode(input.postcode) });
    const or: Record<string, unknown>[] = [];
    if (identity.phoneE164) or.push({ phoneE164: identity.phoneE164 });
    if (identity.postcodeCanonical) {
      const firstWord = (identity.nameNormalized ?? '').split(' ')[0];
      or.push({
        postcodeCanonical: identity.postcodeCanonical,
        ...(firstWord ? { nameNormalized: new RegExp(`(^|\\s)${escapeRegex(firstWord)}`) } : {}),
      });
    }
    if (!or.length) return [];
    return this.businessModel
      .find({ $or: or, status: { $in: [BusinessStatus.ACTIVE, BusinessStatus.PENDING] } })
      .select('name slug town postcode address phone verificationLevel status')
      .limit(10)
      .lean();
  }

  // ---------------------------------------------------------------------------------------------------
  // The business's own dashboard
  // ---------------------------------------------------------------------------------------------------

  async mine(userId: string) {
    const rows = await this.access.mine(userId);
    return rows.map(({ business, role }) => ({ ...business.toJSON(), myRole: role, claimState: claimState(business.verificationLevel) }));
  }

  /** Everything the dashboard needs about one business: profile, team role, plan and usage, verification. */
  async manage(businessId: string, user: AuthUser) {
    const business = await this.access.load(businessId, user, 'staff');
    await business.populate('categories', 'name slug emoji');
    const [plan, sub, liveOffers, openClaim, changeRequests, settings] = await Promise.all([
      this.plans.planFor(business._id),
      this.plans.activeSubscription(business._id).lean(),
      this.offerModel.countDocuments({ businessId: business._id, status: { $in: PLAN_COUNTED_OFFER_STATUSES } }),
      this.claimModel
        .findOne({ businessId: business._id, status: { $in: [...OPEN_CLAIM_STATUSES, 'rejected', 'expired'] } })
        .sort({ createdAt: -1 })
        .select('status kind phoneOtpPassed domainCheckPassed fhrsMatch submittedAt expiresAt notes reasonCode decidedAt userId createdAt')
        .lean(),
      this.changeModel.find({ businessId: business._id, status: 'pending' }).sort({ createdAt: -1 }).lean(),
      this.settings.get(),
    ]);
    const { members: _members, ...rest } = business.toJSON() as unknown as Record<string, unknown>;
    return {
      business: { ...rest, claimState: claimState(business.verificationLevel) },
      myRole: memberRole(business, user.userId) ?? (can(user, Capability.BUSINESS_EDIT) ? 'staff_override' : null),
      plan: {
        key: plan.key,
        name: plan.name,
        limits: plan.limits,
        flags: plan.flags,
        autoApprove: plan.autoApprove,
        subscription: sub
          ? {
              _id: sub._id,
              status: sub.status,
              interval: sub.interval,
              price: sub.price,
              currentPeriodEnd: sub.currentPeriodEnd,
              cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
              pendingPlanKey: sub.pendingPlanKey,
              comp: sub.comp,
            }
          : null,
      },
      usage: { liveOffers, photos: business.photos.length },
      openClaim,
      lockedFields: lockedFields(business.verificationLevel),
      pendingChanges: changeRequests,
      orderLinkCheck: checkLink(business.orderUrl, business, settings.knownOrderingDomains),
      reverificationDue: !!business.reverificationDueAt && business.reverificationDueAt.getTime() < Date.now(),
    };
  }

  /**
   * Profile editing. Staff with the business.edit capability change anything directly; the business's team
   * changes locked fields through a moderator (a change request), and everything else at once.
   */
  async update(id: string, dto: UpdateBusinessDto, user: AuthUser) {
    const business = await this.access.load(id, user, 'staff', { write: true });
    const staffEdit = can(user, Capability.BUSINESS_EDIT) && !memberRole(business, user.userId);
    const settings = await this.settings.get();

    const incoming: Record<string, unknown> = {};
    for (const field of PROFILE_FIELDS) {
      if (dto[field] !== undefined) incoming[field] = dto[field];
    }
    for (const field of ['website', 'orderUrl'] as const) {
      if (typeof incoming[field] === 'string') {
        const raw = (incoming[field] as string).trim();
        const url = raw ? normaliseUrl(raw) : '';
        if (url === null) throw new BadRequestException(`The ${field === 'website' ? 'website' : 'order link'} is not a valid web address`);
        incoming[field] = url || undefined;
      }
    }
    if (typeof incoming.postcode === 'string') incoming.postcode = normalisePostcode(incoming.postcode as string);
    if (incoming.photos && !staffEdit) {
      const plan = await this.plans.planFor(business._id);
      const max = plan.limits.maxPhotos;
      if (max >= 0 && (incoming.photos as string[]).length > max) {
        throw new ForbiddenException(`Your ${plan.name} plan allows ${max} photos. Upgrade to add more.`);
      }
    }

    // Only fields that actually change count.
    const changes = Object.entries(incoming).filter(([field, value]) => {
      const current = field === 'categories' ? business.categories.map(String) : (business as unknown as Record<string, unknown>)[field];
      const currentJson = JSON.stringify(current && typeof current === 'object' && 'toObject' in current ? (current as { toObject(): unknown }).toObject() : current ?? null);
      return JSON.stringify(value ?? null) !== currentJson;
    });
    const locked = staffEdit ? [] : lockedFields(business.verificationLevel);
    const direct = changes.filter(([field]) => !locked.includes(field));
    const held = changes.filter(([field]) => locked.includes(field));

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const [field, value] of direct) {
      before[field] = (business as unknown as Record<string, unknown>)[field];
      after[field] = value;
    }
    if (direct.length) {
      await this.applyFields(business, Object.fromEntries(direct));
      await business.save().catch((err) => {
        throw duplicateListing(err);
      });
      await this.audit.record({ action: 'business.updated', targetType: 'Business', targetId: business._id, before, after });
    }

    let changeRequest: BusinessChangeRequestDocument | null = null;
    if (held.length) {
      const fields = held.map(([field]) => field);
      await this.changeModel.updateMany(
        { businessId: business._id, status: 'pending', 'changes.field': { $in: fields } },
        { $set: { status: 'superseded' } },
      );
      const proposedOrderUrl = held.find(([field]) => field === 'orderUrl')?.[1] as string | undefined;
      changeRequest = await this.changeModel.create({
        businessId: business._id,
        requestedBy: new Types.ObjectId(user.userId),
        changes: held.map(([field, to]) => ({ field, from: (business as unknown as Record<string, unknown>)[field], to })),
        orderLinkCheck: proposedOrderUrl ? checkLink(proposedOrderUrl, { website: (incoming.website as string) ?? business.website }, settings.knownOrderingDomains) : undefined,
      });
      await this.audit.record({
        action: 'business.change_requested',
        targetType: 'Business',
        targetId: business._id,
        after: Object.fromEntries(held),
        note: `Waiting for a moderator: ${fields.join(', ')}`,
      });
    }
    return { business, changeRequest, heldFields: held.map(([f]) => f) };
  }

  /** Writes profile fields, keeping the derived identity, area and location in step. */
  async applyFields(business: BusinessDocument, fields: Record<string, unknown>) {
    const previousCategories = business.categories.map(String);
    for (const [field, value] of Object.entries(fields)) {
      if (field === 'categories') business.categories = (value as string[]).map((c) => new Types.ObjectId(c));
      else business.set(field, value);
    }
    if (fields.postcode) {
      business.postcodeArea = outwardCode(business.postcode);
      const geo = await geocodePostcode(business.postcode);
      if (geo) business.location = { type: 'Point', coordinates: [geo.lng, geo.lat] } as never;
    }
    Object.assign(
      business,
      deriveBusinessIdentity({ name: business.name, phone: business.phone, postcode: business.postcode, website: business.website }),
    );
    if (fields.categories) {
      const now = business.categories.map(String);
      const added = now.filter((c) => !previousCategories.includes(c));
      const removed = previousCategories.filter((c) => !now.includes(c));
      if (added.length) await this.categoryModel.updateMany({ _id: { $in: added } }, { $inc: { businessCount: 1 } });
      if (removed.length) await this.categoryModel.updateMany({ _id: { $in: removed } }, { $inc: { businessCount: -1 } });
    }
  }

  changeRequests(businessId: string, user: AuthUser) {
    return this.access.load(businessId, user, 'staff').then(() =>
      this.changeModel.find({ businessId: new Types.ObjectId(businessId) }).sort({ createdAt: -1 }).limit(50).lean(),
    );
  }

  /** Multi-location stats across every business the user is on the team of. */
  async myBusinessesStats(userId: string) {
    const rows = await this.access.mine(userId);
    const businesses = rows.map((r) => r.business);
    if (businesses.length === 0) return { locations: [], totals: null };

    const perBusiness = await this.offerModel.aggregate([
      { $match: { businessId: { $in: businesses.map((b) => b._id) } } },
      {
        $group: {
          _id: '$businessId',
          impressions: { $sum: '$impressions' },
          flips: { $sum: '$flips' },
          detailViews: { $sum: '$detailViews' },
          orderClicks: { $sum: '$orderClicks' },
          redemptions: { $sum: '$redemptionCount' },
          offerCount: { $sum: 1 },
        },
      },
    ]);
    const statsById = new Map(perBusiness.map((s) => [String(s._id), s]));
    const empty = { impressions: 0, flips: 0, detailViews: 0, orderClicks: 0, redemptions: 0, offerCount: 0 };
    const locations = businesses.map((b) => ({
      business: {
        _id: b._id,
        name: b.name,
        slug: b.slug,
        town: b.town,
        postcode: b.postcode,
        verificationLevel: b.verificationLevel,
        reviews: b.reviews,
        followerCount: b.followerCount,
        activeOfferCount: b.activeOfferCount,
        status: b.status,
      },
      role: memberRole(b, userId),
      stats: statsById.get(String(b._id)) || { _id: b._id, ...empty },
    }));
    const totals = locations.reduce(
      (acc, l) => ({
        impressions: acc.impressions + l.stats.impressions,
        flips: acc.flips + l.stats.flips,
        detailViews: acc.detailViews + l.stats.detailViews,
        orderClicks: acc.orderClicks + l.stats.orderClicks,
        redemptions: acc.redemptions + l.stats.redemptions,
        offerCount: acc.offerCount + l.stats.offerCount,
        activeOffers: acc.activeOffers + (l.business.activeOfferCount || 0),
        followers: acc.followers + (l.business.followerCount || 0),
        locations: acc.locations + 1,
      }),
      { ...empty, activeOffers: 0, followers: 0, locations: 0 },
    );
    return { locations, totals };
  }

  // ---------------------------------------------------------------------------------------------------
  // Team (spec T1.3)
  // ---------------------------------------------------------------------------------------------------

  async team(businessId: string, user: AuthUser) {
    const business = await this.access.load(businessId, user, 'staff');
    const ids = business.members.map((m) => m.userId);
    const [users, invites] = await Promise.all([
      this.userModel.find({ _id: { $in: ids } }).select('name email lastLoginAt').lean(),
      memberRole(business, user.userId) === BusinessMemberRole.OWNER || user.role === Role.SUPER_ADMIN
        ? this.inviteModel
            .find({ businessId: business._id, acceptedAt: { $exists: false }, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } })
            .sort({ createdAt: -1 })
            .lean()
        : Promise.resolve([]),
    ]);
    const byId = new Map(users.map((u) => [String(u._id), u]));
    return {
      members: business.members.map((m) => ({
        userId: m.userId,
        role: m.role,
        addedAt: m.addedAt,
        primary: String(business.ownerId) === String(m.userId),
        name: byId.get(String(m.userId))?.name,
        email: byId.get(String(m.userId))?.email,
        lastLoginAt: byId.get(String(m.userId))?.lastLoginAt,
      })),
      invites,
      myRole: memberRole(business, user.userId),
    };
  }

  async invite(businessId: string, input: { email: string; role: BusinessMemberRole }, user: AuthUser) {
    const business = await this.access.load(businessId, user, 'owner', { write: true });
    const email = input.email.toLowerCase().trim();
    const existing = await this.userModel.findOne({ email }).select('_id').lean();
    if (existing && memberRole(business, String(existing._id))) throw new ConflictException('This person is already on the team');
    await this.inviteModel.updateMany(
      { businessId: business._id, email, acceptedAt: { $exists: false }, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } },
    );
    const token = randomToken();
    const invite = await this.inviteModel.create({
      businessId: business._id,
      email,
      role: input.role,
      tokenHash: sha256(token),
      invitedBy: new Types.ObjectId(user.userId),
      expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 3600_000),
    });
    const link = siteUrl(`/team-invite?token=${token}`);
    await this.email.send({
      to: email,
      template: 'team_invite',
      vars: { businessName: business.name, inviterName: user.name, role: input.role, link },
    });
    await this.audit.record({ action: 'team.invited', targetType: 'Business', targetId: business._id, after: { email, role: input.role } });
    const { tokenHash: _hash, ...safe } = invite.toObject();
    return { invite: safe, ...(process.env.NODE_ENV !== 'production' ? { devInviteUrl: link } : {}) };
  }

  async revokeInvite(businessId: string, inviteId: string, user: AuthUser) {
    const business = await this.access.load(businessId, user, 'owner');
    const invite = await this.inviteModel.findOneAndUpdate(
      { _id: inviteId, businessId: business._id, acceptedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } },
      { new: true },
    );
    if (!invite) throw new NotFoundException('Invitation not found');
    await this.audit.record({ action: 'team.invite_revoked', targetType: 'Business', targetId: business._id, after: { email: invite.email } });
    return { revoked: true };
  }

  async resolveInvite(token: string) {
    const invite = await this.inviteModel.findOne({ tokenHash: sha256(token) }).populate('businessId', 'name slug town').lean();
    if (!invite || invite.revokedAt || invite.acceptedAt || invite.expiresAt < new Date()) {
      throw new NotFoundException('This invitation is no longer valid. Ask the owner to send a new one.');
    }
    return { business: invite.businessId, email: invite.email, role: invite.role, expiresAt: invite.expiresAt };
  }

  async acceptInvite(token: string, user: AuthUser) {
    const invite = await this.inviteModel.findOne({ tokenHash: sha256(token) });
    if (!invite || invite.revokedAt || invite.acceptedAt || invite.expiresAt < new Date()) {
      throw new NotFoundException('This invitation is no longer valid. Ask the owner to send a new one.');
    }
    if (invite.email !== user.email.toLowerCase()) {
      throw new ForbiddenException(`This invitation was sent to ${invite.email}. Log in with that email to accept it.`);
    }
    const business = await this.businessModel.findById(invite.businessId);
    if (!business) throw new NotFoundException('Business not found');
    if (!memberRole(business, user.userId)) {
      business.members.push({ userId: new Types.ObjectId(user.userId), role: invite.role, addedAt: new Date(), invitedBy: invite.invitedBy });
      await business.save();
    }
    invite.set({ acceptedAt: new Date(), acceptedBy: new Types.ObjectId(user.userId) });
    await invite.save();
    await this.promoteAccountType(user.userId, invite.role);
    await this.audit.record({ action: 'team.joined', targetType: 'Business', targetId: business._id, after: { userId: user.userId, role: invite.role } });
    await this.notifications.notifyBusiness(
      business._id,
      { type: 'team_joined', title: `${user.name} joined the team`, body: `${user.name} accepted your invitation as ${invite.role}.`, link: '/dashboard/team' },
      'owners',
    );
    return { business: { _id: business._id, name: business.name, slug: business.slug }, role: invite.role };
  }

  async updateMember(businessId: string, memberId: string, role: BusinessMemberRole, user: AuthUser) {
    const business = await this.access.load(businessId, user, 'owner', { write: true });
    const member = business.members.find((m) => String(m.userId) === memberId);
    if (!member) throw new NotFoundException('Team member not found');
    const before = member.role;
    if (before === BusinessMemberRole.OWNER && role !== BusinessMemberRole.OWNER && this.ownerCount(business) <= 1) {
      throw new BadRequestException('A business needs at least one owner');
    }
    member.role = role;
    business.markModified('members');
    await business.save();
    if (role === BusinessMemberRole.OWNER) await this.promoteAccountType(memberId, role);
    await this.audit.record({ action: 'team.role_changed', targetType: 'Business', targetId: business._id, before: { userId: memberId, role: before }, after: { userId: memberId, role } });
    return { userId: memberId, role };
  }

  async removeMember(businessId: string, memberId: string, user: AuthUser) {
    // Anyone may leave a team; only owners remove others.
    const leaving = memberId === user.userId;
    const business = await this.access.load(businessId, user, leaving ? 'staff' : 'owner', { write: true });
    const member = business.members.find((m) => String(m.userId) === memberId);
    if (!member) throw new NotFoundException('Team member not found');
    if (member.role === BusinessMemberRole.OWNER && this.ownerCount(business) <= 1) {
      throw new BadRequestException('A business needs at least one owner. Make someone else an owner first.');
    }
    business.members = business.members.filter((m) => String(m.userId) !== memberId);
    if (String(business.ownerId) === memberId) {
      business.ownerId = business.members.find((m) => m.role === BusinessMemberRole.OWNER)?.userId;
    }
    await business.save();
    await this.audit.record({ action: leaving ? 'team.left' : 'team.removed', targetType: 'Business', targetId: business._id, before: { userId: memberId, role: member.role } });
    return { removed: true };
  }

  private ownerCount(business: BusinessDocument) {
    return business.members.filter((m) => m.role === BusinessMemberRole.OWNER).length;
  }

  /** A customer who joins a team gets a business account, so the dashboard opens for them. */
  async promoteAccountType(userId: string, role: BusinessMemberRole) {
    const target = role === BusinessMemberRole.OWNER ? Role.BUSINESS_OWNER : Role.BUSINESS_STAFF;
    await this.userModel.updateOne(
      { _id: userId, role: { $in: role === BusinessMemberRole.OWNER ? [Role.CUSTOMER, Role.BUSINESS_STAFF] : [Role.CUSTOMER] } },
      { $set: { role: target } },
    );
  }

  // ---------------------------------------------------------------------------------------------------
  // Menu
  // ---------------------------------------------------------------------------------------------------

  async menu(businessId: string, user: AuthUser) {
    await this.access.load(businessId, user, 'staff');
    return this.menuModel.find({ businessId: new Types.ObjectId(businessId) }).sort({ section: 1, sortOrder: 1 }).lean();
  }

  async addMenuItem(businessId: string, dto: CreateMenuItemDto, user: AuthUser) {
    await this.access.load(businessId, user, 'staff', { write: true });
    const item = await this.menuModel.create({ ...dto, businessId: new Types.ObjectId(businessId) });
    await this.audit.record({ action: 'menu.item_added', targetType: 'Business', targetId: businessId, after: { name: item.name, price: item.price, section: item.section } });
    return item;
  }

  async updateMenuItem(businessId: string, itemId: string, dto: UpdateMenuItemDto, user: AuthUser) {
    await this.access.load(businessId, user, 'staff', { write: true });
    const item = await this.menuModel.findOne({ _id: itemId, businessId: new Types.ObjectId(businessId) });
    if (!item) throw new NotFoundException('Menu item not found');
    assertOwnMenuItem(item);
    const before = { name: item.name, price: item.price, section: item.section, description: item.description };
    item.set(dto);
    await item.save();
    await this.audit.record({ action: 'menu.item_updated', targetType: 'Business', targetId: businessId, before, after: { ...dto } });
    return item;
  }

  async removeMenuItem(businessId: string, itemId: string, user: AuthUser) {
    await this.access.load(businessId, user, 'staff', { write: true });
    const item = await this.menuModel.findOne({ _id: itemId, businessId: new Types.ObjectId(businessId) });
    if (item) assertOwnMenuItem(item);
    if (item) await item.deleteOne();
    if (item) await this.audit.record({ action: 'menu.item_removed', targetType: 'Business', targetId: businessId, before: { name: item.name, price: item.price } });
    return { deleted: true };
  }

  async uniqueSlug(name: string) {
    const base = slugify(name, { lower: true, strict: true }) || 'takeaway';
    let slug = base;
    let i = 1;
    while (await this.businessModel.exists({ slug })) {
      slug = `${base}-${++i}`;
    }
    return slug;
  }

  linkCheck(business: { website?: string; orderUrl?: string }, url?: string): Promise<LinkCheck> {
    return this.settings.get().then((s) => checkLink(url ?? business.orderUrl, business, s.knownOrderingDomains));
  }
}
