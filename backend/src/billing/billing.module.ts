import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { IsEnum, IsIn, IsMongoId, IsOptional } from 'class-validator';
import { Plan, PlanDocument, PlanSchema } from '../schemas/plan.schema';
import {
  Subscription,
  SubscriptionDocument,
  SubscriptionSchema,
} from '../schemas/subscription.schema';
import { Business, BusinessDocument, BusinessSchema } from '../schemas/business.schema';
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

// Billing is Stripe-ready: when STRIPE_SECRET_KEY is set, checkout should
// create a Stripe Checkout Session and the webhook activates the plan.
// Without a key (dev/MVP demo) it activates the subscription directly.
@Injectable()
export class BillingService {
  constructor(
    @InjectModel(Plan.name) private planModel: Model<PlanDocument>,
    @InjectModel(Subscription.name) private subModel: Model<SubscriptionDocument>,
    @InjectModel(Business.name) private businessModel: Model<BusinessDocument>,
  ) {}

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

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (stripeKey) {
      // Production path: create Stripe Checkout Session here and return its URL.
      // Subscription is created on the checkout.session.completed webhook.
      throw new BadRequestException(
        'Stripe checkout not configured in this build — unset STRIPE_SECRET_KEY for mock mode',
      );
    }

    // Mock mode: cancel any existing sub for this entity, then activate the new one
    const entityFilter: any = dto.businessId
      ? { businessId: new Types.ObjectId(dto.businessId) }
      : dto.supplierId
        ? { supplierId: new Types.ObjectId(dto.supplierId) }
        : { userId: new Types.ObjectId(user.userId) };
    await this.subModel.updateMany(
      { ...entityFilter, status: SubscriptionStatus.ACTIVE },
      { status: SubscriptionStatus.CANCELLED, cancelledAt: new Date() },
    );

    const periodDays = dto.interval === 'annual' ? 365 : 30;
    const sub = await this.subModel.create({
      userId: new Types.ObjectId(user.userId),
      businessId: dto.businessId ? new Types.ObjectId(dto.businessId) : undefined,
      supplierId: dto.supplierId ? new Types.ObjectId(dto.supplierId) : undefined,
      planKey: dto.planKey,
      interval: dto.interval,
      price,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: new Date(Date.now() + periodDays * 24 * 3600 * 1000),
    });
    return { mode: 'mock', subscription: sub };
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
    ]),
  ],
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
