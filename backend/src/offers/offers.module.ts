import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Offer, OfferSchema } from '../schemas/offer.schema';
import { Business, BusinessSchema } from '../schemas/business.schema';
import { Redemption, RedemptionSchema } from '../schemas/redemption.schema';
import { Subscription, SubscriptionSchema } from '../schemas/subscription.schema';
import { Plan, PlanSchema } from '../schemas/plan.schema';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Offer.name, schema: OfferSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Redemption.name, schema: RedemptionSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Plan.name, schema: PlanSchema },
    ]),
  ],
  controllers: [OffersController],
  providers: [OffersService],
})
export class OffersModule {}
