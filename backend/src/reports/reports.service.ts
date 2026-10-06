import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ActorContext } from '../common/actor-context';
import { AuthUser } from '../common/decorators';
import { BusinessAccessService } from '../common/business-access';
import { OfferStatus, PUBLIC_OFFER_STATUSES, ReportReason, ReportStatus } from '../common/enums';
import { recountActiveOffers } from '../common/offer-counts';
import { ActorKind } from '../common/scraper.enums';
import { sha256 } from '../platform/crypto';
import { siteUrl } from '../platform/email.service';
import { EmailService } from '../platform/email.service';
import { NotificationsService } from '../platform/notifications.service';
import { RecaptchaService } from '../platform/recaptcha.service';
import { SettingsService } from '../platform/settings.service';
import { IMAGE_KINDS, StorageService } from '../platform/storage.service';
import { AuditService } from '../scraper/audit/audit.service';
import { escapeRegex } from '../businesses/businesses.service';
import { REPORTS_COMPONENT } from '../schemas/offer-lifecycle.guard';
import { Business, BusinessDocument } from '../schemas/business.schema';
import { Offer, OfferDocument } from '../schemas/offer.schema';
import {
  BusinessStrike,
  BusinessStrikeDocument,
  Report,
  ReportBlock,
  ReportBlockDocument,
  ReportCase,
  ReportCaseDocument,
  ReportDocument,
} from '../schemas/report.schema';

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  not_honoured: 'Offer not honoured',
  ended: 'Offer has ended',
  wrong_terms: 'Wrong price or terms',
  closed_or_fake: 'Business closed or fake',
  misleading: 'Misleading or offensive',
  other: 'Other',
};

const DAY = 24 * 3600_000;
const INFO_HOURS = 48;
const OPEN_CASE = [ReportStatus.OPEN, ReportStatus.INFO_REQUESTED];

export interface NewReport {
  reason: ReportReason;
  note?: string;
  email?: string;
  deviceId?: string;
  recaptchaToken?: string;
}

type Photo = { buffer: Buffer } | undefined;

