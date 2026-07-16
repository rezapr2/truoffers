import { Injectable, Logger, Module } from '@nestjs/common';
import { Cron, CronExpression, ScheduleModule } from '@nestjs/schedule';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Offer, OfferDocument, OfferSchema } from '../schemas/offer.schema';
import { Business, BusinessDocument, BusinessSchema } from '../schemas/business.schema';
import { OfferStatus } from '../common/enums';

/**
 * Background jobs per blueprint §22: expired offers must leave search results
 * automatically and denormalised counters must stay accurate.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @InjectModel(Offer.name) private offerModel: Model<OfferDocument>,
    @InjectModel(Business.name) private businessModel: Model<BusinessDocument>,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async expireOffers() {
    const now = new Date();
    const result = await this.offerModel.updateMany(
      { status: OfferStatus.ACTIVE, endsAt: { $ne: null, $lt: now } },
      { status: OfferStatus.EXPIRED },
    );
    if (result.modifiedCount > 0) {
      this.logger.log(`Expired ${result.modifiedCount} offer(s)`);
      await this.refreshActiveOfferCounts();
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async refreshActiveOfferCounts() {
    const counts = await this.offerModel.aggregate([
      { $match: { status: OfferStatus.ACTIVE } },
      { $group: { _id: '$businessId', count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));
    const businesses = await this.businessModel.find({}, { _id: 1, activeOfferCount: 1 });
    const ops = businesses
      .filter((b) => (countMap.get(String(b._id)) || 0) !== b.activeOfferCount)
      .map((b) => ({
        updateOne: {
          filter: { _id: b._id },
          update: { activeOfferCount: countMap.get(String(b._id)) || 0 },
        },
      }));
    if (ops.length > 0) {
      await this.businessModel.bulkWrite(ops);
      this.logger.log(`Refreshed activeOfferCount for ${ops.length} business(es)`);
    }
  }
}

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([
      { name: Offer.name, schema: OfferSchema },
      { name: Business.name, schema: BusinessSchema },
    ]),
  ],
  providers: [JobsService],
})
export class JobsModule {}
