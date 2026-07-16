import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { IsIn, IsMongoId, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Business, BusinessDocument, BusinessSchema } from '../schemas/business.schema';
import { Wallet, WalletDocument, WalletSchema } from '../schemas/wallet.schema';
import {
  WalletTransaction,
  WalletTransactionDocument,
  WalletTransactionSchema,
} from '../schemas/wallet-transaction.schema';
import {
  Promotion,
  PromotionDocument,
  PromotionSchema,
  PromotionStatus,
} from '../schemas/promotion.schema';
import { Offer, OfferDocument, OfferSchema } from '../schemas/offer.schema';
import { BillingModule, BillingService } from '../billing/billing.module';
import { CurrentUser } from '../common/decorators';
import { Role } from '../common/enums';

export const MIN_TOPUP = 5;
export const MIN_DAILY_RATE = 2;

export class TopupDto {
  @IsNumber()
  @Min(MIN_TOPUP)
  @Max(1000)
  amount: number;
}

export class CreatePromotionDto {
  @IsMongoId()
  businessId: string;

  @IsOptional()
  @IsMongoId()
  offerId?: string;

  @IsNumber()
  @Min(MIN_DAILY_RATE)
  @Max(100)
  dailyRate: number;
}

export class PromotionStatusDto {
  @IsIn([PromotionStatus.ACTIVE, PromotionStatus.PAUSED, PromotionStatus.ENDED])
  status: PromotionStatus;
}

@Injectable()
export class AdsService {
  private readonly logger = new Logger(AdsService.name);

  constructor(
    @InjectModel(Wallet.name) private walletModel: Model<WalletDocument>,
    @InjectModel(WalletTransaction.name)
    private walletTxModel: Model<WalletTransactionDocument>,
    @InjectModel(Promotion.name) private promotionModel: Model<PromotionDocument>,
    @InjectModel(Business.name) private businessModel: Model<BusinessDocument>,
    @InjectModel(Offer.name) private offerModel: Model<OfferDocument>,
    private readonly billing: BillingService,
  ) {}

  async wallet(businessId: string, user: { userId: string; role: Role }) {
    await this.assertCanManage(businessId, user);
    const wallet =
      (await this.walletModel.findOne({ businessId: new Types.ObjectId(businessId) })) ||
      (await this.walletModel.create({ businessId: new Types.ObjectId(businessId) }));
    const transactions = await this.walletTxModel
      .find({ businessId: new Types.ObjectId(businessId) })
      .sort({ createdAt: -1 })
      .limit(20);
    return { wallet, transactions };
  }

  async topup(businessId: string, dto: TopupDto, user: { userId: string; role: Role }) {
    await this.assertCanManage(businessId, user);
    if (this.billing.stripeEnabled) {
      // Production path: pay via Stripe Checkout; the webhook credits the wallet.
      return this.billing.createTopupSession(businessId, dto.amount, user.userId);
    }
    // Mock mode: credit directly
    const wallet = await this.billing.creditWallet(businessId, dto.amount, 'Top-up (mock mode)');
    return { mode: 'mock', wallet };
  }

  async listPromotions(businessId: string, user: { userId: string; role: Role }) {
    await this.assertCanManage(businessId, user);
    return this.promotionModel
      .find({ businessId: new Types.ObjectId(businessId) })
      .sort({ createdAt: -1 })
      .populate('offerId', 'title displayLabel status');
  }

  async createPromotion(dto: CreatePromotionDto, user: { userId: string; role: Role }) {
    await this.assertCanManage(dto.businessId, user);
    if (dto.offerId) {
      const offer = await this.offerModel.findById(dto.offerId);
      if (!offer || String(offer.businessId) !== dto.businessId) {
        throw new NotFoundException('Offer not found for this business');
      }
    }
    const existing = await this.promotionModel.findOne({
      businessId: new Types.ObjectId(dto.businessId),
      offerId: dto.offerId ? new Types.ObjectId(dto.offerId) : null,
      status: { $in: [PromotionStatus.ACTIVE, PromotionStatus.PAUSED] },
    });
    if (existing) {
      throw new BadRequestException('A promotion already exists for this target');
    }

    // First day is charged upfront — requires sufficient wallet balance
    const charged = await this.chargeWallet(dto.businessId, dto.dailyRate, 'Promotion day 1');
    if (!charged) {
      throw new BadRequestException(
        `Insufficient ad wallet balance. Top up at least £${dto.dailyRate} first.`,
      );
    }

    return this.promotionModel.create({
      businessId: new Types.ObjectId(dto.businessId),
      offerId: dto.offerId ? new Types.ObjectId(dto.offerId) : undefined,
      dailyRate: dto.dailyRate,
      lastChargedAt: new Date(),
      totalSpent: dto.dailyRate,
    });
  }

