import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as cheerio from 'cheerio';
import { Model, Types } from 'mongoose';
import { AuthUser } from '../common/decorators';
import { memberRole } from '../common/business-access';
import { normaliseUkPhone } from '../common/business-identity';
import {
  BusinessMemberRole,
  BusinessSource,
  BusinessStatus,
  ClaimDocumentType,
  ClaimKind,
  ClaimStatus,
  OPEN_CLAIM_STATUSES,
  Role,
  VerificationLevel,
} from '../common/enums';
import { registrableDomain } from '../common/order-link';
import { BusinessesService } from '../businesses/businesses.service';
import { CreateBusinessDto } from '../businesses/businesses.dto';
import { randomDigits, randomToken, sha256 } from '../platform/crypto';
import { EmailService } from '../platform/email.service';
import { NotificationsService } from '../platform/notifications.service';
import { OtpChannel, PhoneVerificationService } from '../platform/phone-verification.service';
import { DOCUMENT_KINDS, StorageService } from '../platform/storage.service';
import { AuditService } from '../scraper/audit/audit.service';
import { SafeFetchService } from '../scraper/safety/safe-fetch.service';
import { Business, BusinessDocument } from '../schemas/business.schema';
import { Claim, ClaimDocument, ClaimFile, ClaimFileDocument } from '../schemas/claim.schema';
import { MerchantClaimInvitation, MerchantClaimInvitationDocument } from '../schemas/merchant-claim-invitation.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { FhrsService, namesMatch, postcodesMatch } from './fhrs.service';

const CODE_MINUTES = 10;
const MAX_CODE_ATTEMPTS = 3;
const MAX_CODE_SENDS = 5;
const RESEND_SECONDS = 30;
const DOMAIN_CODE_MINUTES = 30;
const MAX_DOCUMENTS = 3;
const DOCUMENT_BYTES = 10 * 1024 * 1024;

export const SITE_META_NAME = 'truoffers-verification';
export const SITE_FILE_PATH = '/truoffers-verification.txt';

type UploadedBlob = { buffer: Buffer; size: number; originalname: string; mimetype: string };

export interface EvidenceSummary {
  phone: boolean;
  domain: boolean;
  fhrs: boolean;
  documents: number;
  shopPhoto: boolean;
  // Evidence besides the phone check; at least one is needed to submit
  additional: number;
  canSubmit: boolean;
}

export function summariseEvidence(claim: Pick<Claim, 'phoneOtpPassed' | 'domainCheckPassed' | 'fhrsMatch'>, files: Pick<ClaimFile, 'type' | 'deletedAt'>[]): EvidenceSummary {
  const live = files.filter((f) => !f.deletedAt);
  const documents = live.filter((f) => f.type !== ClaimDocumentType.SHOP_PHOTO).length;
  const shopPhoto = live.some((f) => f.type === ClaimDocumentType.SHOP_PHOTO);
  const additional = Number(claim.domainCheckPassed) + Number(claim.fhrsMatch) + Number(documents > 0) + Number(shopPhoto);
  return {
    phone: claim.phoneOtpPassed,
    domain: claim.domainCheckPassed,
    fhrs: claim.fhrsMatch,
    documents,
    shopPhoto,
    additional,
    canSubmit: claim.phoneOtpPassed && additional >= 1,
  };
}

const notInProduction = () => process.env.NODE_ENV !== 'production';

@Injectable()
export class ClaimsService {
  constructor(
    @InjectModel(Claim.name) readonly claims: Model<ClaimDocument>,
    @InjectModel(ClaimFile.name) readonly files: Model<ClaimFileDocument>,
    @InjectModel(Business.name) readonly businesses: Model<BusinessDocument>,
    @InjectModel(User.name) readonly users: Model<UserDocument>,
    @InjectModel(MerchantClaimInvitation.name) readonly invitations: Model<MerchantClaimInvitationDocument>,
    readonly businessesService: BusinessesService,
    readonly phone: PhoneVerificationService,
    readonly storage: StorageService,
    readonly email: EmailService,
    readonly notifications: NotificationsService,
    readonly audit: AuditService,
    readonly fhrs: FhrsService,
    @Inject(SafeFetchService) private readonly safeFetch: SafeFetchService,
  ) {}

