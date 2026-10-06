import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PaymentStatus, PLAN_GRANTING_STATUSES, PlanKey, SubscriptionStatus } from '../common/enums';
import { escapeRegex } from '../businesses/businesses.service';
import { AuditService } from '../scraper/audit/audit.service';
import { Business, BusinessDocument } from '../schemas/business.schema';
import { Coupon, CouponDocument, Payment, PaymentDocument } from '../schemas/payment.schema';
import { Plan, PlanDocument } from '../schemas/plan.schema';
import { Subscription, SubscriptionDocument } from '../schemas/subscription.schema';
import { BillingService, Interval } from './billing.service';
import { pence, StripeService } from './stripe.service';

export interface PlanInput {
  key?: string;
  name?: string;
  audience?: string;
  monthlyPrice?: number;
  annualPrice?: number;
  vatRatePercent?: number | null;
  trialDays?: number;
  bestFor?: string;
  limits?: Partial<Plan['limits']>;
  flags?: Partial<Plan['flags']>;
  features?: string[];
  autoApprove?: boolean;
  isPublic?: boolean;
  sortOrder?: number;
  badgeText?: string;
  migrateExisting?: boolean;
}

export interface CouponInput {
  code?: string;
  description?: string;
  percentOff?: number | null;
  amountOff?: number | null;
  duration?: string;
  durationInMonths?: number | null;
  appliesToPlans?: string[];
  maxUses?: number | null;
  expiresAt?: string | null;
  active?: boolean;
}

const PAGE_SIZE = 40;

/** /admin/plans, /admin/billing and /admin/coupons. Super admins only. */
@Injectable()
export class BillingAdminService {
  constructor(
    @InjectModel(Plan.name) private readonly plans: Model<PlanDocument>,
    @InjectModel(Subscription.name) private readonly subscriptions: Model<SubscriptionDocument>,
    @InjectModel(Payment.name) private readonly payments: Model<PaymentDocument>,
    @InjectModel(Coupon.name) private readonly coupons: Model<CouponDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    private readonly billing: BillingService,
    private readonly stripe: StripeService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------------------------------
  // Plans (spec T4.1)
  // ---------------------------------------------------------------------------------------------------

  async listPlans() {
    const plans = await this.plans.find().sort({ audience: -1, sortOrder: 1 }).lean();
    const counts = await this.subscriptions.aggregate([
      { $match: { status: { $in: PLAN_GRANTING_STATUSES } } },
      { $group: { _id: '$planKey', count: { $sum: 1 } } },
    ]);
    const byKey = new Map(counts.map((c) => [c._id, c.count]));
    return { plans: plans.map((p) => ({ ...p, subscribers: byKey.get(p.key) ?? 0 })), stripeEnabled: await this.stripe.enabled() };
  }

  private snapshot(plan: Plan) {
    return {
      name: plan.name,
      monthlyPrice: plan.monthlyPrice,
      annualPrice: plan.annualPrice,
      vatRatePercent: plan.vatRatePercent,
      trialDays: plan.trialDays,
      limits: { ...plan.limits },
      flags: { ...plan.flags },
      autoApprove: plan.autoApprove,
      isPublic: plan.isPublic,
      archived: plan.archived,
      badgeText: plan.badgeText,
      sortOrder: plan.sortOrder,
    };
  }

  async createPlan(input: PlanInput) {
    const key = input.key?.trim().toLowerCase();
    if (!key || !/^[a-z0-9][a-z0-9_-]{1,40}$/.test(key)) throw new BadRequestException('Use a short key with letters, numbers, - or _');
    if (await this.plans.exists({ key })) throw new ConflictException('A plan with that key already exists');
    const plan = await this.plans.create({ ...this.fields(input), key, audience: input.audience ?? 'takeaway' });
    await this.stripe.syncPlan(plan).catch((err) => this.stripe.logError(`Stripe sync for ${key}`, err));
    await this.audit.record({ action: 'plan.created', targetType: 'Plan', targetId: key, after: this.snapshot(plan) });
    return plan;
  }

  private fields(input: PlanInput) {
    const fields: Record<string, unknown> = {};
    for (const key of ['name', 'monthlyPrice', 'annualPrice', 'trialDays', 'bestFor', 'features', 'autoApprove', 'isPublic', 'sortOrder', 'badgeText'] as const) {
      if (input[key] !== undefined) fields[key] = input[key];
    }
    if (input.vatRatePercent !== undefined) fields.vatRatePercent = input.vatRatePercent ?? undefined;
    if (input.limits) for (const [k, v] of Object.entries(input.limits)) if (v !== undefined) fields[`limits.${k}`] = v;
    if (input.flags) for (const [k, v] of Object.entries(input.flags)) if (v !== undefined) fields[`flags.${k}`] = v;
    return fields;
  }

  /**
   * Price changes apply to new subscriptions. With `migrateExisting`, current subscribers move to the new price
   * from their next renewal.
   */
  async updatePlan(key: string, input: PlanInput) {
    const plan = await this.plans.findOne({ key });
    if (!plan) throw new NotFoundException('Plan not found');
    const before = this.snapshot(plan);
    if (input.monthlyPrice !== undefined && key === PlanKey.FREE && input.monthlyPrice > 0) throw new BadRequestException('The Free plan stays free');
    plan.set(this.fields(input));
    await plan.save();
    const priceChanged = before.monthlyPrice !== plan.monthlyPrice || before.annualPrice !== plan.annualPrice;
    await this.stripe.syncPlan(plan).catch((err) => this.stripe.logError(`Stripe sync for ${key}`, err));
    let migrated = 0;
    if (priceChanged && input.migrateExisting) migrated = await this.migrateSubscribers(plan);
    await this.audit.record({ action: 'plan.updated', targetType: 'Plan', targetId: key, before, after: { ...this.snapshot(plan), migratedSubscribers: migrated } });
    return { plan, migrated };
  }

  private async migrateSubscribers(plan: PlanDocument) {
    const subs = await this.subscriptions.find({ planKey: plan.key, status: { $in: PLAN_GRANTING_STATUSES }, comp: { $ne: true } });
    const stripe = await this.stripe.client();
    let count = 0;
    for (const sub of subs) {
      const interval = sub.interval as Interval;
      const price = interval === 'annual' ? plan.annualPrice : plan.monthlyPrice;
      if (stripe && sub.stripeSubscriptionId) {
        const priceId = interval === 'annual' ? plan.stripe.annualPriceId : plan.stripe.monthlyPriceId;
        if (!priceId) continue;
        const remote = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId).catch(() => null);
        if (!remote) continue;
        await stripe.subscriptions.update(sub.stripeSubscriptionId, { items: [{ id: remote.items.data[0].id, price: priceId }], proration_behavior: 'none' });
      }
      sub.price = price;
      await sub.save();
      count++;
    }
    return count;
  }

