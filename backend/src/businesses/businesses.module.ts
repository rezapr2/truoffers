import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Business, BusinessSchema } from '../schemas/business.schema';
import {
  BusinessChangeRequest,
  BusinessChangeRequestSchema,
  BusinessInvite,
  BusinessInviteSchema,
} from '../schemas/business-team.schema';
import { Claim, ClaimSchema } from '../schemas/claim.schema';
import { MenuItem, MenuItemSchema } from '../schemas/menu.schema';
import { Offer, OfferSchema } from '../schemas/offer.schema';
import { Category, CategorySchema } from '../schemas/category.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { BusinessesController, TeamInvitesController } from './businesses.controller';
import { BusinessesService } from './businesses.service';

export const BUSINESS_MODELS = MongooseModule.forFeature([
  { name: Business.name, schema: BusinessSchema },
  { name: Claim.name, schema: ClaimSchema },
  { name: MenuItem.name, schema: MenuItemSchema },
  { name: Offer.name, schema: OfferSchema },
  { name: Category.name, schema: CategorySchema },
  { name: User.name, schema: UserSchema },
  { name: BusinessInvite.name, schema: BusinessInviteSchema },
  { name: BusinessChangeRequest.name, schema: BusinessChangeRequestSchema },
]);

@Module({
  imports: [BUSINESS_MODELS],
  controllers: [BusinessesController, TeamInvitesController],
  providers: [BusinessesService],
  exports: [BusinessesService, BUSINESS_MODELS],
})
export class BusinessesModule {}
