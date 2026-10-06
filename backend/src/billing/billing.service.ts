import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { AuthUser } from '../common/decorators';
import { BusinessAccessService } from '../common/business-access';
import { isVerifiedLevel, PaymentStatus, PLAN_GRANTING_STATUSES, PlanKey, SubscriptionStatus } from '../common/enums';
import { siteUrl } from '../platform/email.service';
import { NotificationsService } from '../platform/notifications.service';
import { SettingsService } from '../platform/settings.service';
import { PlanLean, PlansService } from '../plans/plans.service';
import { AuditService } from '../scraper/audit/audit.service';
import { Business, BusinessDocument } from '../schemas/business.schema';
import { Coupon, CouponDocument, Payment, PaymentDocument, StripeEvent, StripeEventDocument } from '../schemas/payment.schema';
import { Plan, PlanDocument } from '../schemas/plan.schema';
import { Subscription, SubscriptionDocument } from '../schemas/subscription.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { pence, pounds, StripeService } from './stripe.service';

export type Interval = 'monthly' | 'annual';
type CheckoutHandler = (session: Stripe.Checkout.Session) => Promise<void>;

const PERIOD_DAYS: Record<Interval, number> = { monthly: 30, annual: 365 };
const monthlyEquivalent = (plan: Pick<Plan, 'monthlyPrice' | 'annualPrice'>, interval: Interval) =>
  interval === 'annual' ? plan.annualPrice / 12 : plan.monthlyPrice;

export interface PriceBreakdown {
  amount: number;
  vat: number;
  total: number;
  vatRatePercent: number;
  inclusive: boolean;
}

