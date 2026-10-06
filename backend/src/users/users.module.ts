import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Patch, Post } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { IsBoolean, IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../schemas/user.schema';
import { Business, BusinessDocument, BusinessSchema } from '../schemas/business.schema';
import { Offer, OfferDocument, OfferSchema } from '../schemas/offer.schema';
import { UserSchema } from '../schemas/user.schema';
import { CurrentUser } from '../common/decorators';
import { BusinessStatus, PUBLIC_OFFER_STATUSES } from '../common/enums';
import { PUBLIC_OFFER_PROJECTION } from '../common/public-offer';
import { AnalyticsModule, AnalyticsService } from '../analytics/analytics.module';

class FollowDto {
  @IsMongoId() businessId: string;
}

class SaveOfferDto {
  @IsMongoId() offerId: string;
}

class UpdateMeDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(10) postcode?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  // Email alerts when a followed takeaway posts an offer
  @IsOptional() @IsBoolean() offerAlerts?: boolean;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Business.name) private businessModel: Model<BusinessDocument>,
    @InjectModel(Offer.name) private offerModel: Model<OfferDocument>,
    private readonly analytics: AnalyticsService,
  ) {}

  async toggleFollow(userId: string, businessId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    const business = await this.businessModel.exists({ _id: businessId, status: BusinessStatus.ACTIVE });
    const following = user.followedBusinesses.includes(businessId);
    if (!following && !business) throw new BadRequestException('That takeaway is not listed');
    user.followedBusinesses = following ? user.followedBusinesses.filter((b) => b !== businessId) : [...user.followedBusinesses, businessId];
    await user.save();
    await this.businessModel.findByIdAndUpdate(businessId, { $inc: { followerCount: following ? -1 : 1 } });
    await this.analytics.record(following ? 'unfollow' : 'follow', { businessId });
    return { following: !following, followedBusinesses: user.followedBusinesses };
  }

  async toggleSaveOffer(userId: string, offerId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    const saved = user.savedOffers.includes(offerId);
    user.savedOffers = saved ? user.savedOffers.filter((o) => o !== offerId) : [...user.savedOffers, offerId];
    await user.save();
    return { saved: !saved, savedOffers: user.savedOffers };
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (dto.name) user.name = dto.name;
    if (dto.postcode !== undefined) user.postcode = dto.postcode.toUpperCase().trim() || undefined;
    if (dto.phone !== undefined) user.phone = dto.phone.trim() || undefined;
    if (dto.offerAlerts !== undefined) user.offerAlerts = dto.offerAlerts;
    await user.save();
    return { name: user.name, postcode: user.postcode, phone: user.phone, offerAlerts: user.offerAlerts };
  }

  /** The customer's saved offers and followed takeaways. */
  async saved(userId: string) {
    const user = await this.userModel.findById(userId).lean();
    if (!user) throw new NotFoundException('User not found');
    const offerIds = user.savedOffers.filter((id) => Types.ObjectId.isValid(id));
    const businessIds = user.followedBusinesses.filter((id) => Types.ObjectId.isValid(id));
    const [offers, businesses] = await Promise.all([
      this.offerModel
        .find({ _id: { $in: offerIds }, status: { $in: PUBLIC_OFFER_STATUSES } })
        .select(PUBLIC_OFFER_PROJECTION)
        .populate('businessId', 'name slug town verificationLevel isFoodbellClient reviews')
        .lean(),
      this.businessModel
        .find({ _id: { $in: businessIds }, status: BusinessStatus.ACTIVE })
        .select('name slug town postcodeArea verificationLevel isFoodbellClient reviews activeOfferCount followerCount')
        .lean(),
    ]);
    return { offers, businesses };
  }
}

@Controller('users')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Post('me/follow')
  toggleFollow(@CurrentUser('userId') userId: string, @Body() dto: FollowDto) {
    return this.service.toggleFollow(userId, dto.businessId);
  }

  @Post('me/save-offer')
  toggleSave(@CurrentUser('userId') userId: string, @Body() dto: SaveOfferDto) {
    return this.service.toggleSaveOffer(userId, dto.offerId);
  }

  @Patch('me')
  updateMe(@CurrentUser('userId') userId: string, @Body() dto: UpdateMeDto) {
    return this.service.updateMe(userId, dto);
  }

  @Get('me/saved')
  saved(@CurrentUser('userId') userId: string) {
    return this.service.saved(userId);
  }
}

@Module({
  imports: [
    AnalyticsModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Offer.name, schema: OfferSchema },
    ]),
  ],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