  // -------------------------------------------------------------------------------------------------
  // Starting a claim
  // -------------------------------------------------------------------------------------------------

  private async requireVerifiedEmail(user: AuthUser) {
    const account = await this.users.findById(user.userId).select('emailVerifiedAt status');
    if (!account) throw new NotFoundException('Account not found');
    if (!account.emailVerifiedAt) {
      throw new ForbiddenException({ message: 'Please confirm your email address first. We sent you a link when you signed up.', code: 'email_unverified' });
    }
  }

  private async openClaimFor(businessId: Types.ObjectId, userId: string) {
    return this.claims.findOne({ businessId, userId: new Types.ObjectId(userId), status: { $in: OPEN_CLAIM_STATUSES } });
  }

  private newClaimFields(business: BusinessDocument) {
    const domain = registrableDomain(business.website);
    return {
      shopPhotoCode: randomDigits(3) + '-' + randomDigits(3),
      domainCheck: { domain: domain ?? undefined, siteToken: randomToken(18), attempts: 0 },
    };
  }

  /** Spec T2.1: claim an existing listing. Blocked if the user already has an open claim on it. */
  async start(businessId: string, user: AuthUser) {
    await this.requireVerifiedEmail(user);
    const business = Types.ObjectId.isValid(businessId) ? await this.businesses.findById(businessId) : null;
    if (!business || business.status !== BusinessStatus.ACTIVE) throw new NotFoundException('Business not found');
    const role = memberRole(business, user.userId);
    if (role === BusinessMemberRole.OWNER && business.verificationLevel >= VerificationLevel.VERIFIED) {
      throw new ConflictException('You already manage this business');
    }
    const open = await this.openClaimFor(business._id, user.userId);
    if (open) throw new ConflictException({ message: 'You already have a claim in progress for this business', claimId: String(open._id) });
    this.listingPhone(business);

    const claim = await this.claims.create({
      businessId: business._id,
      userId: new Types.ObjectId(user.userId),
      kind: ClaimKind.EXISTING,
      status: ClaimStatus.DRAFT,
      ...this.newClaimFields(business),
    });
    await this.audit.record({ action: 'claim.started', targetType: 'Claim', targetId: claim._id, after: { business: String(business._id), kind: claim.kind } });
    return this.ownerView(claim);
  }

  /** Spec T2.2: add a business that isn't listed. Possible duplicates (same phone, or postcode and name) come back first. */
  async startNewBusiness(dto: CreateBusinessDto, confirmNotDuplicate: boolean, user: AuthUser) {
    await this.requireVerifiedEmail(user);
    if (!normaliseUkPhone(dto.phone)) {
      throw new BadRequestException('Enter the shop’s UK phone number: we send a code to it to prove the line is yours.');
    }
    const duplicates = await this.businessesService.possibleDuplicates(dto);
    if (duplicates.length && !confirmNotDuplicate) {
      throw new ConflictException({ message: 'This takeaway may already be listed', code: 'possible_duplicates', duplicates });
    }
    // Hidden until a moderator verifies it.
    const business = await this.businessesService.create(dto, { source: BusinessSource.OWNER, status: BusinessStatus.PENDING });
    const claim = await this.claims.create({
      businessId: business._id,
      userId: new Types.ObjectId(user.userId),
      kind: ClaimKind.NEW,
      status: ClaimStatus.DRAFT,
      ...this.newClaimFields(business),
    });
    await this.audit.record({ action: 'business.added_by_owner', targetType: 'Business', targetId: business._id, after: { name: business.name, postcode: business.postcode, claim: String(claim._id) } });
    return this.ownerView(claim);
  }