/**
 * Plans for takeaways (spec "Plans, pricing and promotions" and sprint 4). Plans switch on from Stripe's
 * webhook, never from the browser redirect, so a closed tab can't leave a paid-but-inactive account.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly checkoutHandlers = new Map<string, CheckoutHandler>();

  constructor(
    @InjectModel(Plan.name) private readonly plans: Model<PlanDocument>,
    @InjectModel(Subscription.name) readonly subscriptions: Model<SubscriptionDocument>,
    @InjectModel(Payment.name) readonly payments: Model<PaymentDocument>,
    @InjectModel(Coupon.name) readonly coupons: Model<CouponDocument>,
    @InjectModel(StripeEvent.name) private readonly stripeEvents: Model<StripeEventDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    readonly stripe: StripeService,
    private readonly plansService: PlansService,
    private readonly access: BusinessAccessService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** Other modules (promotions) handle their own one-off checkouts through the same webhook. */
  registerCheckoutHandler(type: string, handler: CheckoutHandler) {
    this.checkoutHandlers.set(type, handler);
  }

  async vatFor(plan?: Pick<Plan, 'vatRatePercent'>) {
    const settings = await this.settings.get();
    return { percent: plan?.vatRatePercent ?? settings.vatRatePercent ?? 20, inclusive: !!settings.pricesIncludeVat };
  }

  async breakdown(net: number, plan?: Pick<Plan, 'vatRatePercent'>): Promise<PriceBreakdown> {
    const { percent, inclusive } = await this.vatFor(plan);
    if (inclusive) {
      const amount = Math.round((net / (1 + percent / 100)) * 100) / 100;
      return { amount, vat: Math.round((net - amount) * 100) / 100, total: net, vatRatePercent: percent, inclusive };
    }
    const vat = Math.round(net * percent) / 100;
    return { amount: net, vat, total: Math.round((net + vat) * 100) / 100, vatRatePercent: percent, inclusive };
  }

  // ---------------------------------------------------------------------------------------------------
  // Public plans (spec T4.2: /pricing reads from here)
  // ---------------------------------------------------------------------------------------------------

  async publicPlans(audience?: string) {
    const [plans, vat] = await Promise.all([this.plansService.list({ audience, publicOnly: true }), this.vatFor()]);
    return plans.map((p) => ({
      _id: p._id,
      key: p.key,
      name: p.name,
      audience: p.audience,
      monthlyPrice: p.monthlyPrice,
      annualPrice: p.annualPrice,
      trialDays: p.trialDays,
      bestFor: p.bestFor,
      limits: p.limits,
      flags: p.flags,
      features: p.features,
      autoApprove: p.autoApprove,
      badgeText: p.badgeText,
      sortOrder: p.sortOrder,
      vatRatePercent: p.vatRatePercent ?? vat.percent,
      pricesIncludeVat: vat.inclusive,
    }));
  }

  // ---------------------------------------------------------------------------------------------------
  // A business's billing page
  // ---------------------------------------------------------------------------------------------------

  async overview(businessId: string, user: AuthUser) {
    const business = await this.access.load(businessId, user, 'owner');
    const [current, sub, plans, payments, stripeEnabled] = await Promise.all([
      this.plansService.planFor(business._id),
      this.subscriptions.findOne({ businessId: business._id, status: { $in: [...PLAN_GRANTING_STATUSES, SubscriptionStatus.INCOMPLETE] } }).sort({ createdAt: -1 }).lean(),
      this.publicPlans('takeaway'),
      this.payments.find({ businessId: business._id }).sort({ createdAt: -1 }).limit(50).lean(),
      this.stripe.enabled(),
    ]);
    return {
      business: { _id: business._id, name: business.name, verificationLevel: business.verificationLevel, hasStripeCustomer: !!business.stripeCustomerId },
      canBuy: isVerifiedLevel(business.verificationLevel),
      plan: { key: current.key, name: current.name, limits: current.limits, flags: current.flags, monthlyPrice: current.monthlyPrice, annualPrice: current.annualPrice },
      subscription: sub,
      plans,
      payments,
      stripeEnabled,
    };
  }

  async validateCoupon(code: string | undefined, planKey: string) {
    if (!code) return null;
    const coupon = await this.coupons.findOne({ code: code.trim().toUpperCase() });
    if (!coupon || !coupon.active) throw new BadRequestException('That discount code is not valid');
    if (coupon.expiresAt && coupon.expiresAt < new Date()) throw new BadRequestException('That discount code has expired');
    if (coupon.maxUses && coupon.timesUsed >= coupon.maxUses) throw new BadRequestException('That discount code has been used up');
    if (coupon.appliesToPlans.length && !coupon.appliesToPlans.includes(planKey)) throw new BadRequestException('That discount code is for a different plan');
    return coupon;
  }

  async previewCoupon(code: string, planKey: string, interval: Interval) {
    const coupon = await this.validateCoupon(code, planKey);
    const plan = await this.plansService.byKey(planKey);
    if (!coupon || !plan) throw new NotFoundException('Plan not found');
    const price = interval === 'annual' ? plan.annualPrice : plan.monthlyPrice;
    const discounted = this.applyCoupon(price, coupon);
    return {
      code: coupon.code,
      description: coupon.description,
      percentOff: coupon.percentOff,
      amountOff: coupon.amountOff,
      duration: coupon.duration,
      durationInMonths: coupon.durationInMonths,
      firstPayment: await this.breakdown(discounted, plan),
    };
  }

  private applyCoupon(price: number, coupon: Pick<Coupon, 'percentOff' | 'amountOff'> | null) {
    if (!coupon) return price;
    if (coupon.percentOff) return Math.max(0, Math.round(price * (100 - coupon.percentOff)) / 100);
    return Math.max(0, Math.round((price - (coupon.amountOff ?? 0)) * 100) / 100);
  }

  private async purchasablePlan(planKey: string) {
    const plan = await this.plans.findOne({ key: planKey });
    if (!plan || plan.audience !== 'takeaway') throw new NotFoundException('Plan not found');
    if (plan.archived || !plan.isPublic) throw new BadRequestException('That plan is not available');
    return plan;
  }

  /**
   * Spec T4.3: Stripe Checkout, monthly or yearly, with coupons and VAT. Only verified (level 2) businesses can
   * buy. A business already on a paid plan changes plan instead.
   */
  async checkout(businessId: string, input: { planKey: string; interval: Interval; couponCode?: string }, user: AuthUser) {
    const business = await this.access.load(businessId, user, 'owner', { write: true });
    if (!isVerifiedLevel(business.verificationLevel)) {
      throw new ForbiddenException({ message: 'Plans can be bought once your business is verified.', code: 'not_verified' });
    }
    const plan = await this.purchasablePlan(input.planKey);
    if (plan.monthlyPrice <= 0) throw new BadRequestException('The Free plan needs no checkout');
    const active = await this.plansService.activeSubscription(business._id);
    if (active && active.price > 0 && !active.comp) return this.changePlan(businessId, { planKey: input.planKey, interval: input.interval }, user);
    const coupon = await this.validateCoupon(input.couponCode, plan.key);
    const price = input.interval === 'annual' ? plan.annualPrice : plan.monthlyPrice;

    const stripe = await this.stripe.client();
    if (stripe) {
      const synced = await this.stripe.syncPlan(plan);
      const priceId = input.interval === 'annual' ? synced.stripe.annualPriceId : synced.stripe.monthlyPriceId;
      if (!priceId) throw new BadRequestException('This plan has no Stripe price yet; ask an admin to save it again');
      const vat = await this.vatFor(plan);
      const taxRate = await this.stripe.taxRate(vat.percent, vat.inclusive);
      const customer = await this.stripe.customerFor(business, user.email);
      const couponId = coupon ? await this.stripe.couponId(coupon) : undefined;
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer,
        line_items: [{ price: priceId, quantity: 1, ...(taxRate ? { tax_rates: [taxRate] } : {}) }],
        ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
        subscription_data: {
          ...(plan.trialDays > 0 ? { trial_period_days: plan.trialDays } : {}),
          metadata: { businessId: String(business._id), planKey: plan.key, interval: input.interval },
        },
        metadata: {
          type: 'subscription',
          businessId: String(business._id),
          planKey: plan.key,
          interval: input.interval,
          userId: user.userId,
          couponCode: coupon?.code ?? '',
        },
        success_url: siteUrl('/dashboard/billing?checkout=success'),
        cancel_url: siteUrl('/dashboard/billing?checkout=cancelled'),
      });
      await this.audit.record({ action: 'billing.checkout_started', targetType: 'Business', targetId: business._id, after: { plan: plan.key, interval: input.interval, coupon: coupon?.code } });
      return { mode: 'stripe', url: session.url };
    }

    // Mock mode: what the webhook would do.
    const sub = await this.activate({
      businessId: business._id,
      userId: user.userId,
      planKey: plan.key,
      interval: input.interval,
      price,
      couponCode: coupon?.code,
      trialDays: plan.trialDays,
    });
    const firstCharge = this.applyCoupon(price, coupon);
    if (!plan.trialDays) await this.recordMockPayment(business._id, sub, `${plan.name} plan (${input.interval})`, firstCharge, plan, coupon?.code);
    return { mode: 'mock', subscription: sub };
  }

  /** One active plan per business: the new subscription replaces any other. */
  async activate(input: {
    businessId: Types.ObjectId;
    userId: string;
    planKey: string;
    interval: Interval;
    price: number;
    couponCode?: string;
    trialDays?: number;
    stripeSubscriptionId?: string;
    stripeCustomerId?: string;
    stripeCheckoutSessionId?: string;
    status?: SubscriptionStatus;
    currentPeriodEnd?: Date;
    comp?: boolean;
    compNote?: string;
  }) {
    const others = await this.subscriptions.find({ businessId: input.businessId, status: { $in: [...PLAN_GRANTING_STATUSES, SubscriptionStatus.INCOMPLETE] } });
    for (const other of others) {
      if (input.stripeSubscriptionId && other.stripeSubscriptionId === input.stripeSubscriptionId) continue;
      const stripe = await this.stripe.client();
      if (stripe && other.stripeSubscriptionId) {
        await stripe.subscriptions.cancel(other.stripeSubscriptionId).catch((err) => this.stripe.logError('Cancel replaced subscription', err));
      }
      other.set({ status: SubscriptionStatus.CANCELLED, cancelledAt: new Date() });
      await other.save();
    }
    const trialEnds = input.trialDays ? new Date(Date.now() + input.trialDays * 24 * 3600_000) : undefined;
    const existing = input.stripeSubscriptionId ? await this.subscriptions.findOne({ stripeSubscriptionId: input.stripeSubscriptionId }) : null;
    const fields = {
      businessId: input.businessId,
      userId: new Types.ObjectId(input.userId),
      planKey: input.planKey,
      interval: input.interval,
      price: input.price,
      status: input.status ?? (trialEnds ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE),
      stripeSubscriptionId: input.stripeSubscriptionId,
      stripeCustomerId: input.stripeCustomerId,
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
      currentPeriodEnd: input.currentPeriodEnd ?? trialEnds ?? new Date(Date.now() + PERIOD_DAYS[input.interval] * 24 * 3600_000),
      trialEndsAt: trialEnds,
      couponCode: input.couponCode,
      comp: !!input.comp,
      compNote: input.compNote,
      cancelAtPeriodEnd: false,
      pendingPlanKey: undefined,
      pastDueSince: undefined,
      reminderCount: 0,
    };
    const sub = existing ? Object.assign(existing, fields) : new this.subscriptions(fields);
    await sub.save();
    if (input.couponCode) await this.coupons.updateOne({ code: input.couponCode }, { $inc: { timesUsed: 1 } });
    const plan = await this.plansService.byKey(input.planKey);
    const business = await this.businesses.findById(input.businessId).select('name').lean();
    await this.audit.record({ action: input.comp ? 'billing.comp_plan_given' : 'billing.subscription_started', targetType: 'Business', targetId: input.businessId, after: { plan: input.planKey, interval: input.interval, price: input.price, stripe: !!input.stripeSubscriptionId } });
    await this.notifications.notifyBusiness(input.businessId, {
      type: 'subscription_started',
      title: `You're on the ${plan?.name ?? input.planKey} plan`,
      link: '/dashboard/billing',
      email: { template: 'subscription_started', vars: { businessName: business?.name, planName: plan?.name ?? input.planKey, link: siteUrl('/dashboard/billing') } },
    }, 'owners');
    return sub;
  }

  async recordMockPayment(businessId: Types.ObjectId, sub: SubscriptionDocument | null, description: string, net: number, plan?: Pick<Plan, 'vatRatePercent'>, couponCode?: string, promotionId?: Types.ObjectId) {
    const totals = await this.breakdown(net, plan);
    return this.payments.create({
      businessId,
      subscriptionId: sub?._id,
      promotionId,
      kind: promotionId ? 'promotion' : 'subscription',
      description,
      amount: totals.amount,
      vat: totals.vat,
      total: totals.total,
      status: PaymentStatus.PAID,
      paidAt: new Date(),
      number: await this.nextInvoiceNumber(),
      periodStart: sub ? new Date() : undefined,
      periodEnd: sub?.currentPeriodEnd,
      mock: true,
      couponCode,
    });
  }

  private async nextInvoiceNumber() {
    const year = new Date().getUTCFullYear();
    const count = await this.payments.countDocuments({ number: new RegExp(`^TO-${year}-`) });
    return `TO-${year}-${String(count + 1).padStart(6, '0')}`;
  }

  /**
   * Spec T4.4: upgrade now, downgrade at the end of the period. Moving to Free is a cancellation at period end.
   */
  async changePlan(businessId: string, input: { planKey: string; interval: Interval }, user: AuthUser) {
    const business = await this.access.load(businessId, user, 'owner', { write: true });
    const sub = await this.plansService.activeSubscription(business._id);
    if (input.planKey === PlanKey.FREE) return this.cancel(businessId, user);
    if (!sub || sub.price <= 0 || sub.comp) return this.checkout(businessId, input, user);
    const plan = await this.purchasablePlan(input.planKey);
    const current = await this.plansService.byKey(sub.planKey);
    if (plan.key === sub.planKey && input.interval === sub.interval) {
      // Undo a pending downgrade or cancellation by "choosing" the current plan again.
      return this.resume(businessId, user);
    }
    const newPrice = input.interval === 'annual' ? plan.annualPrice : plan.monthlyPrice;
    const upgrade = !current || monthlyEquivalent(plan, input.interval) >= monthlyEquivalent(current, sub.interval as Interval);
    const stripe = await this.stripe.client();
    if (stripe && sub.stripeSubscriptionId) {
      const synced = await this.stripe.syncPlan(plan);
      const priceId = input.interval === 'annual' ? synced.stripe.annualPriceId : synced.stripe.monthlyPriceId;
      const remote = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
      await stripe.subscriptions.update(sub.stripeSubscriptionId, {
        items: [{ id: remote.items.data[0].id, price: priceId }],
        // Upgrades are charged the difference now; downgrades take the new price from the next renewal.
        proration_behavior: upgrade ? 'always_invoice' : 'none',
        cancel_at_period_end: false,
        metadata: { businessId: String(business._id), planKey: upgrade ? plan.key : sub.planKey, pendingPlanKey: upgrade ? '' : plan.key, interval: input.interval },
      });
    }
    const before = { planKey: sub.planKey, interval: sub.interval, price: sub.price };
    if (upgrade) {
      sub.set({ planKey: plan.key, interval: input.interval, price: newPrice, pendingPlanKey: undefined, pendingInterval: undefined, cancelAtPeriodEnd: false });
      if (!stripe) await this.recordMockPayment(business._id, sub, `Upgrade to ${plan.name} (${input.interval})`, Math.max(0, newPrice - sub.price), plan);
    } else {
      sub.set({ pendingPlanKey: plan.key, pendingInterval: input.interval, cancelAtPeriodEnd: false });
    }
    await sub.save();
    await this.audit.record({ action: upgrade ? 'billing.upgraded' : 'billing.downgrade_scheduled', targetType: 'Business', targetId: business._id, before, after: { planKey: plan.key, interval: input.interval, price: newPrice, at: upgrade ? 'now' : sub.currentPeriodEnd } });
    return { mode: stripe ? 'stripe' : 'mock', subscription: sub, effective: upgrade ? 'now' : 'period_end' };
  }

  async cancel(businessId: string, user: AuthUser) {
    const business = await this.access.load(businessId, user, 'owner', { write: true });
    const sub = await this.plansService.activeSubscription(business._id);
    if (!sub) throw new BadRequestException('You are on the Free plan');
    const stripe = await this.stripe.client();
    if (stripe && sub.stripeSubscriptionId) {
      await stripe.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: true });
    }
    sub.set({ cancelAtPeriodEnd: true, pendingPlanKey: undefined, pendingInterval: undefined });
    await sub.save();
    await this.audit.record({ action: 'billing.cancel_scheduled', targetType: 'Business', targetId: business._id, after: { planKey: sub.planKey, endsAt: sub.currentPeriodEnd } });
    return { subscription: sub, effective: 'period_end' };
  }

  async resume(businessId: string, user: AuthUser) {
    const business = await this.access.load(businessId, user, 'owner', { write: true });
    const sub = await this.plansService.activeSubscription(business._id);
    if (!sub) throw new BadRequestException('There is no plan to keep');
    const stripe = await this.stripe.client();
    if (stripe && sub.stripeSubscriptionId) {
      if (sub.pendingPlanKey) {
        // Put the current plan's price back.
        const plan = await this.plans.findOne({ key: sub.planKey });
        const synced = plan ? await this.stripe.syncPlan(plan) : null;
        const priceId = sub.interval === 'annual' ? synced?.stripe.annualPriceId : synced?.stripe.monthlyPriceId;
        const remote = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
        if (priceId) await stripe.subscriptions.update(sub.stripeSubscriptionId, { items: [{ id: remote.items.data[0].id, price: priceId }], proration_behavior: 'none', metadata: { pendingPlanKey: '' } });
      }
      await stripe.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: false });
    }
    sub.set({ cancelAtPeriodEnd: false, pendingPlanKey: undefined, pendingInterval: undefined });
    await sub.save();
    await this.audit.record({ action: 'billing.resumed', targetType: 'Business', targetId: business._id, after: { planKey: sub.planKey } });
    return { subscription: sub };
  }

  /** Card updates and Stripe's own invoice list, through the Stripe customer portal. */
  async portal(businessId: string, user: AuthUser) {
    const business = await this.access.load(businessId, user, 'owner');
    const stripe = await this.stripe.client();
    if (!stripe) throw new BadRequestException('Card payments are not set up yet (demo mode)');
    if (!business.stripeCustomerId) throw new BadRequestException('There is no card on file yet');
    const session = await stripe.billingPortal.sessions.create({ customer: business.stripeCustomerId, return_url: siteUrl('/dashboard/billing') });
    return { url: session.url };
  }

  async invoice(businessId: string, paymentId: string, user: AuthUser) {
    const business = await this.access.load(businessId, user, 'owner');
    const payment = Types.ObjectId.isValid(paymentId) ? await this.payments.findOne({ _id: paymentId, businessId: business._id }).lean() : null;
    if (!payment) throw new NotFoundException('Invoice not found');
    const settings = await this.settings.get();
    return {
      payment,
      business: { name: business.name, address: business.address, town: business.town, postcode: business.postcode },
      seller: { name: settings.siteName, email: settings.contactEmail, address: settings.contactAddress },
    };
  }

  // ---------------------------------------------------------------------------------------------------
  // Stripe webhook (the source of truth)
  // ---------------------------------------------------------------------------------------------------

  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
    const stripe = await this.stripe.client();
    if (!stripe) throw new BadRequestException('Stripe not configured');
    const secret = await this.stripe.webhookSecret();
    if (!secret) throw new BadRequestException('Stripe webhook secret not configured');
    if (!rawBody || !signature) throw new BadRequestException('Missing webhook payload/signature');

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      this.logger.warn(`Webhook signature verification failed: ${(err as Error).message}`);
      throw new BadRequestException('Invalid webhook signature');
    }
    // Stripe retries and may send an event twice: process each once.
    const fresh = await this.stripeEvents.create({ eventId: event.id, type: event.type }).then(() => true).catch(() => false);
    if (!fresh) return { received: true, duplicate: true };
    try {
      await this.processEvent(event, stripe);
    } catch (err) {
      // Let Stripe retry: forget the event so the retry is processed.
      await this.stripeEvents.deleteOne({ eventId: event.id });
      throw err;
    }
    return { received: true };
  }

  async processEvent(event: Stripe.Event, stripe: Stripe) {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const meta = session.metadata || {};
        if (meta.type === 'subscription' && session.subscription) {
          const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
          const remote = await stripe.subscriptions.retrieve(subId);
          const plan = await this.plansService.byKey(meta.planKey);
          const interval = (meta.interval as Interval) || 'monthly';
          await this.activate({
            businessId: new Types.ObjectId(meta.businessId),
            userId: meta.userId,
            planKey: meta.planKey,
            interval,
            price: plan ? (interval === 'annual' ? plan.annualPrice : plan.monthlyPrice) : pounds(session.amount_subtotal),
            couponCode: meta.couponCode || undefined,
            stripeSubscriptionId: subId,
            stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
            stripeCheckoutSessionId: session.id,
            status: this.mapStatus(remote.status),
            currentPeriodEnd: StripeService.periodEnd(remote),
          });
        } else if (meta.type && this.checkoutHandlers.has(meta.type)) {
          await this.checkoutHandlers.get(meta.type)!(session);
        } else if (meta.type === 'subscription' && meta.supplierId) {
          this.logger.log(`Supplier checkout completed for ${meta.supplierId}`);
        }
        break;
      }
      case 'customer.subscription.updated': {
        const remote = event.data.object;
        const sub = await this.subscriptions.findOne({ stripeSubscriptionId: remote.id });
        if (!sub) break;
        const mapped = await this.stripe.planForPrice(remote.items.data[0]?.price?.id);
        const set: Record<string, unknown> = {
          status: this.mapStatus(remote.status),
          cancelAtPeriodEnd: remote.cancel_at_period_end,
          currentPeriodEnd: StripeService.periodEnd(remote) ?? sub.currentPeriodEnd,
        };
        // A pending downgrade already carries the new price; the plan itself changes at the period end.
        if (mapped && mapped.key !== sub.planKey && mapped.key !== sub.pendingPlanKey) {
          const plan = await this.plansService.byKey(mapped.key);
          Object.assign(set, { planKey: mapped.key, interval: mapped.interval, price: plan ? (mapped.interval === 'annual' ? plan.annualPrice : plan.monthlyPrice) : sub.price });
        }
        sub.set(set);
        await sub.save();
        break;
      }
      case 'customer.subscription.deleted': {
        const remote = event.data.object;
        const sub = await this.subscriptions.findOne({ stripeSubscriptionId: remote.id, status: { $ne: SubscriptionStatus.CANCELLED } });
        if (sub) await this.endSubscription(sub, 'Stripe subscription ended');
        break;
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await this.mirrorInvoice(invoice, event.type === 'invoice.paid');
        break;
      }
      case 'charge.refunded': {
        const charge = event.data.object;
        const intent = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
        const payment = await this.payments.findOne({ $or: [{ stripeChargeId: charge.id }, ...(intent ? [{ stripePaymentIntentId: intent }] : [])] });
        if (payment) {
          const refunded = pounds(charge.amount_refunded);
          payment.set({ refundedAmount: refunded, status: refunded >= payment.total ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED });
          await payment.save();
        }
        break;
      }
      default:
        break;
    }
  }

  mapStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
    switch (status) {
      case 'trialing':
        return SubscriptionStatus.TRIALING;
      case 'past_due':
      case 'unpaid':
        return SubscriptionStatus.PAST_DUE;
      case 'canceled':
      case 'incomplete_expired':
        return SubscriptionStatus.CANCELLED;
      case 'incomplete':
        return SubscriptionStatus.INCOMPLETE;
      default:
        return SubscriptionStatus.ACTIVE;
    }
  }

  private async mirrorInvoice(invoice: Stripe.Invoice, paid: boolean) {
    const subId = StripeService.subscriptionOfInvoice(invoice);
    const sub = subId ? await this.subscriptions.findOne({ stripeSubscriptionId: subId }) : null;
    const businessId = sub?.businessId ?? (invoice.metadata?.businessId ? new Types.ObjectId(invoice.metadata.businessId) : undefined);
    if (!businessId) return;
    const total = pounds(invoice.total);
    const vat = pounds((invoice.total_taxes ?? []).reduce((sum, t) => sum + (t.amount ?? 0), 0));
    const existing = await this.payments.findOne({ stripeInvoiceId: invoice.id });
    const fields = {
      businessId,
      subscriptionId: sub?._id,
      kind: 'subscription',
      description: invoice.lines?.data?.[0]?.description ?? `TruOffers ${sub?.planKey ?? ''} plan`,
      amount: Math.round((total - vat) * 100) / 100,
      vat,
      total,
      status: paid ? PaymentStatus.PAID : PaymentStatus.FAILED,
      number: invoice.number ?? existing?.number ?? (await this.nextInvoiceNumber()),
      stripeInvoiceId: invoice.id,
      pdfUrl: invoice.invoice_pdf ?? undefined,
      hostedUrl: invoice.hosted_invoice_url ?? undefined,
      periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : undefined,
      periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : undefined,
      paidAt: paid ? new Date() : undefined,
    };
    const payment = existing ? Object.assign(existing, fields) : new this.payments(fields);
    if (paid && !payment.stripePaymentIntentId && invoice.id) {
      payment.stripePaymentIntentId = await this.stripe.paymentIntentForInvoice(invoice.id).catch(() => undefined);
    }
    await payment.save();
    if (!sub) return;
    if (paid && sub.status === SubscriptionStatus.PAST_DUE) {
      sub.set({ status: SubscriptionStatus.ACTIVE, pastDueSince: undefined, reminderCount: 0, lastReminderAt: undefined });
      await sub.save();
    } else if (!paid) {
      const first = !sub.pastDueSince;
      sub.set({ status: SubscriptionStatus.PAST_DUE, pastDueSince: sub.pastDueSince ?? new Date() });
      if (first) {
        sub.set({ reminderCount: 1, lastReminderAt: new Date() });
        await this.sendPaymentReminder(sub, 1);
      }
      await sub.save();
    }
  }

  async sendPaymentReminder(sub: SubscriptionDocument, attempt: number) {
    const business = await this.businesses.findById(sub.businessId).select('name').lean();
    const plan = await this.plansService.byKey(sub.planKey);
    const downgradeOn = new Date((sub.pastDueSince ?? new Date()).getTime() + 14 * 24 * 3600_000).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' });
    await this.notifications.notifyBusiness(sub.businessId!, {
      type: 'payment_failed',
      title: 'Payment failed: please update your card',
      body: `Your ${plan?.name ?? sub.planKey} plan moves to Free on ${downgradeOn} if payment still fails.`,
      link: '/dashboard/billing',
      email: { template: 'payment_failed', vars: { businessName: business?.name, planName: plan?.name ?? sub.planKey, attempt: String(attempt), downgradeOn, link: siteUrl('/dashboard/billing') } },
    }, 'owners');
  }

  /** The plan ends: the business is on Free from now on. */
  async endSubscription(sub: SubscriptionDocument, reason: string) {
    const before = { planKey: sub.planKey, status: sub.status };
    sub.set({ status: SubscriptionStatus.CANCELLED, cancelledAt: new Date() });
    await sub.save();
    await this.audit.record({ action: 'billing.subscription_ended', targetType: 'Business', targetId: sub.businessId, before, after: { status: sub.status }, note: reason });
    if (!sub.businessId) return;
    const business = await this.businesses.findById(sub.businessId).select('name').lean();
    await this.notifications.notifyBusiness(sub.businessId, {
      type: 'plan_downgraded',
      title: 'You are on the Free plan',
      body: reason,
      link: '/dashboard/billing',
      email: { template: 'plan_downgraded', vars: { businessName: business?.name, link: siteUrl('/dashboard/billing') } },
    }, 'owners');
  }

  /** One-off Stripe Checkout for something other than a plan (promotions). */
  async oneOffCheckout(input: {
    business: BusinessDocument;
    email: string;
    description: string;
    net: number;
    metadata: Record<string, string>;
    successPath: string;
    cancelPath: string;
  }) {
    const stripe = await this.stripe.client();
    if (!stripe) return null;
    const vat = await this.vatFor();
    const taxRate = await this.stripe.taxRate(vat.percent, vat.inclusive);
    const customer = await this.stripe.customerFor(input.business, input.email);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer,
      line_items: [
        {
          quantity: 1,
          price_data: { currency: 'gbp', unit_amount: pence(input.net), product_data: { name: input.description } },
          ...(taxRate ? { tax_rates: [taxRate] } : {}),
        },
      ],
      invoice_creation: { enabled: true, invoice_data: { metadata: { businessId: String(input.business._id) } } },
      metadata: input.metadata,
      payment_intent_data: { metadata: input.metadata },
      success_url: siteUrl(input.successPath),
      cancel_url: siteUrl(input.cancelPath),
    });
    return session;
  }

  /** Records a paid one-off checkout (promotion) as a payment. */
  async recordCheckoutPayment(session: Stripe.Checkout.Session, kind: string, description: string, businessId: Types.ObjectId, promotionId?: Types.ObjectId) {
    const total = pounds(session.amount_total);
    const vat = pounds(session.total_details?.amount_tax ?? 0);
    const intent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    const invoiceId = typeof session.invoice === 'string' ? session.invoice : session.invoice?.id;
    let pdfUrl: string | undefined;
    let hostedUrl: string | undefined;
    let number: string | undefined;
    const stripe = await this.stripe.client();
    if (stripe && invoiceId) {
      const invoice = await stripe.invoices.retrieve(invoiceId).catch(() => null);
      pdfUrl = invoice?.invoice_pdf ?? undefined;
      hostedUrl = invoice?.hosted_invoice_url ?? undefined;
      number = invoice?.number ?? undefined;
    }
    return this.payments.findOneAndUpdate(
      { stripeCheckoutSessionId: session.id },
      {
        $setOnInsert: {
          businessId,
          promotionId,
          kind,
          description,
          amount: Math.round((total - vat) * 100) / 100,
          vat,
          total,
          status: PaymentStatus.PAID,
          paidAt: new Date(),
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: intent,
          stripeInvoiceId: invoiceId,
          pdfUrl,
          hostedUrl,
          number: number ?? (await this.nextInvoiceNumber()),
        },
      },
      { upsert: true, new: true },
    );
  }

  // Older clients and supplier plans
  mySubscriptions(userId: string) {
    return this.subscriptions.find({ userId: new Types.ObjectId(userId) }).sort({ createdAt: -1 }).populate('businessId', 'name slug').lean();
  }

  planLean(key: string): Promise<PlanLean | null> {
    return this.plansService.byKey(key);
  }
}
