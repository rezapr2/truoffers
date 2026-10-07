import { Body, Controller, Get, HttpCode, Module, Param, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { BusinessesModule } from '../businesses/businesses.module';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { Capability, RequireCapability } from '../common/permissions';
import { OffersModule } from '../offers/offers.module';
import { AnalyticsEvent, AnalyticsEventSchema } from '../schemas/analytics-event.schema';
import { Business, BusinessSchema } from '../schemas/business.schema';
import { MenuItem, MenuItemSchema } from '../schemas/menu.schema';
import { Offer, OfferSchema } from '../schemas/offer.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { SIGNATURE_HEADER } from './foodbell.signature';
import { FoodbellService } from './foodbell.service';

class ConnectDto {
  // e.g. K7QM-29XH, as shown in the Foodbell dashboard
  @IsString() @MinLength(6) @MaxLength(20) code: string;
}

@Controller('businesses/:businessId/foodbell')
export class BusinessFoodbellController {
  constructor(private readonly foodbell: FoodbellService) {}

  @Get()
  status(@Param('businessId') businessId: string, @CurrentUser() user: AuthUser) {
    return this.foodbell.status(businessId, user);
  }

  @Post('connect')
  connect(@Param('businessId') businessId: string, @Body() dto: ConnectDto, @CurrentUser() user: AuthUser) {
    return this.foodbell.connect(businessId, dto.code, user);
  }

  @Post('sync')
  sync(@Param('businessId') businessId: string, @CurrentUser() user: AuthUser) {
    return this.foodbell.syncNow(businessId, user);
  }

  @Post('disconnect')
  disconnect(@Param('businessId') businessId: string, @CurrentUser() user: AuthUser) {
    return this.foodbell.disconnect(businessId, user);
  }
}

@Controller('integrations/foodbell')
export class FoodbellWebhookController {
  constructor(private readonly foodbell: FoodbellService) {}

  // Signed by Foodbell with the shared secret (foodbell.signature.ts), never called by browsers.
  @Public()
  @HttpCode(200)
  @Post('webhook')
  webhook(@Req() req: RawBodyRequest<Request>) {
    return this.foodbell.handleWebhook(req.rawBody, req.header(SIGNATURE_HEADER), req.originalUrl);
  }
}

@Controller('admin/businesses/:businessId/foodbell')
@RequireCapability(Capability.BUSINESS_MANAGE)
export class AdminFoodbellController {
  constructor(private readonly foodbell: FoodbellService) {}

  @Post('sync')
  sync(@Param('businessId') businessId: string) {
    return this.foodbell.syncNow(businessId);
  }
}

@Module({
  imports: [
    BusinessesModule,
    OffersModule,
    MongooseModule.forFeature([
      { name: Business.name, schema: BusinessSchema },
      { name: Offer.name, schema: OfferSchema },
      { name: MenuItem.name, schema: MenuItemSchema },
      { name: User.name, schema: UserSchema },
      { name: AnalyticsEvent.name, schema: AnalyticsEventSchema },
    ]),
  ],
  controllers: [BusinessFoodbellController, FoodbellWebhookController, AdminFoodbellController],
  providers: [FoodbellService],
  exports: [FoodbellService],
})
export class FoodbellModule {}
