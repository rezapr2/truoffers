import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Stripe from 'stripe';
import { SettingsService } from '../platform/settings.service';
import { Coupon, CouponDocument } from '../schemas/payment.schema';
import { Plan, PlanDocument } from '../schemas/plan.schema';
import { Business, BusinessDocument } from '../schemas/business.schema';

export const pence = (pounds: number) => Math.round(pounds * 100);
export const pounds = (amount: number | null | undefined) => Math.round(amount ?? 0) / 100;

/**
 * Stripe, configured from admin settings (or STRIPE_SECRET_KEY). Without a key every billing flow runs in mock
 * mode: plans and promotions switch on directly and mock invoices are recorded.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private cached: { key: string; client: Stripe } | null = null;
  private readonly taxRates = new Map<string, string>();

  constructor(
    private readonly settings: SettingsService,
    @InjectModel(Plan.name) private readonly plans: Model<PlanDocument>,
    @InjectModel(Coupon.name) private readonly coupons: Model<CouponDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
  ) {}

  async client(): Promise<Stripe | null> {
    if (process.env.NODE_ENV === 'test' && !process.env.STRIPE_TEST_ALLOW) return null;
    const key = await this.settings.secret('stripeSecretKey');
    if (!key) return null;
    if (this.cached?.key !== key) this.cached = { key, client: new Stripe(key) };
    return this.cached.client;
  }

  async enabled(): Promise<boolean> {
    return (await this.client()) !== null;
  }

  async webhookSecret(): Promise<string | undefined> {
    return this.settings.secret('stripeWebhookSecret');
  }

  async customerFor(business: BusinessDocument, email: string): Promise<string> {
    const stripe = (await this.client())!;
    if (business.stripeCustomerId) return business.stripeCustomerId;
    const customer = await stripe.customers.create({
      name: business.name,
      email,
      address: business.postcode ? { postal_code: business.postcode, country: 'GB', line1: business.address ?? undefined, city: business.town ?? undefined } : undefined,
      metadata: { businessId: String(business._id), slug: business.slug },
    });
    business.stripeCustomerId = customer.id;
    await this.businesses.updateOne({ _id: business._id }, { $set: { stripeCustomerId: customer.id } });
    return customer.id;
  }

  /**
   * Stripe prices can't change, so a new price amount gets a new Stripe price and the old one is archived.
   * Existing subscriptions keep the old price unless the admin migrates them.
   */
  async syncPlan(plan: PlanDocument): Promise<PlanDocument> {
    const stripe = await this.client();
    if (!stripe || plan.monthlyPrice <= 0) return plan;
    let productId = plan.stripe?.productId;
    if (!productId) {
      const product = await stripe.products.create({ name: `TruOffers ${plan.name}`, metadata: { planKey: plan.key } });
      productId = product.id;
    } else {
      await stripe.products.update(productId, { name: `TruOffers ${plan.name}`, active: !plan.archived });
    }
    const intervals: Array<['monthly' | 'annual', number]> = [
      ['monthly', pence(plan.monthlyPrice)],
      ['annual', pence(plan.annualPrice)],
    ];
    const next = { ...(plan.stripe ?? {}), productId };
    for (const [interval, amount] of intervals) {
      const idKey = interval === 'monthly' ? 'monthlyPriceId' : 'annualPriceId';
      const amountKey = interval === 'monthly' ? 'monthlyAmount' : 'annualAmount';
      if (amount <= 0) continue;
      if (next[idKey] && next[amountKey] === amount) continue;
      const price = await stripe.prices.create({
        product: productId,
        currency: 'gbp',
        unit_amount: amount,
        recurring: { interval: interval === 'monthly' ? 'month' : 'year' },
        metadata: { planKey: plan.key, interval },
      });
      if (next[idKey]) await stripe.prices.update(next[idKey]!, { active: false }).catch(() => undefined);
      next[idKey] = price.id;
      next[amountKey] = amount;
    }
    plan.set('stripe', { ...next, syncedAt: new Date() });
    await plan.save();
    return plan;
  }

  /** The plan key and interval a Stripe price belongs to (subscriptions changed in the Stripe portal). */
  async planForPrice(priceId: string | undefined): Promise<{ key: string; interval: string } | null> {
    if (!priceId) return null;
    const plan = await this.plans.findOne({ $or: [{ 'stripe.monthlyPriceId': priceId }, { 'stripe.annualPriceId': priceId }] }).lean();
    if (!plan) return null;
    return { key: plan.key, interval: plan.stripe?.annualPriceId === priceId ? 'annual' : 'monthly' };
  }

  /** A UK VAT tax rate for checkout, created once per percentage. */
  async taxRate(percent: number, inclusive: boolean): Promise<string | undefined> {
    const stripe = await this.client();
    if (!stripe || percent <= 0) return undefined;
    const cacheKey = `${percent}:${inclusive}`;
    const cached = this.taxRates.get(cacheKey);
    if (cached) return cached;
    const existing = await stripe.taxRates.list({ active: true, limit: 100 });
    const match = existing.data.find((r) => r.percentage === percent && r.inclusive === inclusive && r.country === 'GB' && r.display_name === 'VAT');
    const id = match?.id ?? (await stripe.taxRates.create({ display_name: 'VAT', percentage: percent, inclusive, country: 'GB', jurisdiction: 'GB', description: 'UK VAT' })).id;
    this.taxRates.set(cacheKey, id);
    return id;
  }

  async couponId(coupon: CouponDocument): Promise<string | undefined> {
    const stripe = await this.client();
    if (!stripe) return undefined;
    if (coupon.stripeCouponId) return coupon.stripeCouponId;
    const created = await stripe.coupons.create({
      name: coupon.code,
      ...(coupon.percentOff ? { percent_off: coupon.percentOff } : { amount_off: pence(coupon.amountOff ?? 0), currency: 'gbp' }),
      duration: coupon.duration as Stripe.CouponCreateParams.Duration,
      ...(coupon.duration === 'repeating' ? { duration_in_months: coupon.durationInMonths ?? 1 } : {}),
      metadata: { code: coupon.code },
    });
    coupon.stripeCouponId = created.id;
    await this.coupons.updateOne({ _id: coupon._id }, { $set: { stripeCouponId: created.id } });
    return created.id;
  }

  /** The PaymentIntent behind an invoice, for refunds (API versions since 2025 list it under invoice payments). */
  async paymentIntentForInvoice(invoiceId: string): Promise<string | undefined> {
    const stripe = await this.client();
    if (!stripe) return undefined;
    const payments = await stripe.invoicePayments.list({ invoice: invoiceId, limit: 5 });
    const paid = payments.data.find((p) => p.status === 'paid') ?? payments.data[0];
    const intent = paid?.payment?.payment_intent;
    return typeof intent === 'string' ? intent : intent?.id;
  }

  /** current_period_end lives on subscription items in current Stripe API versions. */
  static periodEnd(subscription: Stripe.Subscription): Date | undefined {
    const ends = subscription.items?.data?.map((item) => item.current_period_end).filter(Boolean) as number[];
    return ends?.length ? new Date(Math.min(...ends) * 1000) : undefined;
  }

  static subscriptionOfInvoice(invoice: Stripe.Invoice): string | undefined {
    const sub = invoice.parent?.subscription_details?.subscription ?? (invoice as unknown as { subscription?: string | { id: string } }).subscription;
    return typeof sub === 'string' ? sub : sub?.id;
  }

  logError(context: string, err: unknown) {
    this.logger.warn(`${context}: ${(err as Error).message}`);
  }
}
