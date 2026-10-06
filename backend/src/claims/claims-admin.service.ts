import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { normaliseUkPhone } from '../common/business-identity';
import { memberRole } from '../common/business-access';
import {
  BusinessMemberRole,
  BusinessStatus,
  ClaimKind,
  ClaimRejectReason,
  ClaimStatus,
  Role,
  STAFF_ROLES,
  VerificationLevel,
} from '../common/enums';
import { checkLink } from '../common/order-link';
import { escapeRegex } from '../businesses/businesses.service';
import { siteUrl } from '../platform/email.service';
import { SettingsService } from '../platform/settings.service';
import { OfferPublishingService } from '../offers/offer-publishing.service';
import { BusinessChangeRequest, BusinessChangeRequestDocument } from '../schemas/business-team.schema';
import { ClaimDocument } from '../schemas/claim.schema';
import { UserStatus } from '../schemas/user.schema';
import { ChecklistDto } from './claims.dto';
import { ClaimsService, summariseEvidence } from './claims.service';

export const CLAIM_REJECT_LABELS: Record<ClaimRejectReason, string> = {
  mismatch: 'The details or evidence do not match the listing',
  fake_document: 'A document looks altered or not genuine',
  duplicate: 'This takeaway is already listed and claimed',
  not_a_takeaway: 'This is not a takeaway we can list',
  other: 'We could not confirm you run this business',
};

const REVERIFY_MONTHS = 12;
const INFO_DAYS = 14;
const PAGE_SIZE = 30;

/** Spec T2.5: the verification queue, side-by-side review, checklist and decisions. */
@Injectable()
export class ClaimsAdminService {
  constructor(
    private readonly claimsService: ClaimsService,
    private readonly publishing: OfferPublishingService,
    private readonly settings: SettingsService,
    @InjectModel(BusinessChangeRequest.name) private readonly changes: Model<BusinessChangeRequestDocument>,
  ) {}

  private get claims() {
    return this.claimsService.claims;
  }

  private get businesses() {
    return this.claimsService.businesses;
  }

