import {
  Body,
  Controller,
  Injectable,
  Module,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IsMongoId } from 'class-validator';
import { User, UserDocument, UserSchema } from '../schemas/user.schema';
import { Business, BusinessDocument, BusinessSchema } from '../schemas/business.schema';
import { CurrentUser } from '../common/decorators';

export class FollowDto {
  @IsMongoId() businessId: string;
}

export class SaveOfferDto {
  @IsMongoId() offerId: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Business.name) private businessModel: Model<BusinessDocument>,
  ) {}

  async toggleFollow(userId: string, businessId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    const following = user.followedBusinesses.includes(businessId);
    // Following something that isn't a business would only pad the user's list; unfollowing always works.
    if (!following && !(await this.businessModel.exists({ _id: businessId }))) {
      throw new NotFoundException('Business not found');
    }
    if (following) {
      user.followedBusinesses = user.followedBusinesses.filter((b) => b !== businessId);
    } else {
      user.followedBusinesses.push(businessId);
    }
    await user.save();
    await this.businessModel.findByIdAndUpdate(businessId, {
      $inc: { followerCount: following ? -1 : 1 },
    });
    return { following: !following, followedBusinesses: user.followedBusinesses };
  }

  async toggleSaveOffer(userId: string, offerId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    const saved = user.savedOffers.includes(offerId);
    if (saved) {
      user.savedOffers = user.savedOffers.filter((o) => o !== offerId);
    } else {
      user.savedOffers.push(offerId);
    }
    await user.save();
    return { saved: !saved, savedOffers: user.savedOffers };
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
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Business.name, schema: BusinessSchema },
    ]),
  ],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
