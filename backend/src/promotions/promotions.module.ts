import { Body, Controller, Delete, Get, Injectable, Logger, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MongooseModule } from '@nestjs/mongoose';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsMongoId, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { PromotionPlacement, PromotionStatus } from '../common/enums';
import { Capability, RequireCapability } from '../common/permissions';
import { BillingModule } from '../billing/billing.module';
import { Business, BusinessSchema } from '../schemas/business.schema';
import { Category, CategorySchema } from '../schemas/category.schema';
import { Offer, OfferSchema } from '../schemas/offer.schema';
import { Promotion, PromotionProduct, PromotionProductSchema, PromotionSchema } from '../schemas/promotion.schema';
import { PromotionsAdminService } from './promotions-admin.service';
import { PromotionsService } from './promotions.service';

// ---------------------------------------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------------------------------------

class AvailabilityQuery {
  @IsEnum(PromotionPlacement) productKey: PromotionPlacement;
  @IsOptional() @IsString() @MaxLength(8) area?: string;
  @IsOptional() @IsMongoId() categoryId?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsString() startsAt: string;
  @IsIn(['day', 'week', 'deal']) unit: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(30) quantity: number;
}

class BookDto extends AvailabilityQuery {
  @IsMongoId() offerId: string;
  @IsOptional() @IsBoolean() useCredit?: boolean;
}

class GrantDto extends AvailabilityQuery {
  @IsMongoId() businessId: string;
  @IsMongoId() offerId: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

class PriceDto {
  @IsIn(['day', 'week', 'deal']) unit: string;
  @IsNumber() @Min(0) @Max(10000) price: number;
  @IsInt() @Min(1) @Max(24 * 60) hours: number;
}

class ProductDto {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => PriceDto) prices?: PriceDto[];
  @IsOptional() @IsInt() @Min(0) @Max(100) slots?: number;
  @IsOptional() @IsInt() @Min(1) @Max(20) maxActivePerBusiness?: number;
  @IsOptional() @IsBoolean() approvalRequired?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(3) minVerificationLevel?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

class CancelDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class BookingsQuery {
  @IsOptional() @IsString() product?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() businessId?: string;
}

// ---------------------------------------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------------------------------------

@Controller('promotions')
export class PromotionsController {
  constructor(private readonly service: PromotionsService) {}

  @Public()
  @Get('products')
  products() {
    return this.service.catalogue();
  }

  @Get('availability')
  availability(@Query() query: AvailabilityQuery) {
    return this.service.availability(query);
  }

  // Flash deals ("Ending soon") and homepage spots ("Our top picks"), labelled Promoted on the site
  @Public()
  @Get('placements/:type')
  placement(@Param('type') type: string) {
    const key = type === 'flash' ? PromotionPlacement.FLASH_DEAL : type === 'homepage' ? PromotionPlacement.HOMEPAGE_SPOT : null;
    return key ? this.service.placementOffers(key) : [];
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.cancelUnpaid(id, user);
  }
}

@Controller('businesses/:businessId/promotions')
export class BusinessPromotionsController {
  constructor(private readonly service: PromotionsService) {}

  @Get()
  list(@Param('businessId') businessId: string, @CurrentUser() user: AuthUser) {
    return this.service.businessPromotions(businessId, user);
  }

  @Post()
  book(@Param('businessId') businessId: string, @Body() dto: BookDto, @CurrentUser() user: AuthUser) {
    return this.service.book(businessId, dto, user);
  }
}

@Controller('admin/promotions')
export class AdminPromotionsController {
  constructor(private readonly admin: PromotionsAdminService) {}

  @RequireCapability(Capability.ADMIN_PANEL)
  @Get('products')
  products() {
    return this.admin.products();
  }

  @RequireCapability(Capability.PROMOTIONS_MANAGE)
  @Patch('products/:key')
  updateProduct(@Param('key') key: string, @Body() dto: ProductDto) {
    return this.admin.updateProduct(key, dto);
  }

  @RequireCapability(Capability.ADMIN_PANEL)
  @Get('bookings')
  bookings(@Query() query: BookingsQuery) {
    return this.admin.bookings(query);
  }

  @RequireCapability(Capability.ADMIN_PANEL)
  @Get('calendar')
  calendar() {
    return this.admin.calendar();
  }

  @RequireCapability(Capability.PROMOTIONS_MANAGE)
  @Post('grant')
  grant(@Body() dto: GrantDto, @CurrentUser('userId') userId: string) {
    return this.admin.grant(dto, userId);
  }

  @RequireCapability(Capability.PROMOTIONS_MANAGE)
  @Post('bookings/:id/approve')
  approve(@Param('id') id: string) {
    return this.admin.approve(id);
  }

  @RequireCapability(Capability.PROMOTIONS_MANAGE)
  @Post('bookings/:id/reject')
  reject(@Param('id') id: string, @Body() dto: CancelDto) {
    return this.admin.cancel(id, true, dto.note);
  }

  @RequireCapability(Capability.PROMOTIONS_MANAGE)
  @Delete('bookings/:id')
  cancel(@Param('id') id: string, @Body() dto: CancelDto) {
    return this.admin.cancel(id, false, dto.note);
  }
}

/** Bookings start at their start time and end at their end time; unpaid ones are released. */
@Injectable()
export class PromotionsJobs {
  private readonly logger = new Logger(PromotionsJobs.name);

  constructor(private readonly service: PromotionsService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run() {
    const now = new Date();
    const starting = await this.service.promotions.find({ status: PromotionStatus.SCHEDULED, startsAt: { $lte: now }, endsAt: { $gt: now } });
    for (const booking of starting) {
      booking.status = PromotionStatus.ACTIVE;
      await booking.save();
      await this.service.announceLive(booking);
    }
    const ending = await this.service.promotions.find({ status: { $in: [PromotionStatus.ACTIVE, PromotionStatus.SCHEDULED] }, endsAt: { $lte: now }, productKey: { $exists: true } });
    for (const booking of ending) {
      booking.status = PromotionStatus.ENDED;
      await booking.save();
      await this.service.announceEnded(booking);
    }
    const abandoned = await this.service.promotions.updateMany(
      { status: PromotionStatus.PENDING_PAYMENT, createdAt: { $lt: new Date(now.getTime() - 2 * 3600_000) } },
      { $set: { status: PromotionStatus.CANCELLED, cancelledAt: now } },
    );
    if (starting.length || ending.length || abandoned.modifiedCount) {
      this.logger.log(`Promotions: ${starting.length} started, ${ending.length} ended, ${abandoned.modifiedCount} unpaid released`);
    }
    return { started: starting.length, ended: ending.length };
  }
}

@Module({
  imports: [
    BillingModule,
    MongooseModule.forFeature([
      { name: Promotion.name, schema: PromotionSchema },
      { name: PromotionProduct.name, schema: PromotionProductSchema },
      { name: Offer.name, schema: OfferSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Category.name, schema: CategorySchema },
    ]),
  ],
  controllers: [PromotionsController, BusinessPromotionsController, AdminPromotionsController],
  providers: [PromotionsService, PromotionsAdminService, PromotionsJobs],
  exports: [PromotionsService],
})
export class PromotionsModule {}
