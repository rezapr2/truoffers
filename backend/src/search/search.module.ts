import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Business, BusinessSchema } from '../schemas/business.schema';
import { Offer, OfferSchema } from '../schemas/offer.schema';
import { Category, CategorySchema } from '../schemas/category.schema';
import { Promotion, PromotionSchema } from '../schemas/promotion.schema';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Business.name, schema: BusinessSchema },
      { name: Offer.name, schema: OfferSchema },
      { name: Category.name, schema: CategorySchema },
      { name: Promotion.name, schema: PromotionSchema },
    ]),
  ],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