  async setArchived(key: string, archived: boolean) {
    if (key === PlanKey.FREE && archived) throw new BadRequestException('The Free plan cannot be archived');
    const plan = await this.plans.findOne({ key });
    if (!plan) throw new NotFoundException('Plan not found');
    const before = { archived: plan.archived, isPublic: plan.isPublic };
    plan.archived = archived;
    if (!archived && !plan.isPublic) plan.isPublic = true;
    await plan.save();
    await this.stripe.syncPlan(plan).catch(() => undefined);
    await this.audit.record({ action: archived ? 'plan.archived' : 'plan.restored', targetType: 'Plan', targetId: key, before, after: { archived: plan.archived, isPublic: plan.isPublic } });
    return plan;
  }

  // ---------------------------------------------------------------------------------------------------
  // Subscriptions and payments (spec T4.6)
  // ---------------------------------------------------------------------------------------------------

  private async businessIdsMatching(q?: string) {
    if (!q) return null;
    return this.businesses.find({ name: new RegExp(escapeRegex(q), 'i') }).distinct('_id');
  }

  async listSubscriptions(query: { status?: string; plan?: string; q?: string; page?: string }, limit = PAGE_SIZE) {
    const filter: Record<string, unknown> = { businessId: { $exists: true } };
    if (query.status) filter.status = { $in: query.status.split(',') };
    if (query.plan) filter.planKey = query.plan;
    const ids = await this.businessIdsMatching(query.q);
    if (ids) filter.businessId = { $in: ids };
    const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
    const [items, total] = await Promise.all([
      this.subscriptions.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('businessId', 'name slug town').populate('userId', 'name email').lean(),
      this.subscriptions.countDocuments(filter),
    ]);
    return { items, total, page, pages: Math.ceil(total / limit) };
  }

  async listPayments(query: { status?: string; kind?: string; q?: string; page?: string }, limit = PAGE_SIZE) {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = { $in: query.status.split(',') };
    if (query.kind) filter.kind = query.kind;
    const ids = await this.businessIdsMatching(query.q);
    if (ids) filter.businessId = { $in: ids };
    const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
    const [items, total, totals] = await Promise.all([
      this.payments.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('businessId', 'name slug').lean(),
      this.payments.countDocuments(filter),
      this.payments.aggregate([{ $match: { status: { $in: [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED] }, createdAt: { $gte: new Date(Date.now() - 30 * 24 * 3600_000) } } }, { $group: { _id: null, total: { $sum: '$total' }, refunded: { $sum: '$refundedAmount' } } }]),
    ]);
    return { items, total, page, pages: Math.ceil(total / limit), last30Days: totals[0] ?? { total: 0, refunded: 0 } };
  }

