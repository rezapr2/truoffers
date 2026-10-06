import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Offer, OfferSchema } from '../schemas/offer.schema';
import { Business, BusinessSchema } from '../schemas/business.schema';
import { Redemption, RedemptionSchema } from '../schemas/redemption.schema';
import { Subscription, SubscriptionSchema } from '../schemas/subscription.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { AdminOffersController, OffersController } from './offers.controller';
import { OffersService } from './offers.service';
import { OffersAdminService } from './offers-admin.service';
import { OfferPublishingService } from './offer-publishing.service';
import { OffersJobs } from './offers.jobs';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Offer.name, schema: OfferSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Redemption.name, schema: RedemptionSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [OffersController, AdminOffersController],
  providers: [OffersService, OffersAdminService, OfferPublishingService, OffersJobs],
  exports: [OffersService, OffersAdminService, OfferPublishingService],
})
export class OffersModule {}
