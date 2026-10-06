import { Body, Controller, Get, Headers, Module, Param, Patch, Post, Query, RawBodyRequest, Req, Res } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type { Request, Response } from 'express';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { csvResponse, toCsv } from '../common/csv';
import { Capability, RequireCapability } from '../common/permissions';
import { Business, BusinessSchema } from '../schemas/business.schema';
import { Coupon, CouponSchema, Payment, PaymentSchema, StripeEvent, StripeEventSchema } from '../schemas/payment.schema';
import { Plan, PlanSchema } from '../schemas/plan.schema';
import { Subscription, SubscriptionSchema } from '../schemas/subscription.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { BillingAdminService } from './billing-admin.service';
import { BillingJobs } from './billing.jobs';
import { BillingService, Interval } from './billing.service';
import { StripeService } from './stripe.service';

// ---------------------------------------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------------------------------------

export class CheckoutDto {
  @IsString() @MaxLength(40) planKey: string;
  @IsIn(['monthly', 'annual']) interval: Interval;
  @IsOptional() @IsString() @MaxLength(30) couponCode?: string;
}

class ChangePlanDto {
  @IsString() @MaxLength(40) planKey: string;
  @IsIn(['monthly', 'annual']) interval: Interval;
}

class CouponPreviewDto {
  @IsString() @MaxLength(30) code: string;
  @IsString() @MaxLength(40) planKey: string;
  @IsIn(['monthly', 'annual']) interval: Interval;
}

class PlanLimitsDto {
  @IsOptional() @IsInt() @Min(-1) @Max(10000) maxLiveOffers?: number;
  @IsOptional() @IsInt() @Min(-1) @Max(10000) maxPhotos?: number;
  @IsOptional() @IsInt() @Min(-1) @Max(1000) maxBranches?: number;
}

class PlanFlagsDto {
  @IsOptional() @IsBoolean() scheduledOffers?: boolean;
  @IsOptional() @IsBoolean() couponCodes?: boolean;
  @IsOptional() @IsIn(['views', 'full', 'full_report']) analytics?: 'views' | 'full' | 'full_report';
  @IsOptional() @IsBoolean() aiOfferWriter?: boolean;
  @IsOptional() @IsBoolean() qrCodes?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(2) rankingBoost?: number;
  @IsOptional() @IsBoolean() prioritySupport?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(4) freeTopOfSearchWeeksPerMonth?: number;
}

class PlanDto {
  @IsOptional() @IsString() @MaxLength(40) key?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) name?: string;
  @IsOptional() @IsIn(['takeaway', 'supplier']) audience?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(10000) monthlyPrice?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100000) annualPrice?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) @Max(50) vatRatePercent?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(365) trialDays?: number;
  @IsOptional() @IsString() @MaxLength(120) bestFor?: string;
  @IsOptional() @IsObject() @Type(() => PlanLimitsDto) limits?: PlanLimitsDto;
  @IsOptional() @IsObject() @Type(() => PlanFlagsDto) flags?: PlanFlagsDto;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(120, { each: true }) features?: string[];
  @IsOptional() @IsBoolean() autoApprove?: boolean;
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsString() @MaxLength(30) badgeText?: string;
  @IsOptional() @IsBoolean() migrateExisting?: boolean;
}

class ArchiveDto {
  @IsBoolean() archived: boolean;
}

class RefundDto {
  @IsOptional() @IsNumber() @Min(0.01) amount?: number;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

class SetPlanDto {
  @IsString() @MaxLength(40) planKey: string;
  @IsIn(['monthly', 'annual']) interval: Interval;
  @IsBoolean() comp: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(36) months?: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class CancelSubDto {
  @IsBoolean() immediately: boolean;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class CouponDto {
  @IsOptional() @IsString() @MaxLength(30) code?: string;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() percentOff?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0.01) amountOff?: number | null;
  @IsOptional() @IsIn(['once', 'repeating', 'forever']) duration?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(36) durationInMonths?: number | null;
  @IsOptional() @IsArray() @IsString({ each: true }) appliesToPlans?: string[];
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) maxUses?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsDateString() expiresAt?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

class ListQuery {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() plan?: string;
  @IsOptional() @IsString() kind?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsIn(['json', 'csv']) format?: string;
}

// ---------------------------------------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------------------------------------

@Controller('billing')
export class BillingController {
  constructor(private readonly service: BillingService) {}

  @Public()
  @Get('plans')
  plans(@Query('audience') audience?: string) {
    return this.service.publicPlans(audience);
  }

  @Post('coupons/preview')
  preview(@Body() dto: CouponPreviewDto) {
    return this.service.previewCoupon(dto.code, dto.planKey, dto.interval);
  }

  // Stripe calls this endpoint; authenticity is proven by the signature header.
  @Public()
  @Post('webhook')
  webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    return this.service.handleWebhook(req.rawBody, signature);
  }

  @Get('subscriptions/mine')
  mine(@CurrentUser('userId') userId: string) {
    return this.service.mySubscriptions(userId);
  }
}

@Controller('businesses/:businessId/billing')
export class BusinessBillingController {
  constructor(private readonly service: BillingService) {}

  @Get()
  overview(@Param('businessId') businessId: string, @CurrentUser() user: AuthUser) {
    return this.service.overview(businessId, user);
  }

  @Post('checkout')
  checkout(@Param('businessId') businessId: string, @Body() dto: CheckoutDto, @CurrentUser() user: AuthUser) {
    return this.service.checkout(businessId, dto, user);
  }

  @Post('change')
  change(@Param('businessId') businessId: string, @Body() dto: ChangePlanDto, @CurrentUser() user: AuthUser) {
    return this.service.changePlan(businessId, dto, user);
  }