  async failed() {
    const [pastDue, payments] = await Promise.all([
      this.subscriptions.find({ status: SubscriptionStatus.PAST_DUE }).sort({ pastDueSince: 1 }).populate('businessId', 'name slug').populate('userId', 'name email').lean(),
      this.payments.find({ status: PaymentStatus.FAILED }).sort({ createdAt: -1 }).limit(100).populate('businessId', 'name slug').lean(),
    ]);
    return { pastDue, payments };
  }

  async refund(paymentId: string, input: { amount?: number; reason?: string }) {
    const payment = Types.ObjectId.isValid(paymentId) ? await this.payments.findById(paymentId) : null;
    if (!payment) throw new NotFoundException('Payment not found');
    if (![PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED].includes(payment.status)) throw new BadRequestException('Only paid payments can be refunded');
    const remaining = Math.round((payment.total - payment.refundedAmount) * 100) / 100;
    const amount = input.amount ? Math.min(input.amount, remaining) : remaining;
    if (amount <= 0) throw new BadRequestException('Nothing left to refund');
    const stripe = await this.stripe.client();
    if (stripe && !payment.mock) {
      const intent = payment.stripePaymentIntentId ?? (payment.stripeInvoiceId ? await this.stripe.paymentIntentForInvoice(payment.stripeInvoiceId) : undefined);
      if (!intent && !payment.stripeChargeId) throw new BadRequestException('Stripe has no payment to refund for this invoice');
      await stripe.refunds.create({
        ...(intent ? { payment_intent: intent } : { charge: payment.stripeChargeId! }),
        amount: pence(amount),
        reason: 'requested_by_customer',
        metadata: { paymentId: String(payment._id), note: input.reason ?? '' },
      });
    }
    const before = { status: payment.status, refundedAmount: payment.refundedAmount };
    payment.refundedAmount = Math.round((payment.refundedAmount + amount) * 100) / 100;
    payment.status = payment.refundedAmount >= payment.total ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;
    await payment.save();
    await this.audit.record({ action: 'billing.refunded', targetType: 'Payment', targetId: payment._id, before, after: { status: payment.status, refundedAmount: payment.refundedAmount, amount }, note: input.reason });
    return payment;
  }

  /**
   * Manual plan change. `comp` gives the plan without payment (any Stripe subscription is cancelled); otherwise
   * the business's paid subscription moves to the plan, or a mock/paid-elsewhere subscription is recorded.
   */
  async setPlan(businessId: string, input: { planKey: string; interval: Interval; comp: boolean; months?: number; note?: string }, adminId: string) {
    const business = Types.ObjectId.isValid(businessId) ? await this.businesses.findById(businessId) : null;
    if (!business) throw new NotFoundException('Business not found');
    const plan = await this.plans.findOne({ key: input.planKey });
    if (!plan) throw new NotFoundException('Plan not found');
    const current = await this.subscriptions.findOne({ businessId: business._id, status: { $in: PLAN_GRANTING_STATUSES } });
    const before = current ? { planKey: current.planKey, comp: current.comp, price: current.price } : { planKey: 'free' };

    if (plan.key === PlanKey.FREE) {
      if (current) await this.cancelSubscription(String(current._id), true, input.note ?? 'Moved to Free by an admin');
      await this.audit.record({ action: 'billing.plan_set_by_admin', targetType: 'Business', targetId: business._id, before, after: { planKey: 'free' }, note: input.note });
      return { planKey: 'free' };
    }
    const stripe = await this.stripe.client();
    if (!input.comp && current?.stripeSubscriptionId && stripe) {
      const synced = await this.stripe.syncPlan(plan);
      const priceId = input.interval === 'annual' ? synced.stripe.annualPriceId : synced.stripe.monthlyPriceId;
      const remote = await stripe.subscriptions.retrieve(current.stripeSubscriptionId);
      await stripe.subscriptions.update(current.stripeSubscriptionId, { items: [{ id: remote.items.data[0].id, price: priceId }], proration_behavior: 'none' });
      current.set({ planKey: plan.key, interval: input.interval, price: input.interval === 'annual' ? plan.annualPrice : plan.monthlyPrice, pendingPlanKey: undefined });
      await current.save();
      await this.audit.record({ action: 'billing.plan_set_by_admin', targetType: 'Business', targetId: business._id, before, after: { planKey: plan.key, interval: input.interval }, note: input.note });
      return current;
    }
    const sub = await this.billing.activate({
      businessId: business._id,
      userId: String(business.ownerId ?? adminId),
      planKey: plan.key,
      interval: input.interval,
      price: input.comp ? 0 : input.interval === 'annual' ? plan.annualPrice : plan.monthlyPrice,
      comp: input.comp,
      compNote: input.note,
      currentPeriodEnd: input.months ? new Date(Date.now() + input.months * 30 * 24 * 3600_000) : undefined,
    });
    await this.audit.record({ action: 'billing.plan_set_by_admin', targetType: 'Business', targetId: business._id, before, after: { planKey: plan.key, interval: input.interval, comp: input.comp, months: input.months }, note: input.note });
    return sub;
  }

