import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Business, BusinessSchema } from '../schemas/business.schema';
import { Claim, ClaimSchema } from '../schemas/claim.schema';
import { MenuItem, MenuItemSchema } from '../schemas/menu.schema';
import { Offer, OfferSchema } from '../schemas/offer.schema';
import { Category, CategorySchema } from '../schemas/category.schema';
import { BusinessesController } from './businesses.controller';
import { BusinessesService } from './businesses.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Business.name, schema: BusinessSchema },
      { name: Claim.name, schema: ClaimSchema },
      { name: MenuItem.name, schema: MenuItemSchema },
      { name: Offer.name, schema: OfferSchema },
      { name: Category.name, schema: CategorySchema },
    ]),
  ],
  controllers: [BusinessesController],
  providers: [BusinessesService],
  exports: [BusinessesService],
})
export class BusinessesModule {}