  @Post('cancel')
  cancel(@Param('businessId') businessId: string, @CurrentUser() user: AuthUser) {
    return this.service.cancel(businessId, user);
  }

  @Post('resume')
  resume(@Param('businessId') businessId: string, @CurrentUser() user: AuthUser) {
    return this.service.resume(businessId, user);
  }

  @Post('portal')
  portal(@Param('businessId') businessId: string, @CurrentUser() user: AuthUser) {
    return this.service.portal(businessId, user);
  }

  @Get('invoices/:paymentId')
  invoice(@Param('businessId') businessId: string, @Param('paymentId') paymentId: string, @CurrentUser() user: AuthUser) {
    return this.service.invoice(businessId, paymentId, user);
  }
}

@Controller('admin/plans')
@RequireCapability(Capability.PLANS_MANAGE)
export class AdminPlansController {
  constructor(private readonly admin: BillingAdminService) {}

  @Get()
  list() {
    return this.admin.listPlans();
  }

  @Post()
  create(@Body() dto: PlanDto) {
    return this.admin.createPlan(dto);
  }

  @Patch(':key')
  update(@Param('key') key: string, @Body() dto: PlanDto) {
    return this.admin.updatePlan(key, dto);
  }

  @Post(':key/archive')
  archive(@Param('key') key: string, @Body() dto: ArchiveDto) {
    return this.admin.setArchived(key, dto.archived);
  }
}

@Controller('admin/billing')
export class AdminBillingController {
  constructor(private readonly admin: BillingAdminService) {}

  @RequireCapability(Capability.BILLING_VIEW)
  @Get('subscriptions')
  async subscriptions(@Query() query: ListQuery, @Res({ passthrough: true }) res: Response) {
    if (query.format === 'csv') {
      const { items } = await this.admin.listSubscriptions({ ...query, page: '1' }, 10000);
      return csvResponse(res, 'subscriptions.csv', toCsv(items as unknown as Record<string, unknown>[], [
        { key: 'business', label: 'Business', value: (s) => (s.businessId as { name?: string } | undefined)?.name },
        { key: 'planKey', label: 'Plan' },
        { key: 'interval', label: 'Interval' },
        { key: 'price', label: 'Price' },
        { key: 'status', label: 'Status' },
        { key: 'comp', label: 'Comp' },
        { key: 'currentPeriodEnd', label: 'Renews' },
        { key: 'cancelAtPeriodEnd', label: 'Cancelling' },
        { key: 'stripeSubscriptionId', label: 'Stripe ID' },
        { key: 'createdAt', label: 'Started' },
      ]));
    }
    return this.admin.listSubscriptions(query);
  }

  @RequireCapability(Capability.BILLING_VIEW)
  @Get('payments')
  async payments(@Query() query: ListQuery, @Res({ passthrough: true }) res: Response) {
    if (query.format === 'csv') {
      const { items } = await this.admin.listPayments({ ...query, page: '1' }, 10000);
      return csvResponse(res, 'payments.csv', toCsv(items as unknown as Record<string, unknown>[], [
        { key: 'number', label: 'Invoice' },
        { key: 'business', label: 'Business', value: (p) => (p.businessId as { name?: string } | undefined)?.name },
        { key: 'kind', label: 'Kind' },
        { key: 'description', label: 'Description' },
        { key: 'amount', label: 'Net' },
        { key: 'vat', label: 'VAT' },
        { key: 'total', label: 'Total' },
        { key: 'refundedAmount', label: 'Refunded' },
        { key: 'status', label: 'Status' },
        { key: 'createdAt', label: 'Date' },
      ]));
    }
    return this.admin.listPayments(query);
  }

  @RequireCapability(Capability.BILLING_VIEW)
  @Get('failed')
  failed() {
    return this.admin.failed();
  }

  @RequireCapability(Capability.BILLING_MANAGE)
  @Post('payments/:id/refund')
  refund(@Param('id') id: string, @Body() dto: RefundDto) {
    return this.admin.refund(id, dto);
  }

  @RequireCapability(Capability.BILLING_MANAGE)
  @Post('businesses/:businessId/plan')
  setPlan(@Param('businessId') businessId: string, @Body() dto: SetPlanDto, @CurrentUser('userId') userId: string) {
    return this.admin.setPlan(businessId, dto, userId);
  }

  @RequireCapability(Capability.BILLING_MANAGE)
  @Post('subscriptions/:id/cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelSubDto) {
    return this.admin.cancelSubscription(id, dto.immediately, dto.note);
  }
}

@Controller('admin/coupons')
@RequireCapability(Capability.COUPONS_MANAGE)
export class AdminCouponsController {
  constructor(private readonly admin: BillingAdminService) {}

  @Get()
  list() {
    return this.admin.listCoupons();
  }

  @Post()
  create(@Body() dto: CouponDto) {
    return this.admin.createCoupon(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: CouponDto) {
    return this.admin.updateCoupon(id, dto);
  }
}

export const BILLING_MODELS = MongooseModule.forFeature([
  { name: Plan.name, schema: PlanSchema },
  { name: Subscription.name, schema: SubscriptionSchema },
  { name: Payment.name, schema: PaymentSchema },
  { name: Coupon.name, schema: CouponSchema },
  { name: StripeEvent.name, schema: StripeEventSchema },
  { name: Business.name, schema: BusinessSchema },
  { name: User.name, schema: UserSchema },
]);

@Module({
  imports: [BILLING_MODELS],
  controllers: [BillingController, BusinessBillingController, AdminPlansController, AdminBillingController, AdminCouponsController],
  providers: [BillingService, BillingAdminService, BillingJobs, StripeService],
  exports: [BillingService, BillingAdminService, StripeService],
})
export class BillingModule {}