  async cancelSubscription(id: string, immediately: boolean, note?: string) {
    const sub = Types.ObjectId.isValid(id) ? await this.subscriptions.findById(id) : null;
    if (!sub) throw new NotFoundException('Subscription not found');
    const stripe = await this.stripe.client();
    if (stripe && sub.stripeSubscriptionId) {
      if (immediately) await stripe.subscriptions.cancel(sub.stripeSubscriptionId).catch((err) => this.stripe.logError('Admin cancel', err));
      else await stripe.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: true });
    }
    if (immediately) await this.billing.endSubscription(sub, note ?? 'Cancelled by an admin');
    else {
      sub.cancelAtPeriodEnd = true;
      await sub.save();
      await this.audit.record({ action: 'billing.cancel_scheduled_by_admin', targetType: 'Business', targetId: sub.businessId, after: { planKey: sub.planKey }, note });
    }
    return sub;
  }

  // ---------------------------------------------------------------------------------------------------
  // Coupons
  // ---------------------------------------------------------------------------------------------------

  private couponSnapshot(coupon: Coupon): Record<string, unknown> {
    const { code, description, percentOff, amountOff, duration, durationInMonths, appliesToPlans, maxUses, timesUsed, expiresAt, active } = coupon;
    return { code, description, percentOff, amountOff, duration, durationInMonths, appliesToPlans: [...(appliesToPlans ?? [])], maxUses, timesUsed, expiresAt, active };
  }

  listCoupons() {
    return this.coupons.find().sort({ createdAt: -1 }).lean();
  }

  private couponFields(input: CouponInput) {
    if (input.percentOff && input.amountOff) throw new BadRequestException('Use either a percentage or an amount off, not both');
    if (input.percentOff !== undefined && input.percentOff !== null && (input.percentOff <= 0 || input.percentOff > 100)) throw new BadRequestException('Percentage must be between 1 and 100');
    if (input.duration && !['once', 'repeating', 'forever'].includes(input.duration)) throw new BadRequestException('Duration must be once, repeating or forever');
    if (input.duration === 'repeating' && !input.durationInMonths) throw new BadRequestException('Set how many months the discount repeats');
    const fields: Record<string, unknown> = {};
    for (const key of ['description', 'percentOff', 'amountOff', 'duration', 'durationInMonths', 'appliesToPlans', 'maxUses', 'active'] as const) {
      if (input[key] !== undefined) fields[key] = input[key] ?? undefined;
    }
    if (input.expiresAt !== undefined) fields.expiresAt = input.expiresAt ? new Date(input.expiresAt) : undefined;
    return fields;
  }

  async createCoupon(input: CouponInput) {
    const code = input.code?.trim().toUpperCase();
    if (!code || !/^[A-Z0-9_-]{3,30}$/.test(code)) throw new BadRequestException('Use 3 to 30 letters, numbers, - or _');
    if (!input.percentOff && !input.amountOff) throw new BadRequestException('Set a percentage or an amount off');
    if (await this.coupons.exists({ code })) throw new ConflictException('That code already exists');
    const coupon = await this.coupons.create({ code, duration: 'once', ...this.couponFields(input) });
    await this.audit.record({ action: 'coupon.created', targetType: 'Coupon', targetId: code, after: this.couponSnapshot(coupon) });
    return coupon;
  }

  /** Discount terms are fixed once created (Stripe coupons can't change); limits, expiry and status can. */
  async updateCoupon(id: string, input: CouponInput) {
    const coupon = Types.ObjectId.isValid(id) ? await this.coupons.findById(id) : null;
    if (!coupon) throw new NotFoundException('Coupon not found');
    const before = this.couponSnapshot(coupon);
    const { description, maxUses, expiresAt, active, appliesToPlans } = input;
    coupon.set(this.couponFields({ description, maxUses, expiresAt, active, appliesToPlans }));
    await coupon.save();
    await this.audit.record({ action: 'coupon.updated', targetType: 'Coupon', targetId: coupon.code, before, after: this.couponSnapshot(coupon) });
    return coupon;
  }
}
