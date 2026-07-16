import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Business, BusinessDocument, BusinessSchema } from '../schemas/business.schema';
import { Claim, ClaimDocument, ClaimSchema } from '../schemas/claim.schema';
import { Offer, OfferDocument, OfferSchema } from '../schemas/offer.schema';
import { User, UserDocument, UserSchema } from '../schemas/user.schema';
import {
  Subscription,
  SubscriptionDocument,
  SubscriptionSchema,
} from '../schemas/subscription.schema';
import {
  AnalyticsEvent,
  AnalyticsEventDocument,
  AnalyticsEventSchema,
} from '../schemas/analytics-event.schema';
import { CurrentUser, Roles } from '../common/decorators';
import {
  ClaimStatus,
  OfferStatus,
  Role,
  SubscriptionStatus,
  VerificationStatus,
} from '../common/enums';
import { BusinessesModule } from '../businesses/businesses.module';
import { BusinessesService } from '../businesses/businesses.service';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(Business.name) private businessModel: Model<BusinessDocument>,
    @InjectModel(Claim.name) private claimModel: Model<ClaimDocument>,
    @InjectModel(Offer.name) private offerModel: Model<OfferDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Subscription.name) private subModel: Model<SubscriptionDocument>,
    @InjectModel(AnalyticsEvent.name) private eventModel: Model<AnalyticsEventDocument>,
    private businessesService: BusinessesService,
  ) {}

  claimsQueue(status?: string) {
    return this.claimModel
      .find({ status: status || ClaimStatus.PENDING })
      .sort({ createdAt: 1 })
      .populate('businessId', 'name slug town postcode verificationStatus')
      .populate('userId', 'name email phone');
  }

  async reviewClaim(claimId: string, approve: boolean, reviewerId: string, note?: string) {
    const claim = await this.claimModel.findById(claimId);
    if (!claim) throw new NotFoundException('Claim not found');
    claim.status = approve ? ClaimStatus.APPROVED : ClaimStatus.REJECTED;
    claim.reviewedBy = new Types.ObjectId(reviewerId);
    claim.reviewNote = note;
    await claim.save();
    if (approve) {
      await this.businessesService.approveClaimEffects(claim);
    }
    return claim;
  }

  offersQueue(status?: string) {
    return this.offerModel
      .find({ status: status || OfferStatus.PENDING })
      .sort({ createdAt: 1 })
      .populate('businessId', 'name slug town verificationStatus');
  }

  async moderateOffer(offerId: string, approve: boolean, note?: string) {
    const offer = await this.offerModel.findById(offerId);
    if (!offer) throw new NotFoundException('Offer not found');
    offer.status = approve ? OfferStatus.ACTIVE : OfferStatus.REJECTED;
    offer.moderationNote = note;
    await offer.save();
    if (approve) {
      const count = await this.offerModel.countDocuments({
        businessId: offer.businessId,
        status: OfferStatus.ACTIVE,
      });
      await this.businessModel.findByIdAndUpdate(offer.businessId, { activeOfferCount: count });
    }
    return offer;
  }

  async setVerification(businessId: string, status: VerificationStatus) {
    const business = await this.businessModel.findByIdAndUpdate(
      businessId,
      { verificationStatus: status },
      { new: true },
    );
    if (!business) throw new NotFoundException('Business not found');
    return business;
  }

  async setFeatured(businessId: string, featured: boolean) {
    const business = await this.businessModel.findByIdAndUpdate(
      businessId,
      { featured },
      { new: true },
    );
    if (!business) throw new NotFoundException('Business not found');
    return business;
  }

  // Executive dashboard (blueprint 16.3): supply, demand, revenue
  async executiveDashboard() {
    const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const [
      listedBusinesses,
      claimedBusinesses,
      activeOffers,
      pendingClaims,
      pendingOffers,
      users,
      activeSubs,
      searches30d,
      orderClicks30d,
    ] = await Promise.all([
      this.businessModel.countDocuments({}),
      this.businessModel.countDocuments({
        verificationStatus: { $ne: VerificationStatus.UNCLAIMED },
      }),
      this.offerModel.countDocuments({ status: OfferStatus.ACTIVE }),
      this.claimModel.countDocuments({ status: ClaimStatus.PENDING }),
      this.offerModel.countDocuments({ status: OfferStatus.PENDING }),
      this.userModel.countDocuments({}),
      this.subModel.find({ status: SubscriptionStatus.ACTIVE }),
      this.eventModel.countDocuments({ eventName: 'postcode_search', createdAt: { $gte: since30 } }),
      this.eventModel.countDocuments({ eventName: 'order_click', createdAt: { $gte: since30 } }),
    ]);

    const mrr = activeSubs.reduce(
      (sum, s) => sum + (s.interval === 'annual' ? s.price / 12 : s.price),
      0,
    );

    const topSearchAreas = await this.eventModel.aggregate([
      { $match: { eventName: 'postcode_search', createdAt: { $gte: since30 } } },
      { $group: { _id: '$postcodeArea', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    return {
      supply: {
        listedBusinesses,
        claimedBusinesses,
        activeOffers,
        claimedRate: listedBusinesses ? Math.round((claimedBusinesses / listedBusinesses) * 100) : 0,
      },
      demand: { users, searches30d, orderClicks30d, topSearchAreas },
      revenue: {
        paidAccounts: activeSubs.length,
        mrr: Math.round(mrr * 100) / 100,
        arpa: activeSubs.length ? Math.round((mrr / activeSubs.length) * 100) / 100 : 0,
      },
      moderation: { pendingClaims, pendingOffers },
    };
  }

  listBusinesses(q?: string) {
    const filter: any = {};
    if (q) filter.name = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    return this.businessModel.find(filter).sort({ createdAt: -1 }).limit(100);
  }
}

@Roles(Role.SUPER_ADMIN, Role.SUPPORT_ADMIN, Role.SALES_ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly service: AdminService) {}

  @Get('dashboard')
  dashboard() {
    return this.service.executiveDashboard();
  }

  @Get('claims')
  claims(@Query('status') status?: string) {
    return this.service.claimsQueue(status);
  }

  @Patch('claims/:id/review')
  reviewClaim(
    @Param('id') id: string,
    @Body('approve') approve: boolean,
    @Body('note') note: string,
    @CurrentUser('userId') reviewerId: string,
  ) {
    return this.service.reviewClaim(id, approve, reviewerId, note);
  }

  @Get('offers')
  offers(@Query('status') status?: string) {
    return this.service.offersQueue(status);
  }

  @Patch('offers/:id/moderate')
  moderateOffer(
    @Param('id') id: string,
    @Body('approve') approve: boolean,
    @Body('note') note?: string,
  ) {
    return this.service.moderateOffer(id, approve, note);
  }

  @Patch('businesses/:id/verification')
  setVerification(@Param('id') id: string, @Body('status') status: VerificationStatus) {
    return this.service.setVerification(id, status);
  }

  @Patch('businesses/:id/featured')
  setFeatured(@Param('id') id: string, @Body('featured') featured: boolean) {
    return this.service.setFeatured(id, featured);
  }

  @Get('businesses')
  businesses(@Query('q') q?: string) {
    return this.service.listBusinesses(q);
  }
}

@Module({
  imports: [
    BusinessesModule,
    MongooseModule.forFeature([
      { name: Business.name, schema: BusinessSchema },
      { name: Claim.name, schema: ClaimSchema },
      { name: Offer.name, schema: OfferSchema },
      { name: User.name, schema: UserSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: AnalyticsEvent.name, schema: AnalyticsEventSchema },
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
