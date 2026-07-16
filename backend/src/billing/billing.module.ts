import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { IsEnum, IsIn, IsMongoId, IsOptional } from 'class-validator';
import type { Request } from 'express';
import Stripe from 'stripe';
import { Plan, PlanDocument, PlanSchema } from '../schemas/plan.schema';
import {
  Subscription,
  SubscriptionDocument,
  SubscriptionSchema,
} from '../schemas/subscription.schema';
import { Business, BusinessDocument, BusinessSchema } from '../schemas/business.schema';
import { Wallet, WalletDocument, WalletSchema } from '../schemas/wallet.schema';
import {
  WalletTransaction,
  WalletTransactionDocument,
  WalletTransactionSchema,
} from '../schemas/wallet-transaction.schema';
import { CurrentUser, Public } from '../common/decorators';
import { PlanKey, Role, SubscriptionStatus } from '../common/enums';

export class CheckoutDto {
  @IsEnum(PlanKey)
  planKey: PlanKey;

  @IsIn(['monthly', 'annual'])
  interval: 'monthly' | 'annual';

  @IsOptional()
  @IsMongoId()
  businessId?: string;

  @IsOptional()
  @IsMongoId()
  supplierId?: string;
}

// Billing is Stripe-ready: when STRIPE_SECRET_KEY is set, checkout creates a
// Stripe Checkout Session and the webhook activates the plan. Without a key
// (dev/MVP demo) it activates the subscription directly (mock mode).
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe: Stripe | null;

  constructor(
    @InjectModel(Plan.name) private planModel: Model<PlanDocument>,
    @InjectModel(Subscription.name) private subModel: Model<SubscriptionDocument>,
    @InjectModel(Business.name) private businessModel: Model<BusinessDocument>,
    @InjectModel(Wallet.name) private walletModel: Model<WalletDocument>,
    @InjectModel(WalletTransaction.name)
    private walletTxModel: Model<WalletTransactionDocument>,
  ) {
    const key = process.env.STRIPE_SECRET_KEY;
    this.stripe = key ? new Stripe(key) : null;
  }

  get stripeEnabled() {
    return this.stripe !== null;
  }

  listPlans(audience?: string) {
    const filter: any = {};
    if (audience) filter.audience = audience;
    return this.planModel.find(filter).sort({ sortOrder: 1 });
  }

  async checkout(dto: CheckoutDto, user: { userId: string; role: Role }) {
    const plan = await this.planModel.findOne({ key: dto.planKey });
    if (!plan) throw new NotFoundException('Plan not found');
    if (plan.monthlyPrice === 0) throw new BadRequestException('Free plan needs no checkout');

    if (dto.businessId) {
      const business = await this.businessModel.findById(dto.businessId);
      if (!business) throw new NotFoundException('Business not found');
      const isAdmin = [Role.SUPER_ADMIN, Role.SALES_ADMIN].includes(user.role);
      if (!isAdmin && String(business.ownerId) !== user.userId) {
        throw new ForbiddenException('You do not manage this business');
      }
    }

    const price = dto.interval === 'annual' ? plan.annualPrice : plan.monthlyPrice;

    if (this.stripe) {
      // Production path: Stripe Checkout Session; the webhook activates the plan.
      const frontend = process.env.FRONTEND_URL?.split(',')[0] || 'http://localhost:3000';
      const session = await this.stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'gbp',
              unit_amount: Math.round(price * 100),
              recurring: { interval: dto.interval === 'annual' ? 'year' : 'month' },
              product_data: { name: `TruOffers ${plan.name} (${dto.interval})` },
            },
          },
        ],
        metadata: {
          type: 'subscription',
          planKey: dto.planKey,
          interval: dto.interval,
          userId: user.userId,
          businessId: dto.businessId || '',
          supplierId: dto.supplierId || '',
        },
        success_url: `${frontend}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontend}/dashboard?checkout=cancelled`,
      });
      return { mode: 'stripe', url: session.url };
    }

    // Mock mode: activate directly
    const sub = await this.activateSubscription({
      userId: user.userId,
      businessId: dto.businessId,
      supplierId: dto.supplierId,
      planKey: dto.planKey,
      interval: dto.interval,
      price,
    });
    return { mode: 'mock', subscription: sub };
  }

  /** Cancel any existing active sub for the entity, then activate the new one. */
  async activateSubscription(params: {
    userId: string;
    businessId?: string;
    supplierId?: string;
    planKey: PlanKey;
    interval: string;
    price: number;
    stripeSubscriptionId?: string;
    stripeCustomerId?: string;
  }) {
    const entityFilter: any = params.businessId
      ? { businessId: new Types.ObjectId(params.businessId) }
      : params.supplierId
        ? { supplierId: new Types.ObjectId(params.supplierId) }
        : { userId: new Types.ObjectId(params.userId) };
    await this.subModel.updateMany(
      { ...entityFilter, status: SubscriptionStatus.ACTIVE },
      { status: SubscriptionStatus.CANCELLED, cancelledAt: new Date() },
    );

    const periodDays = params.interval === 'annual' ? 365 : 30;
    return this.subModel.create({
      userId: new Types.ObjectId(params.userId),
      businessId: params.businessId ? new Types.ObjectId(params.businessId) : undefined,
      supplierId: params.supplierId ? new Types.ObjectId(params.supplierId) : undefined,
      planKey: params.planKey,
      interval: params.interval,
      price: params.price,
      status: SubscriptionStatus.ACTIVE,
      stripeSubscriptionId: params.stripeSubscriptionId,
      stripeCustomerId: params.stripeCustomerId,
      currentPeriodEnd: new Date(Date.now() + periodDays * 24 * 3600 * 1000),
    });
  }

  /** Stripe Checkout Session for an ad-wallet top-up (one-off payment). */
  async createTopupSession(businessId: string, amount: number, userId: string) {
    if (!this.stripe) throw new BadRequestException('Stripe not configured');
    const frontend = process.env.FRONTEND_URL?.split(',')[0] || 'http://localhost:3000';
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'gbp',
            unit_amount: Math.round(amount * 100),
            product_data: { name: 'TruOffers ad wallet top-up' },
          },
        },
      ],
      metadata: { type: 'wallet_topup', businessId, userId, amount: String(amount) },
      success_url: `${frontend}/dashboard?topup=success`,
      cancel_url: `${frontend}/dashboard?topup=cancelled`,
    });
    return { mode: 'stripe', url: session.url };
  }

  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
    if (!this.stripe) throw new BadRequestException('Stripe not configured');
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new BadRequestException('STRIPE_WEBHOOK_SECRET not configured');
    if (!rawBody || !signature) throw new BadRequestException('Missing webhook payload/signature');

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      this.logger.warn(`Webhook signature verification failed: ${(err as Error).message}`);
      throw new BadRequestException('Invalid webhook signature');
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const meta = session.metadata || {};
        if (meta.type === 'subscription') {
          await this.activateSubscription({
            userId: meta.userId,
            businessId: meta.businessId || undefined,
            supplierId: meta.supplierId || undefined,
            planKey: meta.planKey as PlanKey,
            interval: meta.interval,
            price: (session.amount_total || 0) / 100,
            stripeSubscriptionId:
              typeof session.subscription === 'string'
                ? session.subscription
                : session.subscription?.id,
            stripeCustomerId:
              typeof session.customer === 'string' ? session.customer : session.customer?.id,
          });
          this.logger.log(`Activated ${meta.planKey} for business ${meta.businessId || '-'}`);
        } else if (meta.type === 'wallet_topup') {
          await this.creditWallet(
            meta.businessId,
            (session.amount_total || 0) / 100,
            `Stripe top-up (${session.id})`,
          );
          this.logger.log(`Credited wallet for business ${meta.businessId}`);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await this.subModel.updateMany(
          { stripeSubscriptionId: sub.id, status: { $ne: SubscriptionStatus.CANCELLED } },
          { status: SubscriptionStatus.CANCELLED, cancelledAt: new Date() },
        );
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = (invoice as any).subscription;
        if (typeof subId === 'string') {
          await this.subModel.updateMany(
            { stripeSubscriptionId: subId, status: SubscriptionStatus.ACTIVE },
            { status: SubscriptionStatus.PAST_DUE },
          );
        }
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = (invoice as any).subscription;
        if (typeof subId === 'string') {
          await this.subModel.updateMany(
            { stripeSubscriptionId: subId, status: SubscriptionStatus.PAST_DUE },
            { status: SubscriptionStatus.ACTIVE },
          );
        }
        break;
      }
      default:
        break;
    }
    return { received: true };
  }

  async creditWallet(businessId: string, amount: number, note: string) {
    const wallet = await this.walletModel.findOneAndUpdate(
      { businessId: new Types.ObjectId(businessId) },
      { $inc: { balance: amount, totalToppedUp: amount } },
      { upsert: true, new: true },
    );
    await this.walletTxModel.create({
      businessId: new Types.ObjectId(businessId),
      type: 'topup',
      amount,
      note,
    });
    return wallet;
  }

  async mySubscriptions(userId: string) {
    return this.subModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .populate('businessId', 'name slug');
  }

  async cancel(subscriptionId: string, userId: string) {
    const sub = await this.subModel.findById(subscriptionId);
    if (!sub || String(sub.userId) !== userId) throw new NotFoundException('Subscription not found');
    if (this.stripe && sub.stripeSubscriptionId) {
      try {
        await this.stripe.subscriptions.cancel(sub.stripeSubscriptionId);
      } catch (err) {
        this.logger.warn(`Stripe cancel failed: ${(err as Error).message}`);
      }
    }
    sub.status = SubscriptionStatus.CANCELLED;
    sub.cancelledAt = new Date();
    await sub.save();
    return sub;
  }
}

@Controller('billing')
export class BillingController {
  constructor(private readonly service: BillingService) {}

  @Public()
  @Get('plans')
  plans() {
    return this.service.listPlans();
  }

  @Post('checkout')
  checkout(@Body() dto: CheckoutDto, @CurrentUser() user: { userId: string; role: Role }) {
    return this.service.checkout(dto, user);
  }

  // Stripe calls this endpoint; authenticity is proven by the signature header.
  @Public()
  @Post('webhook')
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    return this.service.handleWebhook(req.rawBody, signature);
  }

  @Get('subscriptions/mine')
  mine(@CurrentUser('userId') userId: string) {
    return this.service.mySubscriptions(userId);
  }

  @Post('cancel')
  cancel(@Body('subscriptionId') subscriptionId: string, @CurrentUser('userId') userId: string) {
    return this.service.cancel(subscriptionId, userId);
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Plan.name, schema: PlanSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Wallet.name, schema: WalletSchema },
      { name: WalletTransaction.name, schema: WalletTransactionSchema },
    ]),
  ],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
