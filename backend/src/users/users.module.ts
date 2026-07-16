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
import { User, UserDocument, UserSchema } from '../schemas/user.schema';
import { Business, BusinessDocument, BusinessSchema } from '../schemas/business.schema';
import { CurrentUser } from '../common/decorators';

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
  toggleFollow(@CurrentUser('userId') userId: string, @Body('businessId') businessId: string) {
    return this.service.toggleFollow(userId, businessId);
  }

  @Post('me/save-offer')
  toggleSave(@CurrentUser('userId') userId: string, @Body('offerId') offerId: string) {
    return this.service.toggleSaveOffer(userId, offerId);
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
