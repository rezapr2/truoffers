import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { BusinessesModule } from './businesses/businesses.module';
import { OffersModule } from './offers/offers.module';
import { SearchModule } from './search/search.module';
import { CategoriesModule } from './categories/categories.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { BillingModule } from './billing/billing.module';
import { AdsModule } from './ads/ads.module';
import { AiModule } from './ai/ai.module';
import { QrModule } from './qr/qr.module';
import { ReviewsModule } from './reviews/reviews.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AdminModule } from './admin/admin.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { JwtAuthGuard, RolesGuard } from './common/guards';
import { ActorContextInterceptor, ActorContextMiddleware } from './common/actor-context';
import { ScraperModule } from './scraper/scraper.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get('MONGODB_URI') || 'mongodb://localhost:27017/truoffers',
      }),
    }),
    // Rate limiting: 100 requests / 60s per IP (analytics events excluded via skipIf below)
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    AuthModule,
    UsersModule,
    BusinessesModule,
    OffersModule,
    SearchModule,
    CategoriesModule,
    SuppliersModule,
    BillingModule,
    AdsModule,
    AiModule,
    QrModule,
    ReviewsModule,
    AnalyticsModule,
    AdminModule,
    HealthModule,
    JobsModule,
    ScraperModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Who is acting (admin, merchant, public) for the offer lifecycle guard and the audit log.
    { provide: APP_INTERCEPTOR, useClass: ActorContextInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ActorContextMiddleware).forRoutes('*');
  }
}
