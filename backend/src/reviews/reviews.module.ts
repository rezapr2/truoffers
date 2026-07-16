import {
  Controller,
  ForbiddenException,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Business, BusinessDocument, BusinessSchema } from '../schemas/business.schema';
import { CurrentUser } from '../common/decorators';
import { Role } from '../common/enums';

const PLACES_BASE = 'https://places.googleapis.com/v1';

// Google review sync: pulls rating + review count from the Places API into the
// business's reviews cache. Key-gated — without GOOGLE_PLACES_API_KEY the sync
// is disabled (dev mode keeps the seeded ratings).
@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    @InjectModel(Business.name) private businessModel: Model<BusinessDocument>,
  ) {}

  private get apiKey() {
    return process.env.GOOGLE_PLACES_API_KEY || '';
  }

  get enabled() {
    return this.apiKey.length > 0;
  }

  async syncBusiness(businessId: string, user: { userId: string; role: Role }) {
    const business = await this.businessModel.findById(businessId);
    if (!business) throw new NotFoundException('Business not found');
    const isAdmin = [Role.SUPER_ADMIN, Role.SUPPORT_ADMIN, Role.SALES_ADMIN].includes(user.role);
    if (!isAdmin && String(business.ownerId) !== user.userId) {
      throw new ForbiddenException('You do not manage this business');
    }
    if (!this.enabled) {
      return {
        mode: 'disabled',
        message: 'Google review sync is not configured (set GOOGLE_PLACES_API_KEY).',
        reviews: business.reviews,
      };
    }
    const updated = await this.sync(business);
    return { mode: 'google', reviews: updated.reviews };
  }

  /** Sync one business: resolve its place ID if needed, then refresh the cache. */
  private async sync(business: BusinessDocument) {
    if (!business.googlePlaceId) {
      const placeId = await this.findPlaceId(business);
      if (!placeId) {
        this.logger.warn(`No Google place found for "${business.name}" (${business.postcode})`);
        business.reviews.lastSync = new Date();
        await business.save();
        return business;
      }
      business.googlePlaceId = placeId;
    }

    const res = await fetch(
      `${PLACES_BASE}/places/${business.googlePlaceId}?fields=rating,userRatingCount`,
      { headers: { 'X-Goog-Api-Key': this.apiKey } },
    );
    if (!res.ok) {
      this.logger.warn(`Places details failed for ${business.slug}: ${res.status}`);
      return business;
    }
    const data = (await res.json()) as { rating?: number; userRatingCount?: number };
    business.reviews = {
      provider: 'google',
      rating: data.rating ?? business.reviews.rating,
      count: data.userRatingCount ?? business.reviews.count,
      lastSync: new Date(),
    };
    await business.save();
    return business;
  }

  private async findPlaceId(business: BusinessDocument): Promise<string | null> {
    const res = await fetch(`${PLACES_BASE}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': 'places.id',
      },
      body: JSON.stringify({
        textQuery: `${business.name} ${business.postcode}`,
        regionCode: 'GB',
      }),
    });
    if (!res.ok) {
      this.logger.warn(`Places text search failed for ${business.slug}: ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { places?: { id: string }[] };
    return data.places?.[0]?.id || null;
  }

  // Nightly refresh: sync the stalest businesses in modest batches to respect
  // Places API quotas.
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async nightlySync() {
    if (!this.enabled) return;
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
    const stale = await this.businessModel
      .find({
        status: 'active',
        $or: [{ 'reviews.lastSync': null }, { 'reviews.lastSync': { $lte: cutoff } }],
      })
      .sort({ 'reviews.lastSync': 1 })
      .limit(50);
    for (const business of stale) {
      try {
        await this.sync(business);
      } catch (err) {
        this.logger.warn(`Review sync failed for ${business.slug}: ${(err as Error).message}`);
      }
    }
    if (stale.length > 0) this.logger.log(`Synced Google reviews for ${stale.length} business(es)`);
  }
}

@Controller()
export class ReviewsController {
  constructor(private readonly service: ReviewsService) {}

  @Post('businesses/:id/sync-reviews')
  sync(@Param('id') id: string, @CurrentUser() user: { userId: string; role: Role }) {
    return this.service.syncBusiness(id, user);
  }
}

@Module({
  imports: [MongooseModule.forFeature([{ name: Business.name, schema: BusinessSchema }])],
  controllers: [ReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
