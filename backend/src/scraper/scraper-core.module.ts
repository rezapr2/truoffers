import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminAuditLog, AdminAuditLogSchema } from '../schemas/admin-audit-log.schema';
import { Business, BusinessSchema } from '../schemas/business.schema';
import { DomainCrawlConfig, DomainCrawlConfigSchema } from '../schemas/domain-crawl-config.schema';
import { DomainOptOut, DomainOptOutSchema } from '../schemas/domain-opt-out.schema';
import {
  ExtractedOfferCandidate,
  ExtractedOfferCandidateSchema,
} from '../schemas/extracted-offer-candidate.schema';
import { ImportJob, ImportJobSchema } from '../schemas/import-job.schema';
import { Offer, OfferSchema } from '../schemas/offer.schema';
import { ProviderPolicy, ProviderPolicySchema } from '../schemas/provider-policy.schema';
import { RobotsCache, RobotsCacheSchema } from '../schemas/robots-cache.schema';
import { ScrapedWebsite, ScrapedWebsiteSchema } from '../schemas/scraped-website.schema';
import { ScraperAdapter, ScraperAdapterSchema } from '../schemas/scraper-adapter.schema';
import { ScraperSettings, ScraperSettingsSchema } from '../schemas/scraper-settings.schema';
import { AuthorisedNetwork, AuthorisedNetworkSchema } from '../schemas/authorised-network.schema';
import { WebsiteFingerprint, WebsiteFingerprintSchema } from '../schemas/website-fingerprint.schema';
import { AuditService } from './audit/audit.service';
import { RedisShutdown, redisClientProvider } from './infra/redis';
import { ImportJobsService } from './queue/import-jobs.service';
import { RunsService } from './queue/runs.service';
import { ScraperControlService } from './queue/scraper-control.service';
import { ScraperQueueService } from './queue/scraper-queue.service';
import { ScraperSettingsService } from './review/scraper-settings.service';
import { DomainRegistryService } from './safety/domain-registry.service';

export const SCRAPER_MODELS = MongooseModule.forFeature([
  { name: AdminAuditLog.name, schema: AdminAuditLogSchema },
  { name: Business.name, schema: BusinessSchema },
  { name: DomainCrawlConfig.name, schema: DomainCrawlConfigSchema },
  { name: DomainOptOut.name, schema: DomainOptOutSchema },
  { name: ExtractedOfferCandidate.name, schema: ExtractedOfferCandidateSchema },
  { name: ImportJob.name, schema: ImportJobSchema },
  { name: Offer.name, schema: OfferSchema },
  { name: ProviderPolicy.name, schema: ProviderPolicySchema },
  { name: RobotsCache.name, schema: RobotsCacheSchema },
  { name: ScrapedWebsite.name, schema: ScrapedWebsiteSchema },
  { name: ScraperAdapter.name, schema: ScraperAdapterSchema },
  { name: ScraperSettings.name, schema: ScraperSettingsSchema },
  { name: WebsiteFingerprint.name, schema: WebsiteFingerprintSchema },
  { name: AuthorisedNetwork.name, schema: AuthorisedNetworkSchema },
]);

// Shared by the API and the worker: models, Redis, queues, run control, settings and the audit log.
@Module({
  imports: [SCRAPER_MODELS],
  providers: [
    redisClientProvider,
    RedisShutdown,
    AuditService,
    DomainRegistryService,
    ImportJobsService,
    RunsService,
    ScraperControlService,
    ScraperQueueService,
    ScraperSettingsService,
  ],
  exports: [
    SCRAPER_MODELS,
    redisClientProvider,
    AuditService,
    DomainRegistryService,
    ImportJobsService,
    RunsService,
    ScraperControlService,
    ScraperQueueService,
    ScraperSettingsService,
  ],
})
export class ScraperCoreModule {}