  async list(query: { status?: string; assigned?: string; q?: string; page?: string }, reviewerId: string, limit = PAGE_SIZE) {
    const filter: Record<string, unknown> = {};
    const status = query.status || 'queue';
    if (status === 'queue') filter.status = { $in: [ClaimStatus.PENDING, ClaimStatus.DISPUTED] };
    else if (status !== 'all') filter.status = { $in: status.split(',') };
    else filter.status = { $ne: ClaimStatus.DRAFT };
    if (query.assigned === 'me') filter.assignedTo = new Types.ObjectId(reviewerId);
    else if (query.assigned === 'unassigned') filter.assignedTo = { $exists: false };
    if (query.q) {
      const regex = new RegExp(escapeRegex(query.q), 'i');
      const [businessIds, userIds] = await Promise.all([
        this.businesses.find({ $or: [{ name: regex }, { postcode: regex }] }).distinct('_id'),
        this.claimsService.users.find({ $or: [{ email: regex }, { name: regex }] }).distinct('_id'),
      ]);
      filter.$or = [{ businessId: { $in: businessIds } }, { userId: { $in: userIds } }];
    }
    const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
    const [items, total, counts, oldest] = await Promise.all([
      this.claims
        .find(filter)
        .sort({ submittedAt: 1, createdAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('businessId', 'name slug town postcode verificationLevel status frozen')
        .populate('userId', 'name email')
        .populate('assignedTo', 'name email')
        .lean(),
      this.claims.countDocuments(filter),
      this.claims.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      this.claims.findOne({ status: { $in: [ClaimStatus.PENDING, ClaimStatus.DISPUTED] } }).sort({ submittedAt: 1 }).select('submittedAt').lean(),
    ]);
    const files = await this.claimsService.files.find({ claimId: { $in: items.map((c) => c._id) }, deletedAt: { $exists: false } }).select('claimId type deletedAt').lean();
    const now = Date.now();
    return {
      items: items.map((c) => ({
        ...c,
        ageHours: c.submittedAt ? Math.round((now - new Date(c.submittedAt).getTime()) / 3600_000) : null,
        evidence: summariseEvidence(c, files.filter((f) => String(f.claimId) === String(c._id))),
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
      counts: Object.fromEntries(counts.map((c) => [c._id, c.count])),
      oldestPendingAt: oldest?.submittedAt ?? null,
    };
  }

  private async load(id: string) {
    const claim = Types.ObjectId.isValid(id) ? await this.claims.findById(id) : null;
    if (!claim) throw new NotFoundException('Claim not found');
    return claim;
  }

  /** Side by side: the listing's data, the evidence, and the signals behind each checklist item. */
  async detail(id: string) {
    const claim = await this.load(id);
    await claim.populate([{ path: 'userId', select: 'name email phone emailVerifiedAt createdAt status role' }, { path: 'assignedTo', select: 'name email' }, { path: 'messages.userId', select: 'name' }]);
    const business = await this.businesses.findById(claim.businessId).populate('categories', 'name').lean();
    if (!business) throw new NotFoundException('Business not found');
    const claimant = claim.userId as unknown as { _id: Types.ObjectId; email: string; phone?: string };
    const settings = await this.settings.get();
    const [files, otherClaims, owners, suspendedLinks, previous] = await Promise.all([
      this.claimsService.files.find({ claimId: claim._id, deletedAt: { $exists: false } }).sort({ uploadedAt: 1 }).lean(),
      this.claims
        .find({ businessId: business._id, _id: { $ne: claim._id } })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('userId', 'name email')
        .select('status kind userId createdAt decidedAt reasonCode')
        .lean(),
      this.claimsService.users.find({ _id: { $in: (business.members ?? []).map((m) => m.userId) } }).select('name email').lean(),
      this.suspendedLinks(claimant),
      this.claims.countDocuments({ userId: claimant._id, status: ClaimStatus.REJECTED }),
    ]);
    const { phoneCheck, domainCheck, ...rest } = claim.toObject();
    return {
      claim: {
        ...rest,
        phoneCheck: { phone: phoneCheck?.phone, channel: phoneCheck?.channel, mode: phoneCheck?.mode, sentAt: phoneCheck?.sentAt, attempts: phoneCheck?.attempts, sends: phoneCheck?.sends, passedAt: phoneCheck?.passedAt },
        domainCheck: { domain: domainCheck?.domain, method: domainCheck?.method, email: domainCheck?.email, passedAt: domainCheck?.passedAt, lastError: domainCheck?.lastError },
        ageHours: claim.submittedAt ? Math.round((Date.now() - claim.submittedAt.getTime()) / 3600_000) : null,
      },
      business: {
        ...business,
        members: (business.members ?? []).map((m) => ({ ...m, user: owners.find((u) => String(u._id) === String(m.userId)) })),
      },
      documents: files.map((f) => ({ _id: f._id, type: f.type, originalName: f.originalName, size: f.size, mime: f.mime, status: f.status, uploadedAt: f.uploadedAt })),
      evidence: summariseEvidence(claim, files),
      signals: {
        listingPhoneMatchesCheck: !!phoneCheck?.phone && normaliseUkPhone(business.phone) === phoneCheck.phone,
        orderLink: checkLink(business.orderUrl, business, settings.knownOrderingDomains),
        otherOwners: (business.members ?? []).filter((m) => String(m.userId) !== String(claimant._id) && m.role === BusinessMemberRole.OWNER).length,
        suspendedLinks,
        previousRejectedClaims: previous,
      },
      otherClaims,
    };
  }

  /** Checklist item 5: the claimant's email or phone linked to a banned account or a suspended business. */
  private async suspendedLinks(claimant: { _id: Types.ObjectId; email: string; phone?: string }) {
    const phone = normaliseUkPhone(claimant.phone);
    const banned = await this.claimsService.users
      .find({
        _id: { $ne: claimant._id },
        status: UserStatus.BANNED,
        $or: [{ email: claimant.email }, ...(phone ? [{ phone: claimant.phone }] : [])],
      })
      .select('name email status')
      .limit(5)
      .lean();
    const suspendedBusinesses = await this.businesses
      .find({ status: BusinessStatus.SUSPENDED, 'members.userId': claimant._id })
      .select('name slug')
      .limit(5)
      .lean();
    return { bannedAccounts: banned, suspendedBusinesses };
  }

  async assign(id: string, userId: string | null | undefined) {
    const claim = await this.load(id);
    const before = claim.assignedTo;
    if (userId) {
      const staff = await this.claimsService.users.findOne({ _id: userId, role: { $in: STAFF_ROLES } }).select('_id').lean();
      if (!staff) throw new BadRequestException('Claims can only be assigned to moderators and admins');
      claim.assignedTo = new Types.ObjectId(userId);
    } else claim.assignedTo = undefined;
    await claim.save();
    await this.claimsService.audit.record({ action: 'claim.assigned', targetType: 'Claim', targetId: claim._id, before: { assignedTo: before }, after: { assignedTo: userId ?? null } });
    return { assignedTo: claim.assignedTo ?? null };
  }

  async checklist(id: string, dto: ChecklistDto) {
    const claim = await this.load(id);
    const before = { ...(claim.checklist as object) };
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) claim.set(`checklist.${key}`, value);
    }
    await claim.save();
    await this.claimsService.audit.record({ action: 'claim.checklist_updated', targetType: 'Claim', targetId: claim._id, before, after: { ...dto } });
    return claim.checklist;
  }

  async documentStatus(id: string, documentId: string, status: string) {
    const claim = await this.load(id);
    const doc = await this.claimsService.files.findOneAndUpdate({ _id: documentId, claimId: claim._id }, { $set: { status } }, { new: true });
    if (!doc) throw new NotFoundException('Document not found');
    await this.claimsService.audit.record({ action: 'claim.document_reviewed', targetType: 'Claim', targetId: claim._id, after: { document: documentId, status } });
    return doc;
  }

  async readDocument(id: string, documentId: string) {
    const claim = await this.load(id);
    const doc = await this.claimsService.files.findOne({ _id: documentId, claimId: claim._id, deletedAt: { $exists: false } });
    if (!doc) throw new NotFoundException('Document not found (documents are deleted 90 days after a decision)');
    await this.claimsService.audit.record({ action: 'claim.document_viewed', targetType: 'Claim', targetId: claim._id, after: { document: documentId } });
    return { ...(await this.claimsService.storage.read(doc.storageKey)), name: doc.originalName ?? `${doc.type}.${doc.storageKey.split('.').pop()}` };
  }

  async message(id: string, body: string, reviewerId: string) {
    const claim = await this.load(id);
    claim.messages.push({ from: 'moderator', userId: new Types.ObjectId(reviewerId), body } as never);
    await claim.save();
    const business = await this.businesses.findById(claim.businessId).select('name').lean();
    await this.claimsService.notifications.notifyUsers([claim.userId], {
      type: 'claim_message',
      title: `A message about ${business?.name ?? 'your verification'}`,
      body: body.slice(0, 200),
      link: '/dashboard/verification',
      businessId: claim.businessId,
    });
    return claim.messages;
  }

  // ---------------------------------------------------------------------------------------------------
  // Decisions
  // ---------------------------------------------------------------------------------------------------

  /**
   * Approve: level 2 (verified), the badge shows, the owner is told, and offers held while unverified go
   * through. On a dispute, the claimant becomes the owner and the previous owners leave the team.
   */
  async approve(id: string, reviewerId: string, note?: string) {
    const claim = await this.load(id);
    if (![ClaimStatus.PENDING, ClaimStatus.INFO_REQUESTED, ClaimStatus.DISPUTED].includes(claim.status)) {
      throw new BadRequestException(`This claim is ${claim.status}; only submitted claims can be approved`);
    }
    if (!claim.phoneOtpPassed) throw new BadRequestException('The phone check has not been passed');
    const business = await this.businesses.findById(claim.businessId);
    if (!business) throw new NotFoundException('Business not found');
    const before = { verificationLevel: business.verificationLevel, status: business.status, owners: business.members.filter((m) => m.role === BusinessMemberRole.OWNER).map((m) => String(m.userId)) };
    const claimant = claim.userId;
    const wasDisputed = claim.status === ClaimStatus.DISPUTED;
    const replacedOwners = wasDisputed ? (claim.disputedOwnerIds ?? []).map(String) : [];

    if (wasDisputed) business.members = business.members.filter((m) => !replacedOwners.includes(String(m.userId)));
    if (!memberRole(business, String(claimant))) {
      business.members.push({ userId: claimant, role: BusinessMemberRole.OWNER, addedAt: new Date() });
    } else {
      const member = business.members.find((m) => String(m.userId) === String(claimant));
      if (member) member.role = BusinessMemberRole.OWNER;
    }
    if (!business.ownerId || wasDisputed || replacedOwners.includes(String(business.ownerId))) business.ownerId = claimant;
    const now = new Date();
    business.set({
      verificationLevel: Math.max(business.verificationLevel, VerificationLevel.VERIFIED),
      verifiedAt: now,
      reverificationDueAt: new Date(new Date(now).setMonth(now.getMonth() + REVERIFY_MONTHS)),
      reverificationNotifiedAt: undefined,
      frozen: false,
      disputeClaimId: undefined,
      trustScore: Math.min(100, (business.trustScore ?? 0) + (claim.kind === ClaimKind.REVERIFICATION ? 0 : 20)),
    });
    if (business.status === BusinessStatus.PENDING) business.status = BusinessStatus.ACTIVE;
    if (claim.fhrsMatch && claim.fhrs?.fhrsId) business.set({ fhrsId: claim.fhrs.fhrsId, fhrsRating: claim.fhrs.rating });
    business.markModified('members');
    await business.save();

    claim.set({ status: ClaimStatus.APPROVED, reviewerId: new Types.ObjectId(reviewerId), decidedAt: now, notes: note, expiresAt: undefined });
    await claim.save();
    await this.claimsService.files.updateMany({ claimId: claim._id, deletedAt: { $exists: false } }, { $set: { deleteAfter: new Date(Date.now() + 90 * 24 * 3600_000) } });
    await this.claimsService.users.updateOne({ _id: claimant, role: { $in: [Role.CUSTOMER, Role.BUSINESS_STAFF] } }, { $set: { role: Role.BUSINESS_OWNER } });
    await this.claimsService.markInvitationsClaimed(business._id, claimant);
    const held = await this.publishing.submitHeldDrafts(business._id);

    await this.claimsService.audit.record({
      action: 'claim.approved',
      targetType: 'Claim',
      targetId: claim._id,
      before,
      after: { verificationLevel: business.verificationLevel, status: business.status, owner: String(claimant), replacedOwners, heldOffersSubmitted: held.submitted },
      note,
    });
    await this.claimsService.audit.record({
      action: 'business.verified',
      targetType: 'Business',
      targetId: business._id,
      before: { verificationLevel: before.verificationLevel },
      after: { verificationLevel: business.verificationLevel, claim: String(claim._id) },
    });
    await this.claimsService.notifications.notifyUsers([claimant], {
      type: 'claim_approved',
      title: `${business.name} is TruOffers verified`,
      body: held.submitted ? `${held.submitted} offer${held.submitted === 1 ? '' : 's'} you saved have been submitted.` : 'Your offers can now go live.',
      link: '/dashboard',
      businessId: business._id,
      email: { template: 'claim_approved', vars: { businessName: business.name, link: siteUrl('/dashboard') } },
    });
    if (replacedOwners.length) {
      await this.claimsService.notifications.notifyUsers(replacedOwners, {
        type: 'claim_dispute_lost',
        title: `You no longer manage ${business.name}`,
        body: 'After reviewing the dispute, our team confirmed another person as the owner. Reply to our email if you think this is wrong.',
        businessId: business._id,
      });
    }
    return { claim, business };
  }

  async requestInfo(id: string, message: string, reviewerId: string) {
    const claim = await this.load(id);
    if (![ClaimStatus.PENDING, ClaimStatus.DISPUTED].includes(claim.status)) throw new BadRequestException(`This claim is ${claim.status}`);
    const expiresAt = new Date(Date.now() + INFO_DAYS * 24 * 3600_000);
    const before = claim.status;
    // A dispute stays a dispute (the listing stays frozen); only the waiting clock starts.
    if (claim.status !== ClaimStatus.DISPUTED) claim.status = ClaimStatus.INFO_REQUESTED;
    claim.set({ infoRequestedAt: new Date(), expiresAt, reviewerId: new Types.ObjectId(reviewerId) });
    claim.messages.push({ from: 'moderator', userId: new Types.ObjectId(reviewerId), body: message } as never);
    await claim.save();
    await this.claimsService.audit.record({ action: 'claim.info_requested', targetType: 'Claim', targetId: claim._id, before: { status: before }, after: { status: claim.status, expiresAt }, note: message });
    const business = await this.businesses.findById(claim.businessId).select('name').lean();
    const expiresOn = expiresAt.toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' });
    await this.claimsService.notifications.notifyUsers([claim.userId], {
      type: 'claim_info_requested',
      title: 'We need a little more information',
      body: message.slice(0, 200),
      link: '/dashboard/verification',
      businessId: claim.businessId,
      email: { template: 'claim_info_requested', vars: { businessName: business?.name, message, expiresOn, link: siteUrl('/dashboard/verification') } },
    });
    return claim;
  }

  /** Reject with a required reason code and a note to the owner. */
  async reject(id: string, reasonCode: ClaimRejectReason, note: string, reviewerId: string) {
    const claim = await this.load(id);
    if (![ClaimStatus.PENDING, ClaimStatus.INFO_REQUESTED, ClaimStatus.DISPUTED].includes(claim.status)) {
      throw new BadRequestException(`This claim is ${claim.status}`);
    }
    claim.set({ reasonCode, notes: note, reviewerId: new Types.ObjectId(reviewerId) });
    await this.claimsService.close(claim, ClaimStatus.REJECTED, note);
    const business = await this.businesses.findById(claim.businessId).select('name members').lean();
    await this.claimsService.notifications.notifyUsers([claim.userId], {
      type: 'claim_rejected',
      title: `We could not verify ${business?.name ?? 'the business'}`,
      body: `${CLAIM_REJECT_LABELS[reasonCode]}. ${note}`,
      link: '/dashboard/verification',
      businessId: claim.businessId,
      email: { template: 'claim_rejected', vars: { businessName: business?.name, reason: CLAIM_REJECT_LABELS[reasonCode], note } },
    });
    return claim;
  }

  // ---------------------------------------------------------------------------------------------------
  // Locked-field changes (re-verification)
  // ---------------------------------------------------------------------------------------------------

  async changeRequests(status = 'pending') {
    const items = await this.changes
      .find(status === 'all' ? {} : { status })
      .sort({ createdAt: 1 })
      .limit(200)
      .populate('businessId', 'name slug town postcode verificationLevel website orderUrl phone')
      .populate('requestedBy', 'name email')
      .populate('reviewedBy', 'name')
      .lean();
    return items;
  }

  async decideChange(id: string, approve: boolean, reviewerId: string, note?: string) {
    const request = Types.ObjectId.isValid(id) ? await this.changes.findById(id) : null;
    if (!request) throw new NotFoundException('Change request not found');
    if (request.status !== 'pending') throw new BadRequestException(`This change is already ${request.status}`);
    const business = await this.businesses.findById(request.businessId);
    if (!business) throw new NotFoundException('Business not found');
    const fields = Object.fromEntries(request.changes.map((c) => [c.field, c.to]));
    const before = Object.fromEntries(request.changes.map((c) => [c.field, (business as unknown as Record<string, unknown>)[c.field]]));
    if (approve) {
      await this.claimsService.businessesService.applyFields(business, fields);
      await business.save();
    }
    request.set({ status: approve ? 'approved' : 'rejected', reviewedBy: new Types.ObjectId(reviewerId), reviewedAt: new Date(), note });
    await request.save();
    await this.claimsService.audit.record({
      action: approve ? 'business.change_approved' : 'business.change_rejected',
      targetType: 'Business',
      targetId: business._id,
      before,
      after: approve ? fields : undefined,
      note,
    });
    const fieldNames = request.changes.map((c) => c.field.replace('orderUrl', 'order link')).join(', ');
    await this.claimsService.notifications.notifyBusiness(business._id, {
      type: 'change_request_decided',
      title: `Your change to ${fieldNames} was ${approve ? 'approved' : 'not approved'}`,
      body: note,
      link: '/dashboard/profile',
      email: { template: 'change_request_decided', vars: { businessName: business.name, outcome: approve ? 'approved' : 'not approved', fields: fieldNames, note } },
    }, 'owners');
    return request;
  }

  /** For the admin overview: how long the oldest claim has waited. */
  async queueStats() {
    const [waiting, oldest, info, changes] = await Promise.all([
      this.claims.countDocuments({ status: { $in: [ClaimStatus.PENDING, ClaimStatus.DISPUTED] } }),
      this.claims.findOne({ status: { $in: [ClaimStatus.PENDING, ClaimStatus.DISPUTED] } }).sort({ submittedAt: 1 }).select('submittedAt').lean(),
      this.claims.countDocuments({ status: ClaimStatus.INFO_REQUESTED }),
      this.changes.countDocuments({ status: 'pending' }),
    ]);
    return {
      waiting,
      infoRequested: info,
      oldestAgeHours: oldest?.submittedAt ? Math.round((Date.now() - new Date(oldest.submittedAt).getTime()) / 3600_000) : null,
      pendingChanges: changes,
    };
  }

  // Exposed for the jobs
  async closeExpired(claim: ClaimDocument) {
    await this.claimsService.close(claim, ClaimStatus.EXPIRED, 'No reply within 14 days');
    const business = await this.businesses.findById(claim.businessId).select('name').lean();
    await this.claimsService.notifications.notifyUsers([claim.userId], {
      type: 'claim_expired',
      title: 'Your claim has closed',
      body: `We did not hear back about ${business?.name ?? 'your business'} within 14 days.`,
      link: '/claim-your-business',
      businessId: claim.businessId,
      email: { template: 'claim_expired', vars: { businessName: business?.name, link: siteUrl('/claim-your-business') } },
    });
  }
}
