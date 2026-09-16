import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash, randomBytes } from 'node:crypto';
import * as QRCode from 'qrcode';
import { PUBLIC_OFFER_STATUSES } from '../../common/enums';
import { AuditAction, OfferOrigin } from '../../common/scraper.enums';
import { Business, BusinessDocument } from '../../schemas/business.schema';
import { MerchantClaimInvitation, MerchantClaimInvitationDocument } from '../../schemas/merchant-claim-invitation.schema';
import { Offer, OfferDocument } from '../../schemas/offer.schema';
import { AuditService } from '../audit/audit.service';
import { invitationMessages, InvitationMessages } from './invitation-messages';

const INVITATION_DAYS = 30;
const CONTACT_CHANNELS = ['email', 'whatsapp', 'phone', 'post', 'in_person', 'other'];

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Spec §14: takeaways whose imported offers are live but whose listing nobody has claimed, and the invitation
 * an administrator can hand them. Nothing is ever sent from here: the admin copies the message and sends it.
 */
@Injectable()
export class OutreachService {
  constructor(
    @InjectModel(MerchantClaimInvitation.name) private readonly invitations: Model<MerchantClaimInvitationDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Offer.name) private readonly offers: Model<OfferDocument>,
    private readonly audit: AuditService,
  ) {}

  private get siteUrl() {
    return (process.env.FRONTEND_URL?.split(',')[0] || 'http://localhost:3000').replace(/\/+$/, '');
  }

  claimUrl(token: string) {
    return `${this.siteUrl}/claim-your-business?invite=${token}`;
  }

  /** Businesses with published imported offers that no one has claimed. */
  async candidates(filter: { q?: string; page?: number; limit?: number } = {}) {
    const limit = Math.min(100, filter.limit ?? 25);
    const page = Math.max(1, filter.page ?? 1);
    const grouped = await this.offers.aggregate<{ _id: Types.ObjectId; offers: number; titles: string[]; domains: string[]; lastCheckedAt?: Date }>([
      { $match: { origin: OfferOrigin.SCRAPER, status: { $in: PUBLIC_OFFER_STATUSES } } },
      {
        $group: {
          _id: '$businessId',
          offers: { $sum: 1 },
          titles: { $push: '$title' },
          domains: { $addToSet: '$sourceDomain' },
          lastCheckedAt: { $max: '$lastCheckedAt' },
        },
      },
    ]);
    const byBusiness = new Map(grouped.map((row) => [String(row._id), row]));

    const query: Record<string, unknown> = { _id: { $in: grouped.map((g) => g._id) }, ownerId: { $exists: false } };
    if (filter.q) query.name = new RegExp(filter.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const [businesses, total] = await Promise.all([
      this.businesses
        .find(query)
        .select('name slug town postcode phone website verificationStatus importSource activeOfferCount')
        .sort({ activeOfferCount: -1, name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.businesses.countDocuments(query),
    ]);
    const latest = await this.invitations
      .find({ businessRef: { $in: businesses.map((b) => b._id) } })
      .sort({ createdAt: -1 })
      .populate('generatedBy', 'name email')
      .lean();

    return {
      items: businesses.map((business) => {
        const row = byBusiness.get(String(business._id));
        const invitations = latest.filter((i) => String(i.businessRef) === String(business._id));
        return {
          business,
          offers: row?.offers ?? 0,
          offerTitles: (row?.titles ?? []).slice(0, 3),
          domain: business.importSource?.domain ?? row?.domains.filter(Boolean)[0],
          lastCheckedAt: row?.lastCheckedAt,
          invitation: invitations[0] ?? null,
          invitationCount: invitations.length,
        };
      }),
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  /**
   * A fresh claim link, QR code and the messages to copy. Any earlier invitation for the business is revoked,
   * so only the newest link works.
   */
  async createInvitation(businessId: string, userId: string) {
    const business = Types.ObjectId.isValid(businessId) ? await this.businesses.findById(businessId).lean() : null;
    if (!business) throw new NotFoundException('Business not found');
    if (business.ownerId) throw new BadRequestException('This business has already been claimed');

    const now = new Date();
    const superseded = await this.invitations.updateMany(
      { businessRef: business._id, claimedAt: { $exists: false }, revokedAt: { $exists: false } },
      { $set: { revokedAt: now, revokedBy: new Types.ObjectId(userId) } },
    );
    // An earlier link stops working the moment a new one is generated, which is worth recording.
    if (superseded.modifiedCount > 0) {
      await this.audit.record({
        action: AuditAction.CLAIM_INVITATION_REVOKED,
        targetType: 'Business',
        targetId: business._id,
        after: { revoked: superseded.modifiedCount },
        note: 'Superseded by a new invitation',
      });
    }

    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(now.getTime() + INVITATION_DAYS * 24 * 60 * 60 * 1000);
    const offer = await this.offers
      .findOne({ businessId: business._id, origin: OfferOrigin.SCRAPER, status: { $in: PUBLIC_OFFER_STATUSES } })
      .select('title scrapedWebsiteRef sourceDomain')
      .sort({ createdAt: -1 })
      .lean();

    const invitation = await this.invitations.create({
      businessRef: business._id,
      scrapedWebsiteRef: offer?.scrapedWebsiteRef,
      domain: business.importSource?.domain ?? offer?.sourceDomain,
      tokenHash: hashToken(token),
      tokenHint: token.slice(0, 6),
      generatedBy: new Types.ObjectId(userId),
      expiresAt,
    });
    await this.audit.record({
      action: AuditAction.CLAIM_INVITATION_CREATED,
      targetType: 'Business',
      targetId: business._id,
      after: { invitation: String(invitation._id), expiresAt, tokenHint: invitation.tokenHint },
    });
    return { invitation, ...(await this.invitationPack(token, business.name, offer?.title, expiresAt)) };
  }

  private async invitationPack(token: string, businessName: string, offerTitle: string | undefined, expiresAt: Date) {
    const claimUrl = this.claimUrl(token);
    const messages: InvitationMessages = invitationMessages({ businessName, claimUrl, offerTitle, expiresAt });
    // A PNG data URL, so an admin can save it into a letter or flyer. Nothing is sent.
    const qrCode = await QRCode.toDataURL(claimUrl, { width: 512, margin: 2, color: { dark: '#1a1a1a', light: '#ffffff' } });
    return { claimUrl, messages, qrCode };
  }

  async revokeInvitation(id: string, userId: string) {
    const invitation = Types.ObjectId.isValid(id) ? await this.invitations.findById(id) : null;
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.claimedAt) throw new BadRequestException('This invitation has already been used');
    invitation.set({ revokedAt: new Date(), revokedBy: new Types.ObjectId(userId) });
    await invitation.save();
    await this.audit.record({ action: AuditAction.CLAIM_INVITATION_REVOKED, targetType: 'Business', targetId: invitation.businessRef });
    return invitation;
  }

  /** An admin records that they contacted the business. TruOffers sends nothing itself. */
  async recordContact(businessId: string, input: { channel: string; note?: string }, userId: string) {
    if (!CONTACT_CHANNELS.includes(input.channel)) throw new BadRequestException(`Channel must be one of: ${CONTACT_CHANNELS.join(', ')}`);
    const invitation = Types.ObjectId.isValid(businessId)
      ? await this.invitations.findOne({ businessRef: businessId }).sort({ createdAt: -1 })
      : null;
    if (!invitation) throw new NotFoundException('Generate an invitation for this business first');
    invitation.contacts.push({ channel: input.channel, at: new Date(), by: new Types.ObjectId(userId), note: input.note });
    await invitation.save();
    await this.audit.record({
      action: AuditAction.OUTREACH_CONTACT_RECORDED,
      targetType: 'Business',
      targetId: invitation.businessRef,
      after: { channel: input.channel, invitation: String(invitation._id) },
      note: input.note,
    });
    return invitation;
  }

  /** The claim page resolves the link to the business it was generated for. */
  async resolve(token: string) {
    const invitation = await this.invitations.findOne({ tokenHash: hashToken(token) }).lean();
    if (!invitation || invitation.revokedAt || invitation.claimedAt || invitation.expiresAt.getTime() < Date.now()) {
      throw new NotFoundException('This invitation link is no longer valid');
    }
    const business = await this.businesses.findById(invitation.businessRef).select('name slug town postcode ownerId').lean();
    if (!business || business.ownerId) throw new NotFoundException('This invitation link is no longer valid');
    return {
      business: { _id: business._id, name: business.name, slug: business.slug, town: business.town, postcode: business.postcode },
      expiresAt: invitation.expiresAt,
    };
  }

  /** Called when a claim is approved: the business's open invitations are done with. */
  async markClaimed(businessId: Types.ObjectId, userId?: Types.ObjectId) {
    await this.invitations.updateMany(
      { businessRef: businessId, claimedAt: { $exists: false }, revokedAt: { $exists: false } },
      { $set: { claimedAt: new Date(), ...(userId ? { claimedBy: userId } : {}) } },
    );
  }

  listInvitations(businessId: string) {
    if (!Types.ObjectId.isValid(businessId)) throw new NotFoundException('Business not found');
    return this.invitations.find({ businessRef: businessId }).sort({ createdAt: -1 }).populate('generatedBy revokedBy', 'name email').lean();
  }
}
