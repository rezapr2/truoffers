import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClaimStatus, VerificationLevel } from '../common/enums';
import { siteUrl } from '../platform/email.service';
import { ClaimsAdminService } from './claims-admin.service';
import { ClaimsService } from './claims.service';

// A claim that passed the phone check but was never submitted stops blocking the listing after this.
const DRAFT_DAYS = 14;
const REMINDER_DAYS = 30;

@Injectable()
export class ClaimsJobs {
  private readonly logger = new Logger(ClaimsJobs.name);

  constructor(private readonly claims: ClaimsService, private readonly admin: ClaimsAdminService) {}

  /** "Request more info → the claim stays open 14 days, then expires." Abandoned drafts close the same way. */
  @Cron(CronExpression.EVERY_HOUR)
  async expireClaims() {
    const now = new Date();
    const waiting = await this.claims.claims.find({ status: ClaimStatus.INFO_REQUESTED, expiresAt: { $lt: now } });
    for (const claim of waiting) await this.admin.closeExpired(claim);
    const abandoned = await this.claims.claims.find({
      status: ClaimStatus.DRAFT,
      updatedAt: { $lt: new Date(now.getTime() - DRAFT_DAYS * 24 * 3600_000) },
    });
    for (const claim of abandoned) await this.claims.close(claim, ClaimStatus.EXPIRED, `Not submitted within ${DRAFT_DAYS} days`);
    if (waiting.length || abandoned.length) this.logger.log(`Closed ${waiting.length} unanswered and ${abandoned.length} abandoned claim(s)`);
    return { waiting: waiting.length, abandoned: abandoned.length };
  }

  /** Verification documents are deleted 90 days after the decision. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async deleteOldDocuments() {
    const due = await this.claims.files.find({ deleteAfter: { $lt: new Date() }, deletedAt: { $exists: false } }).limit(1000);
    for (const doc of due) {
      await this.claims.storage.remove(doc.storageKey);
      doc.deletedAt = new Date();
      await doc.save();
    }
    if (due.length) this.logger.log(`Deleted ${due.length} verification document(s)`);
    return due.length;
  }

  /** Every 12 months the owner is asked to verify again; the badge stays meanwhile. */
  @Cron('0 10 * * *', { timeZone: 'Europe/London' })
  async reverificationReminders() {
    const now = new Date();
    const due = await this.claims.businesses
      .find({
        verificationLevel: { $gte: VerificationLevel.VERIFIED },
        reverificationDueAt: { $lt: now },
        $or: [{ reverificationNotifiedAt: { $exists: false } }, { reverificationNotifiedAt: { $lt: new Date(now.getTime() - REMINDER_DAYS * 24 * 3600_000) } }],
      })
      .select('name members ownerId')
      .limit(500);
    for (const business of due) {
      await this.claims.notifications.notifyBusiness(
        business._id,
        {
          type: 'reverification_due',
          title: `Time to re-verify ${business.name}`,
          body: 'It has been a year since you were verified. Your badge stays while you confirm.',
          link: '/dashboard/verification',
          email: { template: 'reverification_due', vars: { businessName: business.name, link: siteUrl('/dashboard/verification') } },
        },
        'owners',
      );
      business.reverificationNotifiedAt = now;
      await business.save();
    }
    if (due.length) this.logger.log(`Sent ${due.length} re-verification reminder(s)`);
    return due.length;
  }
}