/**
 * Spec "Offer reports": any visitor can report a false offer; only an admin's decision removes it. Three open
 * reports from different people within 7 days hide it until then.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Report.name) private readonly reports: Model<ReportDocument>,
    @InjectModel(ReportCase.name) private readonly cases: Model<ReportCaseDocument>,
    @InjectModel(BusinessStrike.name) private readonly strikes: Model<BusinessStrikeDocument>,
    @InjectModel(ReportBlock.name) private readonly blocks: Model<ReportBlockDocument>,
    @InjectModel(Offer.name) private readonly offers: Model<OfferDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    private readonly access: BusinessAccessService,
    private readonly settings: SettingsService,
    private readonly recaptcha: RecaptchaService,
    private readonly storage: StorageService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------------------------------
  // Reporting (public)
  // ---------------------------------------------------------------------------------------------------

  async create(offerId: string, input: NewReport, photo: Photo, user: AuthUser | undefined, ip: string | undefined) {
    const offer = Types.ObjectId.isValid(offerId) ? await this.offers.findById(offerId).select('businessId status title') : null;
    if (!offer || ![...PUBLIC_OFFER_STATUSES, OfferStatus.HIDDEN_BY_REPORTS].includes(offer.status)) throw new NotFoundException('Offer not found');
    if (!user && !(await this.recaptcha.verify(input.recaptchaToken, ip))) throw new BadRequestException('Please complete the “I’m not a robot” check');

    const email = (user?.email ?? input.email)?.toLowerCase().trim() || undefined;
    // One report per offer per person or device per week. Signed-in people are known by account; guests by
    // device, and by network address when the device id is missing.
    const reporterKey = sha256(user ? `user:${user.userId}` : `device:${input.deviceId || `ip:${ip ?? 'unknown'}`}`);
    const blocked = await this.blocks.exists({
      $or: [{ reporterKey }, ...(email ? [{ email }] : []), ...(user ? [{ userId: new Types.ObjectId(user.userId) }] : [])],
    });
    if (blocked) throw new ForbiddenException('You can no longer report offers. Contact us if you think this is a mistake.');
    const settings = await this.settings.get();
    const windowStart = new Date(Date.now() - settings.reports.windowDays * DAY);
    if (await this.reports.exists({ offerId: offer._id, reporterKey, createdAt: { $gte: new Date(Date.now() - 7 * DAY) } })) {
      throw new ConflictException('You have already reported this offer. We will look into it.');
    }

    const saved = photo ? await this.storage.save('private', photo.buffer, IMAGE_KINDS, 5 * 1024 * 1024) : undefined;
    const report = await this.reports.create({
      offerId: offer._id,
      businessId: offer.businessId,
      reporterId: user ? new Types.ObjectId(user.userId) : undefined,
      reporterEmail: email,
      reporterKey,
      reason: input.reason,
      note: input.note?.slice(0, 500),
      photoKey: saved?.key,
    });

    const now = new Date();
    const reportCase = await this.cases.findOneAndUpdate(
      { offerId: offer._id, status: { $in: OPEN_CASE } },
      {
        $setOnInsert: { offerId: offer._id, businessId: offer.businessId, status: ReportStatus.OPEN, firstReportAt: now },
        $inc: { reportCount: 1 },
        $set: { latestReportAt: now },
      },
      { upsert: true, new: true },
    );

    // Auto-hide: enough different people within the window, while the case is open.
    const distinct = await this.reports.distinct('reporterKey', { offerId: offer._id, status: { $in: OPEN_CASE }, createdAt: { $gte: windowStart } });
    if (distinct.length >= settings.reports.autoHideThreshold && !reportCase.autoHidden && PUBLIC_OFFER_STATUSES.includes(offer.status)) {
      const hidden = await ActorContext.run({ kind: ActorKind.SYSTEM, component: REPORTS_COMPONENT }, () =>
        this.offers.updateOne(
          { _id: offer._id, status: { $in: [OfferStatus.ACTIVE, OfferStatus.REVISION_PENDING] } },
          { $set: { status: OfferStatus.HIDDEN_BY_REPORTS, hiddenByReportsAt: now } },
        ),
      );
      if (hidden.modifiedCount) {
        reportCase.set({ autoHidden: true, statusBeforeHide: offer.status });
        await reportCase.save();
        await recountActiveOffers(this.offers, this.businesses, offer.businessId);
        await this.audit.record(
          { action: 'offer.hidden_by_reports', targetType: 'Offer', targetId: offer._id, before: { status: offer.status }, after: { status: OfferStatus.HIDDEN_BY_REPORTS, reports: distinct.length } },
          { kind: ActorKind.SYSTEM, component: REPORTS_COMPONENT },
        );
      }
    }
    return { received: true, reportId: report._id };
  }

  // ---------------------------------------------------------------------------------------------------
  // Admin queue
  // ---------------------------------------------------------------------------------------------------

  async queue(query: { status?: string; q?: string; page?: string }, limit = 40) {
    const filter: Record<string, unknown> = {};
    const status = query.status || 'open';
    if (status === 'open') filter.status = { $in: OPEN_CASE };
    else if (status === 'appeals') filter['appeal.status'] = 'open';
    else if (status !== 'all') filter.status = { $in: status.split(',') };
    if (query.q) {
      // Offer title or business name
      const regex = new RegExp(escapeRegex(query.q), 'i');
      const [offerIds, businessIds] = await Promise.all([this.offers.find({ title: regex }).distinct('_id'), this.businesses.find({ name: regex }).distinct('_id')]);
      filter.$or = [{ offerId: { $in: offerIds } }, { businessId: { $in: businessIds } }];
    }
    const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
    const [items, total] = await Promise.all([
      this.cases
        .find(filter)
        .sort({ reportCount: -1, firstReportAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('offerId', 'title status displayLabel')
        .populate('businessId', 'name slug town')
        .lean(),
      this.cases.countDocuments(filter),
    ]);
    const reasons = await this.reports.aggregate([
      { $match: { offerId: { $in: items.map((c) => c.offerId && (c.offerId as unknown as { _id: Types.ObjectId })._id).filter(Boolean) } } },
      { $group: { _id: { offer: '$offerId', reason: '$reason' }, count: { $sum: 1 } } },
    ]);
    return {
      items: items.map((c) => ({
        ...c,
        reasons: reasons
          .filter((r) => String(r._id.offer) === String((c.offerId as unknown as { _id?: Types.ObjectId })?._id))
          .map((r) => ({ reason: r._id.reason as ReportReason, label: REPORT_REASON_LABELS[r._id.reason as ReportReason], count: r.count })),
        deadlinePassed: c.infoDeadline ? new Date(c.infoDeadline) < new Date() : false,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  private async loadCase(id: string) {
    const reportCase = Types.ObjectId.isValid(id) ? await this.cases.findById(id) : null;
    if (!reportCase) throw new NotFoundException('Report not found');
    return reportCase;
  }

  async detail(id: string) {
    const reportCase = await this.loadCase(id);
    await reportCase.populate([{ path: 'offerId' }, { path: 'businessId', select: 'name slug town phone verificationLevel status suspensionReview' }, { path: 'decidedBy', select: 'name' }]);
    const settings = await this.settings.get();
    const [reports, strikes, history] = await Promise.all([
      this.reports.find({ offerId: reportCase.offerId }).sort({ createdAt: -1 }).populate('reporterId', 'name email').lean(),
      this.strikes.countDocuments({ businessId: reportCase.businessId, revokedAt: { $exists: false }, createdAt: { $gte: new Date(Date.now() - settings.reports.strikeWindowDays * DAY) } }),
      this.audit.trail('Offer', String((reportCase.offerId as unknown as { _id: Types.ObjectId })._id), 30),
    ]);
    return {
      case: reportCase,
      reports: reports.map((r) => ({ ...r, reasonLabel: REPORT_REASON_LABELS[r.reason], hasPhoto: !!r.photoKey, photoKey: undefined, reporterKey: undefined })),
      strikesInWindow: strikes,
      strikeThreshold: settings.reports.strikeThreshold,
      offerHistory: history,
    };
  }

  async photo(reportId: string) {
    const report = Types.ObjectId.isValid(reportId) ? await this.reports.findById(reportId).lean() : null;
    if (!report?.photoKey) throw new NotFoundException('No photo');
    return this.storage.read(report.photoKey);
  }

  /** Uphold: the offer is removed, the business told why and given a strike, reporters told action was taken. */
  async uphold(id: string, reason: ReportReason, note: string, adminId: string) {
    const reportCase = await this.loadCase(id);
    if (!OPEN_CASE.includes(reportCase.status)) throw new BadRequestException(`This report is already ${reportCase.status}`);
    const offer = await this.offers.findById(reportCase.offerId);
    if (!offer) throw new NotFoundException('Offer not found');
    const before = offer.status;
    if (offer.status !== OfferStatus.REMOVED) {
      offer.set({ status: OfferStatus.REMOVED, removedAt: new Date(), removedReason: `Report upheld: ${REPORT_REASON_LABELS[reason]}` });
      await offer.save();
      await recountActiveOffers(this.offers, this.businesses, offer.businessId);
    }
    reportCase.set({
      status: ReportStatus.UPHELD,
      decisionReason: reason,
      decisionNote: note,
      decidedBy: new Types.ObjectId(adminId),
      decidedAt: new Date(),
      statusBeforeHide: reportCase.statusBeforeHide ?? before,
    });
    await reportCase.save();
    await this.reports.updateMany({ offerId: offer._id, status: { $in: OPEN_CASE } }, { $set: { status: ReportStatus.UPHELD, decidedBy: new Types.ObjectId(adminId), decidedAt: new Date(), decisionNote: note } });
    await this.strikes.create({ businessId: offer.businessId, reportCaseId: reportCase._id, offerId: offer._id });
    await this.audit.record({ action: 'report.upheld', targetType: 'Offer', targetId: offer._id, before: { status: before }, after: { status: OfferStatus.REMOVED, reason, case: String(reportCase._id) }, note });

    const business = await this.businesses.findById(offer.businessId).select('name').lean();
    await this.notifications.notifyBusiness(offer.businessId, {
      type: 'report_upheld',
      title: `“${offer.title}” has been removed`,
      body: `${REPORT_REASON_LABELS[reason]}. ${note}`,
      link: '/dashboard/offers?tab=hidden',
      email: { template: 'report_upheld_business', vars: { businessName: business?.name, offerTitle: offer.title, reason: REPORT_REASON_LABELS[reason], note, link: siteUrl('/dashboard/offers?tab=hidden') } },
    });
    await this.tellReporters(offer._id, offer.title, 'report_outcome_action');
    await this.checkStrikes(offer.businessId);
    return reportCase;
  }

  /** Reject: the case closes; an auto-hidden offer goes live again; reporters told no action was taken. */
  async reject(id: string, note: string, adminId: string) {
    const reportCase = await this.loadCase(id);
    if (!OPEN_CASE.includes(reportCase.status)) throw new BadRequestException(`This report is already ${reportCase.status}`);
    const offer = await this.offers.findById(reportCase.offerId);
    if (offer && reportCase.autoHidden && offer.status === OfferStatus.HIDDEN_BY_REPORTS) {
      const restore = (reportCase.statusBeforeHide as OfferStatus) ?? OfferStatus.ACTIVE;
      offer.set({ status: offer.endsAt && offer.endsAt < new Date() ? OfferStatus.EXPIRED : restore, hiddenByReportsAt: undefined });
      await offer.save();
      await recountActiveOffers(this.offers, this.businesses, offer.businessId);
    }
    reportCase.set({ status: ReportStatus.REJECTED, decisionNote: note, decidedBy: new Types.ObjectId(adminId), decidedAt: new Date() });
    await reportCase.save();
    await this.reports.updateMany({ offerId: reportCase.offerId, status: { $in: OPEN_CASE } }, { $set: { status: ReportStatus.REJECTED, decidedBy: new Types.ObjectId(adminId), decidedAt: new Date(), decisionNote: note } });
    await this.audit.record({ action: 'report.rejected', targetType: 'Offer', targetId: reportCase.offerId, after: { case: String(reportCase._id), restored: reportCase.autoHidden, status: offer?.status }, note });
    if (offer) await this.tellReporters(offer._id, offer.title, 'report_outcome_no_action');
    return reportCase;
  }

  /** "Ask business": a dashboard message and email; 48 hours to reply or edit the offer. */
  async askBusiness(id: string, message: string, adminId: string) {
    const reportCase = await this.loadCase(id);
    if (reportCase.status !== ReportStatus.OPEN) throw new BadRequestException(`This report is ${reportCase.status}`);
    const deadline = new Date(Date.now() + INFO_HOURS * 3600_000);
    reportCase.set({ status: ReportStatus.INFO_REQUESTED, infoRequestedAt: new Date(), infoDeadline: deadline, infoMessage: message });
    await reportCase.save();
    await this.reports.updateMany({ offerId: reportCase.offerId, status: ReportStatus.OPEN }, { $set: { status: ReportStatus.INFO_REQUESTED } });
    const offer = await this.offers.findById(reportCase.offerId).select('title').lean();
    const business = await this.businesses.findById(reportCase.businessId).select('name').lean();
    const deadlineText = deadline.toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
    await this.notifications.notifyBusiness(reportCase.businessId, {
      type: 'report_info_requested',
      title: `Please check “${offer?.title ?? 'your offer'}”`,
      body: `${message} Reply by ${deadlineText}.`,
      link: '/dashboard/reports',
      email: { template: 'report_info_requested', vars: { businessName: business?.name, offerTitle: offer?.title, message, deadline: deadlineText, link: siteUrl('/dashboard/reports') } },
    });
    await this.audit.record({ action: 'report.info_requested', targetType: 'Offer', targetId: reportCase.offerId, after: { case: String(reportCase._id), deadline }, note: message });
    void adminId;
    return reportCase;
  }

  async bulkReject(ids: string[], note: string, adminId: string) {
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      try {
        await this.reject(id, note, adminId);
        results.push({ id, ok: true });
      } catch (err) {
        results.push({ id, ok: false, error: (err as Error).message });
      }
    }
    return { results };
  }

  async blockReporter(reportId: string, reason: string, adminId: string) {
    const report = Types.ObjectId.isValid(reportId) ? await this.reports.findById(reportId) : null;
    if (!report) throw new NotFoundException('Report not found');
    await this.blocks.create({ reporterKey: report.reporterKey, email: report.reporterEmail, userId: report.reporterId, blockedBy: new Types.ObjectId(adminId), reason });
    await this.audit.record({ action: 'report.reporter_blocked', targetType: 'Report', targetId: report._id, note: reason });
    return { blocked: true };
  }

  async decideAppeal(id: string, accept: boolean, response: string, adminId: string) {
    const reportCase = await this.loadCase(id);
    if (reportCase.appeal?.status !== 'open') throw new BadRequestException('There is no open appeal');
    reportCase.set({ 'appeal.status': accept ? 'accepted' : 'declined', 'appeal.response': response, 'appeal.decidedAt': new Date() });
    await reportCase.save();
    if (accept) {
      await this.strikes.updateMany({ reportCaseId: reportCase._id, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
      const offer = await this.offers.findById(reportCase.offerId);
      if (offer && offer.status === OfferStatus.REMOVED) {
        const restore = (reportCase.statusBeforeHide as OfferStatus) ?? OfferStatus.ACTIVE;
        offer.set({ status: offer.endsAt && offer.endsAt < new Date() ? OfferStatus.EXPIRED : restore === OfferStatus.HIDDEN_BY_REPORTS ? OfferStatus.ACTIVE : restore, removedAt: undefined, removedReason: undefined });
        await offer.save();
        await recountActiveOffers(this.offers, this.businesses, offer.businessId);
      }
    }
    await this.audit.record({ action: accept ? 'report.appeal_accepted' : 'report.appeal_declined', targetType: 'Offer', targetId: reportCase.offerId, after: { case: String(reportCase._id) }, note: response });
    await this.notifications.notifyBusiness(reportCase.businessId, {
      type: 'report_appeal_decided',
      title: accept ? 'Your appeal was accepted' : 'Your appeal was not accepted',
      body: response,
      link: '/dashboard/reports',
    });
    void adminId;
    return reportCase;
  }

  /** Three upheld reports within 90 days flag the business for a suspension review. */
  private async checkStrikes(businessId: Types.ObjectId) {
    const settings = await this.settings.get();
    const count = await this.strikes.countDocuments({ businessId, revokedAt: { $exists: false }, createdAt: { $gte: new Date(Date.now() - settings.reports.strikeWindowDays * DAY) } });
    if (count < settings.reports.strikeThreshold) return;
    const business = await this.businesses.findById(businessId);
    if (!business || (business.suspensionReview && !business.suspensionReview.resolvedAt)) return;
    business.set({ suspensionReview: { flaggedAt: new Date(), reason: `${count} upheld offer reports in ${settings.reports.strikeWindowDays} days` } });
    await business.save();
    await this.audit.record({ action: 'business.flagged_by_strikes', targetType: 'Business', targetId: businessId, after: { strikes: count } }, { kind: ActorKind.SYSTEM, component: REPORTS_COMPONENT });
  }

  private async tellReporters(offerId: Types.ObjectId, offerTitle: string, template: string) {
    const reports = await this.reports.find({ offerId, reporterEmail: { $exists: true }, reporterNotifiedAt: { $exists: false } }).select('reporterEmail').lean();
    const emails = [...new Set(reports.map((r) => r.reporterEmail!).filter(Boolean))];
    for (const to of emails) await this.email.send({ to, template, vars: { offerTitle } });
    await this.reports.updateMany({ _id: { $in: reports.map((r) => r._id) } }, { $set: { reporterNotifiedAt: new Date() } });
  }

  // ---------------------------------------------------------------------------------------------------
  // The business's side: decisions only, never who reported
  // ---------------------------------------------------------------------------------------------------

  async forBusiness(businessId: string, user: AuthUser) {
    const business = await this.access.load(businessId, user, 'staff');
    const cases = await this.cases
      .find({ businessId: business._id, status: { $in: [ReportStatus.INFO_REQUESTED, ReportStatus.UPHELD, ReportStatus.REJECTED] } })
      .sort({ updatedAt: -1 })
      .limit(50)
      .populate('offerId', 'title status')
      .lean();
    const reasons = await this.reports.aggregate([
      { $match: { offerId: { $in: cases.map((c) => (c.offerId as unknown as { _id: Types.ObjectId })._id) } } },
      { $group: { _id: { offer: '$offerId', reason: '$reason' }, count: { $sum: 1 } } },
    ]);
    return cases.map((c) => ({
      _id: c._id,
      offer: c.offerId,
      status: c.status,
      reportCount: c.reportCount,
      reasons: reasons.filter((r) => String(r._id.offer) === String((c.offerId as unknown as { _id: Types.ObjectId })._id)).map((r) => ({ label: REPORT_REASON_LABELS[r._id.reason as ReportReason], count: r.count })),
      decisionReason: c.decisionReason ? REPORT_REASON_LABELS[c.decisionReason] : undefined,
      decisionNote: c.decisionNote,
      decidedAt: c.decidedAt,
      infoMessage: c.infoMessage,
      infoDeadline: c.infoDeadline,
      businessReplies: c.businessReplies,
      appeal: c.appeal,
      canAppeal: c.status === ReportStatus.UPHELD && !c.appeal,
      canReply: c.status === ReportStatus.INFO_REQUESTED,
    }));
  }

  async reply(businessId: string, caseId: string, message: string, user: AuthUser) {
    const business = await this.access.load(businessId, user, 'staff');
    const reportCase = await this.cases.findOne({ _id: caseId, businessId: business._id });
    if (!reportCase) throw new NotFoundException('Report not found');
    if (reportCase.status !== ReportStatus.INFO_REQUESTED) throw new BadRequestException('We are not waiting for a reply on this');
    reportCase.businessReplies.push({ message, at: new Date(), by: new Types.ObjectId(user.userId) });
    await reportCase.save();
    await this.audit.record({ action: 'report.business_replied', targetType: 'Offer', targetId: reportCase.offerId, note: message.slice(0, 500) });
    return { replied: true };
  }

  async appeal(businessId: string, caseId: string, message: string, user: AuthUser) {
    const business = await this.access.load(businessId, user, 'owner');
    const reportCase = await this.cases.findOne({ _id: caseId, businessId: business._id });
    if (!reportCase) throw new NotFoundException('Report not found');
    if (reportCase.status !== ReportStatus.UPHELD) throw new BadRequestException('Only removed offers can be appealed');
    if (reportCase.appeal) throw new BadRequestException('You can appeal a decision once');
    reportCase.set({ appeal: { message, at: new Date(), by: new Types.ObjectId(user.userId), status: 'open' } });
    await reportCase.save();
    await this.audit.record({ action: 'report.appealed', targetType: 'Offer', targetId: reportCase.offerId, note: message.slice(0, 500) });
    return { appealed: true };
  }
}