  /** Spec "Re-verification": an owner of a verified (or claimed) business proves ownership again. */
  async startReverification(businessId: string, user: AuthUser) {
    await this.requireVerifiedEmail(user);
    const business = Types.ObjectId.isValid(businessId) ? await this.businesses.findById(businessId) : null;
    if (!business) throw new NotFoundException('Business not found');
    if (memberRole(business, user.userId) !== BusinessMemberRole.OWNER) throw new ForbiddenException('Only an owner can verify the business');
    const open = await this.claims.findOne({ businessId: business._id, status: { $in: OPEN_CLAIM_STATUSES } });
    if (open) {
      if (String(open.userId) === user.userId) return this.ownerView(open);
      throw new ConflictException('Another claim on this business is being reviewed');
    }
    this.listingPhone(business);
    const claim = await this.claims.create({
      businessId: business._id,
      userId: new Types.ObjectId(user.userId),
      // A business that never got past level 1 (e.g. claimed before the MVP) goes through the normal claim.
      kind: business.verificationLevel >= VerificationLevel.VERIFIED ? ClaimKind.REVERIFICATION : ClaimKind.EXISTING,
      status: ClaimStatus.DRAFT,
      ...this.newClaimFields(business),
    });
    await this.audit.record({ action: 'claim.started', targetType: 'Claim', targetId: claim._id, after: { business: String(business._id), kind: claim.kind } });
    return this.ownerView(claim);
  }

  // -------------------------------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------------------------------

  async loadOwn(claimId: string, user: AuthUser) {
    const claim = Types.ObjectId.isValid(claimId) ? await this.claims.findById(claimId).select('+phoneCheck.codeHash +domainCheck.codeHash') : null;
    if (!claim || String(claim.userId) !== user.userId) throw new NotFoundException('Claim not found');
    return claim;
  }

  async mine(user: AuthUser) {
    const claims = await this.claims
      .find({ userId: new Types.ObjectId(user.userId) })
      .sort({ createdAt: -1 })
      .populate('businessId', 'name slug town postcode verificationLevel status')
      .lean();
    return claims.map((c) => ({
      _id: c._id,
      status: c.status,
      kind: c.kind,
      business: c.businessId,
      phoneOtpPassed: c.phoneOtpPassed,
      submittedAt: c.submittedAt,
      expiresAt: c.expiresAt,
      decidedAt: c.decidedAt,
      reasonCode: c.reasonCode,
      notes: c.notes,
      createdAt: (c as { createdAt?: Date }).createdAt,
    }));
  }

  async get(claimId: string, user: AuthUser) {
    return this.ownerView(await this.loadOwn(claimId, user));
  }

  async ownerView(claim: ClaimDocument) {
    const [business, files] = await Promise.all([
      this.businesses.findById(claim.businessId).select('name slug address town postcode phone website orderUrl verificationLevel status frozen').lean(),
      this.files.find({ claimId: claim._id, deletedAt: { $exists: false } }).sort({ uploadedAt: 1 }).lean(),
    ]);
    const phoneTarget = business?.phone ? normaliseUkPhone(business.phone) : null;
    const { phoneCheck, domainCheck, ...rest } = claim.toObject();
    return {
      ...rest,
      business,
      phoneCheck: {
        // Only the last digits of the shop line: the claimant must already know the number
        phoneHint: phoneTarget ? `•••• ${phoneTarget.slice(-4)}` : null,
        sentAt: phoneCheck?.sentAt,
        expiresAt: phoneCheck?.expiresAt,
        attempts: phoneCheck?.attempts ?? 0,
        attemptsLeft: Math.max(0, MAX_CODE_ATTEMPTS - (phoneCheck?.attempts ?? 0)),
        sendsLeft: Math.max(0, MAX_CODE_SENDS - (phoneCheck?.sends ?? 0)),
        passedAt: phoneCheck?.passedAt,
        channel: phoneCheck?.channel,
      },
      domainCheck: {
        domain: domainCheck?.domain,
        method: domainCheck?.method,
        email: domainCheck?.email,
        codeExpiresAt: domainCheck?.codeExpiresAt,
        passedAt: domainCheck?.passedAt,
        lastError: domainCheck?.lastError,
        siteToken: domainCheck?.siteToken,
        metaTag: domainCheck?.siteToken ? `<meta name="${SITE_META_NAME}" content="${domainCheck.siteToken}">` : undefined,
        fileUrl: domainCheck?.domain ? `https://${domainCheck.domain}${SITE_FILE_PATH}` : undefined,
      },
      documents: files.map((f) => ({ _id: f._id, type: f.type, originalName: f.originalName, size: f.size, status: f.status, uploadedAt: f.uploadedAt })),
      evidence: summariseEvidence(claim, files),
      // Moderator notes are visible to the owner; internal checklist is not.
      checklist: undefined,
      assignedTo: undefined,
    };
  }

