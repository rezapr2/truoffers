import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubscriptionStatus } from '../common/enums';
import { siteUrl } from '../platform/email.service';
import { NotificationsService } from '../platform/notifications.service';
import { BillingService, Interval } from './billing.service';

const DAY = 24 * 3600_000;
const REMINDER_GAP_DAYS = 3;
const MAX_REMINDERS = 3;
const GRACE_DAYS = 14;
const RENEWAL_NOTICE_DAYS = 7;

/** Spec T4.5 (failed payments) and the end-of-period changes the owner asked for. */
@Injectable()
export class BillingJobs {
  private readonly logger = new Logger(BillingJobs.name);

  constructor(private readonly billing: BillingService, private readonly notifications: NotificationsService) {}

  /** Past due: up to 3 reminder emails, then the plan moves to Free 14 days after the first failure. */
  @Cron('0 8 * * *', { timeZone: 'Europe/London' })
  async failedPayments() {
    const now = Date.now();
    const pastDue = await this.billing.subscriptions.find({ status: SubscriptionStatus.PAST_DUE });
    let reminded = 0;
    let downgraded = 0;
    for (const sub of pastDue) {
      const since = sub.pastDueSince ?? (sub as unknown as { updatedAt?: Date }).updatedAt ?? new Date();
      if (now - since.getTime() >= GRACE_DAYS * DAY) {
        const stripe = await this.billing.stripe.client();
        if (stripe && sub.stripeSubscriptionId) await stripe.subscriptions.cancel(sub.stripeSubscriptionId).catch((err) => this.billing.stripe.logError('Cancel past-due subscription', err));
        await this.billing.endSubscription(sub, `Payment failed for ${GRACE_DAYS} days`);
        downgraded++;
        continue;
      }
      const last = sub.lastReminderAt?.getTime() ?? 0;
      if (sub.reminderCount < MAX_REMINDERS && now - last >= REMINDER_GAP_DAYS * DAY) {
        sub.reminderCount += 1;
        sub.lastReminderAt = new Date();
        await sub.save();
        await this.billing.sendPaymentReminder(sub, sub.reminderCount);
        reminded++;
      }
    }
    if (reminded || downgraded) this.logger.log(`Payment reminders: ${reminded} sent, ${downgraded} plan(s) moved to Free`);
    return { reminded, downgraded };
  }

  /**
   * At the end of a period: cancellations end, scheduled downgrades take effect, and (in mock mode, where no
   * Stripe invoice will arrive) the subscription renews with a mock invoice.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async periodEnds() {
    const now = new Date();
    const due = await this.billing.subscriptions.find({
      status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
      currentPeriodEnd: { $lte: now },
    });
    const stripeEnabled = await this.billing.stripe.enabled();
    for (const sub of due) {
      if (sub.cancelAtPeriodEnd) {
        // Stripe ends its own subscriptions and tells us by webhook.
        if (!sub.stripeSubscriptionId || !stripeEnabled) await this.billing.endSubscription(sub, 'Cancelled at the end of the billing period');
        continue;
      }
      if (sub.comp && !sub.stripeSubscriptionId) {
        await this.billing.endSubscription(sub, 'The complimentary plan has ended');
        continue;
      }
      if (sub.pendingPlanKey) {
        const plan = await this.billing.planLean(sub.pendingPlanKey);
        const interval = (sub.pendingInterval ?? sub.interval) as Interval;
        if (plan) sub.set({ planKey: plan.key, interval, price: interval === 'annual' ? plan.annualPrice : plan.monthlyPrice });
        sub.set({ pendingPlanKey: undefined, pendingInterval: undefined });
      }
      if (!sub.stripeSubscriptionId) {
        const interval = sub.interval as Interval;
        sub.currentPeriodEnd = new Date(now.getTime() + (interval === 'annual' ? 365 : 30) * DAY);
        if (sub.status === SubscriptionStatus.TRIALING) sub.status = SubscriptionStatus.ACTIVE;
        const plan = await this.billing.planLean(sub.planKey);
        if (sub.price > 0 && sub.businessId) await this.billing.recordMockPayment(sub.businessId, sub, `${plan?.name ?? sub.planKey} plan renewal (${interval})`, sub.price, plan ?? undefined);
      }
      await sub.save();
    }
    return due.length;
  }

  /** A week before a paid plan renews, the owner is reminded. */
  @Cron('0 9 * * *', { timeZone: 'Europe/London' })
  async renewalReminders() {
    const now = Date.now();
    const subs = await this.billing.subscriptions.find({
      status: SubscriptionStatus.ACTIVE,
      price: { $gt: 0 },
      comp: { $ne: true },
      cancelAtPeriodEnd: { $ne: true },
      currentPeriodEnd: { $gt: new Date(now), $lte: new Date(now + RENEWAL_NOTICE_DAYS * DAY) },
    });
    let sent = 0;
    for (const sub of subs) {
      if (!sub.businessId || (sub.renewalReminderSentFor && sub.renewalReminderSentFor.getTime() === sub.currentPeriodEnd?.getTime())) continue;
      const plan = await this.billing.planLean(sub.pendingPlanKey ?? sub.planKey);
      const breakdown = await this.billing.breakdown(sub.price, plan ?? undefined);
      const renewsOn = sub.currentPeriodEnd!.toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' });
      await this.notifications.notifyBusiness(sub.businessId, {
        type: 'subscription_renewal',
        title: `Your plan renews on ${renewsOn}`,
        link: '/dashboard/billing',
        email: { template: 'subscription_renewal', vars: { planName: plan?.name ?? sub.planKey, renewsOn, amount: `£${breakdown.total.toFixed(2)}`, link: siteUrl('/dashboard/billing') } },
      }, 'owners');
      sub.renewalReminderSentFor = sub.currentPeriodEnd;
      await sub.save();
      sent++;
    }
    return sent;
  }
}