  async setPromotionStatus(
    promotionId: string,
    status: PromotionStatus,
    user: { userId: string; role: Role },
  ) {
    const promo = await this.promotionModel.findById(promotionId);
    if (!promo) throw new NotFoundException('Promotion not found');
    await this.assertCanManage(String(promo.businessId), user);
    if (promo.status === PromotionStatus.ENDED) {
      throw new BadRequestException('Promotion has ended');
    }
    promo.status = status;
    if (status === PromotionStatus.ENDED) promo.endedAt = new Date();
    await promo.save();
    return promo;
  }

  /** Deduct from wallet if the balance covers it. Returns false when it can't. */
  private async chargeWallet(businessId: string, amount: number, note: string) {
    const wallet = await this.walletModel.findOneAndUpdate(
      { businessId: new Types.ObjectId(businessId), balance: { $gte: amount } },
      { $inc: { balance: -amount, totalSpent: amount } },
      { new: true },
    );
    if (!wallet) return false;
    await this.walletTxModel.create({
      businessId: new Types.ObjectId(businessId),
      type: 'spend',
      amount: -amount,
      note,
    });
    return true;
  }

  // Charge each active promotion its daily rate once per day; pause promotions
  // whose wallet can't cover the day.
  @Cron(CronExpression.EVERY_HOUR)
  async chargeDailyRates() {
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
    const due = await this.promotionModel.find({
      status: PromotionStatus.ACTIVE,
      $or: [{ lastChargedAt: null }, { lastChargedAt: { $lte: cutoff } }],
    });
    for (const promo of due) {
      const charged = await this.chargeWallet(
        String(promo.businessId),
        promo.dailyRate,
        'Promotion daily charge',
      );
      if (charged) {
        promo.lastChargedAt = new Date();
        promo.totalSpent += promo.dailyRate;
      } else {
        promo.status = PromotionStatus.PAUSED;
        this.logger.log(`Paused promotion ${promo.id} — insufficient wallet balance`);
      }
      await promo.save();
    }
    if (due.length > 0) this.logger.log(`Processed ${due.length} promotion charge(s)`);
  }

  private async assertCanManage(businessId: string, user: { userId: string; role: Role }) {
    const business = await this.businessModel.findById(businessId);
    if (!business) throw new NotFoundException('Business not found');
    const isAdmin = [Role.SUPER_ADMIN, Role.SUPPORT_ADMIN, Role.SALES_ADMIN].includes(user.role);
    if (!isAdmin && String(business.ownerId) !== user.userId) {
      throw new ForbiddenException('You do not manage this business');
    }
    return business;
  }
}

@Controller('ads')
export class AdsController {
  constructor(private readonly service: AdsService) {}

  @Get('wallet/:businessId')
  wallet(
    @Param('businessId') businessId: string,
    @CurrentUser() user: { userId: string; role: Role },
  ) {
    return this.service.wallet(businessId, user);
  }

  @Post('wallet/:businessId/topup')
  topup(
    @Param('businessId') businessId: string,
    @Body() dto: TopupDto,
    @CurrentUser() user: { userId: string; role: Role },
  ) {
    return this.service.topup(businessId, dto, user);
  }

  @Get('promotions/:businessId')
  promotions(
    @Param('businessId') businessId: string,
    @CurrentUser() user: { userId: string; role: Role },
  ) {
    return this.service.listPromotions(businessId, user);
  }

  @Post('promotions')
  create(@Body() dto: CreatePromotionDto, @CurrentUser() user: { userId: string; role: Role }) {
    return this.service.createPromotion(dto, user);
  }

  @Patch('promotions/:id/status')
  setStatus(
    @Param('id') id: string,
    @Body() dto: PromotionStatusDto,
    @CurrentUser() user: { userId: string; role: Role },
  ) {
    return this.service.setPromotionStatus(id, dto.status, user);
  }
}

@Module({
  imports: [
    BillingModule,
    MongooseModule.forFeature([
      { name: Wallet.name, schema: WalletSchema },
      { name: WalletTransaction.name, schema: WalletTransactionSchema },
      { name: Promotion.name, schema: PromotionSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Offer.name, schema: OfferSchema },
    ]),
  ],
  controllers: [AdsController],
  providers: [AdsService],
})
export class AdsModule {}