  // -------------------------------------------------------------------------------------------------
  // Phone check (T2.3)
  // -------------------------------------------------------------------------------------------------

  /** The shop line: always the number on the listing, never one typed in for the check. */
  private listingPhone(business: BusinessDocument): string {
    const phone = normaliseUkPhone(business.phone);
    if (!phone) {
      throw new BadRequestException({
        message: 'This listing has no valid phone number, so we cannot send a code to the shop. Please contact us to claim it.',
        code: 'no_listing_phone',
      });
    }
    return phone;
  }

  private assertEditable(claim: ClaimDocument) {
    if (![ClaimStatus.DRAFT, ClaimStatus.INFO_REQUESTED, ClaimStatus.PENDING, ClaimStatus.DISPUTED].includes(claim.status)) {
      throw new BadRequestException(`This claim is ${claim.status.replace('_', ' ')}`);
    }
  }

  async sendCode(claimId: string, channel: OtpChannel, user: AuthUser) {
    const claim = await this.loadOwn(claimId, user);
    this.assertEditable(claim);
    if (claim.phoneOtpPassed) throw new BadRequestException('The phone check is already done');
    const business = await this.businesses.findById(claim.businessId);
    if (!business) throw new NotFoundException('Business not found');
    const phone = this.listingPhone(business);
    const check = claim.phoneCheck ?? ({} as ClaimDocument['phoneCheck']);
    if ((check.sends ?? 0) >= MAX_CODE_SENDS) throw new BadRequestException('Too many codes sent for this claim. Please contact us.');
    if (check.sentAt && Date.now() - check.sentAt.getTime() < RESEND_SECONDS * 1000) {
      throw new BadRequestException(`Please wait ${RESEND_SECONDS} seconds before asking for another code`);
    }
    const started = await this.phone.start(phone, channel);
    claim.set('phoneCheck', {
      phone,
      channel,
      mode: started.mode,
      codeHash: started.codeHash,
      sentAt: new Date(),
      expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000),
      attempts: 0,
      sends: (check.sends ?? 0) + 1,
    });
    await claim.save();
    await this.audit.record({ action: 'claim.phone_code_sent', targetType: 'Claim', targetId: claim._id, after: { channel, mode: started.mode } });
    return {
      sent: true,
      channel,
      phoneHint: `•••• ${phone.slice(-4)}`,
      expiresAt: claim.phoneCheck.expiresAt,
      ...(started.devCode && notInProduction() ? { devCode: started.devCode } : {}),
    };
  }

  async verifyCode(claimId: string, code: string, user: AuthUser) {
    const claim = await this.loadOwn(claimId, user);
    this.assertEditable(claim);
    if (claim.phoneOtpPassed) return this.ownerView(claim);
    const check = claim.phoneCheck;
    if (!check?.sentAt || !check.phone) throw new BadRequestException('Send a code first');
    if (check.expiresAt && check.expiresAt < new Date()) throw new BadRequestException('The code has expired. Send a new one.');
    if ((check.attempts ?? 0) >= MAX_CODE_ATTEMPTS) throw new BadRequestException('Too many wrong codes. Send a new one.');

    const ok = await this.phone.check(check.phone, code.trim(), check.mode === 'mock' ? check.codeHash : undefined);
    if (!ok) {
      claim.set('phoneCheck.attempts', (check.attempts ?? 0) + 1);
      await claim.save();
      const left = MAX_CODE_ATTEMPTS - claim.phoneCheck.attempts;
      throw new BadRequestException(left > 0 ? `That code is not right. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many wrong codes. Send a new one.');
    }
    claim.set({ phoneOtpPassed: true, 'phoneCheck.passedAt': new Date(), 'phoneCheck.codeHash': undefined });
    await claim.save();
    await this.audit.record({ action: 'claim.phone_verified', targetType: 'Claim', targetId: claim._id });
    await this.afterPhoneCheck(claim, user);
    return this.ownerView(claim);
  }

  /**
   * The phone line is proven. The claimant becomes the listing's owner at level 1 (drafts and profile only),
   * unless someone else already runs it: then it is a dispute, the listing freezes and an admin decides.
   */
  private async afterPhoneCheck(claim: ClaimDocument, user: AuthUser) {
    const business = await this.businesses.findById(claim.businessId);
    if (!business) return;
    if (claim.kind === ClaimKind.REVERIFICATION) return;
    const others = business.members.filter((m) => String(m.userId) !== user.userId && m.role === BusinessMemberRole.OWNER);
    if (others.length > 0) {
      claim.set({ status: ClaimStatus.DISPUTED, disputedOwnerIds: others.map((m) => m.userId), submittedAt: new Date() });
      await claim.save();
      business.set({ frozen: true, disputeClaimId: claim._id });
      await business.save();
      await this.audit.record({ action: 'claim.disputed', targetType: 'Business', targetId: business._id, after: { claim: String(claim._id), claimant: user.userId } });
      const notice = { type: 'claim_disputed', title: `${business.name} is being reviewed`, body: 'Someone else has also proved access to the shop phone line. Changes are paused while our team decides.', link: '/dashboard/verification', email: { template: 'claim_disputed', vars: { businessName: business.name } } };
      await this.notifications.notifyUsers([...others.map((m) => m.userId), new Types.ObjectId(user.userId)], { ...notice, businessId: business._id });
      return;
    }
    if (!memberRole(business, user.userId)) {
      business.members.push({ userId: new Types.ObjectId(user.userId), role: BusinessMemberRole.OWNER, addedAt: new Date() });
    }
    if (!business.ownerId) business.ownerId = new Types.ObjectId(user.userId);
    const before = business.verificationLevel;
    if (business.verificationLevel < VerificationLevel.CLAIM_PENDING) business.verificationLevel = VerificationLevel.CLAIM_PENDING;
    await business.save();
    await this.users.updateOne({ _id: user.userId, role: { $in: [Role.CUSTOMER, Role.BUSINESS_STAFF] } }, { $set: { role: Role.BUSINESS_OWNER } });
    await this.audit.record({
      action: 'business.claimed',
      targetType: 'Business',
      targetId: business._id,
      before: { verificationLevel: before },
      after: { verificationLevel: business.verificationLevel, owner: user.userId },
    });
  }

  // -------------------------------------------------------------------------------------------------
  // Evidence (T2.4)
  // -------------------------------------------------------------------------------------------------

  async uploadDocument(claimId: string, type: ClaimDocumentType, file: UploadedBlob | undefined, user: AuthUser) {
    const claim = await this.loadOwn(claimId, user);
    this.assertEditable(claim);
    if (!file) throw new BadRequestException('Choose a file to upload');
    const count = await this.files.countDocuments({ claimId: claim._id, deletedAt: { $exists: false } });
    if (count >= MAX_DOCUMENTS) throw new BadRequestException(`You can upload up to ${MAX_DOCUMENTS} documents. Remove one first.`);
    const saved = await this.storage.save('private', file.buffer, DOCUMENT_KINDS, DOCUMENT_BYTES);
    const doc = await this.files.create({
      claimId: claim._id,
      type,
      storageKey: saved.key,
      originalName: file.originalname?.slice(0, 120),
      mime: file.mimetype,
      size: saved.size,
    });
    await this.audit.record({ action: 'claim.document_uploaded', targetType: 'Claim', targetId: claim._id, after: { type, document: String(doc._id) } });
    return this.ownerView(claim);
  }

  async removeDocument(claimId: string, documentId: string, user: AuthUser) {
    const claim = await this.loadOwn(claimId, user);
    if (![ClaimStatus.DRAFT, ClaimStatus.INFO_REQUESTED].includes(claim.status)) {
      throw new BadRequestException('Documents can only be removed before you submit, or when we ask for more information');
    }
    const doc = await this.files.findOne({ _id: documentId, claimId: claim._id, deletedAt: { $exists: false } });
    if (!doc) throw new NotFoundException('Document not found');
    await this.storage.remove(doc.storageKey);
    doc.deletedAt = new Date();
    await doc.save();
    await this.audit.record({ action: 'claim.document_removed', targetType: 'Claim', targetId: claim._id, before: { type: doc.type, document: String(doc._id) } });
    return this.ownerView(claim);
  }

  async readDocument(claimId: string, documentId: string, user: AuthUser) {
    const claim = await this.loadOwn(claimId, user);
    const doc = await this.files.findOne({ _id: documentId, claimId: claim._id, deletedAt: { $exists: false } });
    if (!doc) throw new NotFoundException('Document not found');
    return { ...(await this.storage.read(doc.storageKey)), name: doc.originalName ?? `${doc.type}.${doc.storageKey.split('.').pop()}` };
  }

  /** Evidence 2a: a code sent to an address on the business's own domain. */
  async domainEmail(claimId: string, email: string, user: AuthUser) {
    const claim = await this.loadOwn(claimId, user);
    this.assertEditable(claim);
    const business = await this.businesses.findById(claim.businessId);
    const domain = registrableDomain(business?.website);
    if (!business || !domain) throw new BadRequestException('Add your website to the listing first; the email must be on its domain.');
    const emailDomain = registrableDomain(email.split('@')[1]);
    if (emailDomain !== domain) throw new BadRequestException(`Use an email address ending in @${domain}`);
    const code = randomDigits(6);
    claim.set({
      'domainCheck.domain': domain,
      'domainCheck.method': 'email',
      'domainCheck.email': email.toLowerCase(),
      'domainCheck.codeHash': sha256(`${claim.id}:${code}`),
      'domainCheck.codeExpiresAt': new Date(Date.now() + DOMAIN_CODE_MINUTES * 60_000),
      'domainCheck.attempts': 0,
    });
    await claim.save();
    await this.email.send({ to: email, template: 'domain_verification_code', vars: { businessName: business.name, code } });
    return { sent: true, ...(notInProduction() ? { devCode: code } : {}) };
  }

  async domainEmailVerify(claimId: string, code: string, user: AuthUser) {
    const claim = await this.loadOwn(claimId, user);
    this.assertEditable(claim);
    const check = claim.domainCheck;
    if (check?.method !== 'email' || !check.codeHash) throw new BadRequestException('Send a code first');
    if (check.codeExpiresAt && check.codeExpiresAt < new Date()) throw new BadRequestException('The code has expired. Send a new one.');
    if ((check.attempts ?? 0) >= 5) throw new BadRequestException('Too many wrong codes. Send a new one.');
    if (sha256(`${claim.id}:${code.trim()}`) !== check.codeHash) {
      claim.set('domainCheck.attempts', (check.attempts ?? 0) + 1);
      await claim.save();
      throw new BadRequestException('That code is not right');
    }
    claim.set({ domainCheckPassed: true, 'domainCheck.passedAt': new Date(), 'domainCheck.codeHash': undefined, 'domainCheck.lastError': undefined });
    await claim.save();
    await this.audit.record({ action: 'claim.domain_verified', targetType: 'Claim', targetId: claim._id, after: { method: 'email', email: check.email } });
    return this.ownerView(claim);
  }

  /** Evidence 2b: the claim's token in a meta tag on the homepage, or in a file at the site root. */
  async siteCheck(claimId: string, method: 'meta' | 'file', user: AuthUser) {
    const claim = await this.loadOwn(claimId, user);
    this.assertEditable(claim);
    const business = await this.businesses.findById(claim.businessId);
    const domain = registrableDomain(business?.website);
    if (!business?.website || !domain) throw new BadRequestException('Add your website to the listing first.');
    const token = claim.domainCheck?.siteToken;
    if (!token) throw new BadRequestException('Start the website check again');
    const site = new URL(business.website);
    const url = method === 'file' ? `${site.protocol}//${site.host}${SITE_FILE_PATH}` : `${site.protocol}//${site.host}/`;
    let found = false;
    let error: string | undefined;
    try {
      const res = await this.safeFetch.fetch(url, { purpose: 'page' });
      if (res.status >= 400) error = `Your website answered ${res.status} at ${url}`;
      else if (registrableDomain(res.finalUrl) !== domain) error = `${url} redirected to another website`;
      else if (method === 'file') found = res.body.trim().split(/\s+/).includes(token);
      else {
        const $ = cheerio.load(res.body);
        found = $(`meta[name="${SITE_META_NAME}"]`).toArray().some((el) => $(el).attr('content')?.trim() === token);
      }
      if (!found && !error) error = method === 'file' ? `The file at ${url} does not contain your code yet` : `We could not find the meta tag on ${url}`;
    } catch (err) {
      error = `We could not open ${url}: ${(err as Error).message}`;
    }
    claim.set({ 'domainCheck.domain': domain, 'domainCheck.method': method, 'domainCheck.lastError': found ? undefined : error });
    if (found) claim.set({ domainCheckPassed: true, 'domainCheck.passedAt': new Date() });
    await claim.save();
    if (found) await this.audit.record({ action: 'claim.domain_verified', targetType: 'Claim', targetId: claim._id, after: { method, domain } });
    return this.ownerView(claim);
  }

  async fhrsSearch(claimId: string, user: AuthUser, name?: string, postcode?: string) {
    const claim = await this.loadOwn(claimId, user);
    const business = await this.businesses.findById(claim.businessId).select('name postcode').lean();
    return this.fhrs.search(name?.trim() || business?.name || '', postcode?.trim() || business?.postcode);
  }

  /** Evidence 4: the owner picks their FHRS listing; it counts when name and postcode match the takeaway's. */
  async fhrsPick(claimId: string, fhrsId: string, user: AuthUser) {
    const claim = await this.loadOwn(claimId, user);
    this.assertEditable(claim);
    const business = await this.businesses.findById(claim.businessId).select('name postcode').lean();
    const establishment = await this.fhrs.byId(fhrsId);
    if (!establishment || !business) throw new NotFoundException('That Food Hygiene Rating listing was not found');
    const nameMatches = namesMatch(establishment.name, business.name);
    const postcodeMatches = postcodesMatch(establishment.postcode, business.postcode);
    claim.set({
      fhrs: { ...establishment, nameMatches, postcodeMatches, checkedAt: new Date() },
      fhrsMatch: nameMatches && postcodeMatches,
    });
    await claim.save();
    await this.audit.record({ action: 'claim.fhrs_checked', targetType: 'Claim', targetId: claim._id, after: { fhrsId, nameMatches, postcodeMatches } });
    return this.ownerView(claim);
  }

  // -------------------------------------------------------------------------------------------------
  // Submitting and talking to the moderator
  // -------------------------------------------------------------------------------------------------

  async submit(claimId: string, user: AuthUser) {
    const claim = await this.loadOwn(claimId, user);
    if (![ClaimStatus.DRAFT, ClaimStatus.INFO_REQUESTED, ClaimStatus.DISPUTED].includes(claim.status)) {
      throw new BadRequestException(`This claim is ${claim.status.replace('_', ' ')}`);
    }
    const files = await this.files.find({ claimId: claim._id, deletedAt: { $exists: false } }).lean();
    const evidence = summariseEvidence(claim, files);
    if (!evidence.phone) throw new BadRequestException('Complete the phone check first');
    if (!evidence.canSubmit) throw new BadRequestException('Add at least one more piece of evidence: a document, a website or email check, or your Food Hygiene Rating');
    const first = !claim.submittedAt;
    const wasInfo = claim.status === ClaimStatus.INFO_REQUESTED;
    if (claim.status !== ClaimStatus.DISPUTED) claim.status = ClaimStatus.PENDING;
    claim.submittedAt = new Date();
    claim.expiresAt = undefined;
    if (wasInfo) claim.messages.push({ from: 'system', body: 'The owner added more information and resubmitted.' } as never);
    await claim.save();
    await this.audit.record({ action: wasInfo ? 'claim.resubmitted' : 'claim.submitted', targetType: 'Claim', targetId: claim._id, after: { evidence } });
    if (first) {
      const business = await this.businesses.findById(claim.businessId).select('name').lean();
      await this.notifications.notifyUsers([claim.userId], {
        type: 'claim_submitted',
        title: 'Verification submitted',
        body: `We will check the evidence for ${business?.name ?? 'your business'}, usually within 1 working day.`,
        link: '/dashboard/verification',
        businessId: claim.businessId,
        email: { template: 'claim_submitted', vars: { businessName: business?.name } },
      });
    }
    return this.ownerView(claim);
  }

  async message(claimId: string, body: string, user: AuthUser) {
    const claim = await this.loadOwn(claimId, user);
    this.assertEditable(claim);
    claim.messages.push({ from: 'owner', userId: new Types.ObjectId(user.userId), body } as never);
    await claim.save();
    return this.ownerView(claim);
  }

  async withdraw(claimId: string, user: AuthUser) {
    const claim = await this.loadOwn(claimId, user);
    if (![ClaimStatus.DRAFT, ClaimStatus.PENDING, ClaimStatus.INFO_REQUESTED, ClaimStatus.DISPUTED].includes(claim.status)) {
      throw new BadRequestException('This claim is already closed');
    }
    await this.close(claim, ClaimStatus.WITHDRAWN, 'Withdrawn by the claimant');
    return this.ownerView(claim);
  }

  // -------------------------------------------------------------------------------------------------
  // Shared effects (also used by the moderator side and the jobs)
  // -------------------------------------------------------------------------------------------------

  /**
   * A claim ends without approval (rejected, expired, withdrawn). Whatever it gave the claimant at the phone
   * check is taken back: their place on the team, level 1, and the hidden listing they added.
   */
  async close(claim: ClaimDocument, status: ClaimStatus, note?: string) {
    const wasDisputed = claim.status === ClaimStatus.DISPUTED;
    claim.status = status;
    claim.decidedAt = new Date();
    if (note && status !== ClaimStatus.REJECTED) claim.messages.push({ from: 'system', body: note } as never);
    await claim.save();
    await this.files.updateMany(
      { claimId: claim._id, deletedAt: { $exists: false } },
      { $set: { deleteAfter: new Date(Date.now() + 90 * 24 * 3600_000) } },
    );
    const business = await this.businesses.findById(claim.businessId);
    if (!business) return;
    const before = { verificationLevel: business.verificationLevel, status: business.status, members: business.members.length };
    if (wasDisputed) {
      business.set({ frozen: false, disputeClaimId: undefined });
    } else if (claim.kind !== ClaimKind.REVERIFICATION && claim.phoneOtpPassed && business.verificationLevel < VerificationLevel.VERIFIED) {
      const claimant = String(claim.userId);
      business.members = business.members.filter((m) => String(m.userId) !== claimant);
      if (String(business.ownerId) === claimant) business.ownerId = business.members.find((m) => m.role === BusinessMemberRole.OWNER)?.userId;
      if (!business.members.some((m) => m.role === BusinessMemberRole.OWNER)) {
        business.verificationLevel = VerificationLevel.UNCLAIMED;
        business.ownerId = undefined;
      }
      if (claim.kind === ClaimKind.NEW && business.status === BusinessStatus.PENDING) business.status = BusinessStatus.ARCHIVED;
    }
    await business.save();
    await this.audit.record({
      action: `claim.${status}`,
      targetType: 'Claim',
      targetId: claim._id,
      before,
      after: { verificationLevel: business.verificationLevel, status: business.status, members: business.members.length },
      note,
    });
  }

  /** Spec §14: invitations an admin handed this business are done with once it is claimed. */
  async markInvitationsClaimed(businessId: Types.ObjectId, userId: Types.ObjectId) {
    await this.invitations.updateMany(
      { businessRef: businessId, claimedAt: { $exists: false }, revokedAt: { $exists: false } },
      { $set: { claimedAt: new Date(), claimedBy: userId } },
    );
  }
}
