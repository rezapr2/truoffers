import { Module } from '@nestjs/common';
import { BusinessesModule } from '../businesses/businesses.module';
import {
  AdminCandidatesController,
  AdminJobsController,
  AdminOptOutsController,
  AdminProviderPoliciesController,
  AdminScraperController,
  AdminWebsitesController,
} from './controllers/admin-scraper.controllers';
import { AdminAdaptersController, AdminFingerprintsController, AdminNetworkController } from './controllers/admin-network.controllers';
import { AdminImportedOffersController, AdminRevisionsController } from './controllers/admin-recheck.controllers';
import { MerchantImportsController, RemovalRequestsController } from './controllers/merchant-imports.controller';
import { OfferLifecycleService } from './lifecycle/offer-lifecycle.service';
import { RetentionService } from './retention/retention.service';
import { AdaptersService } from './review/adapters.service';
import { CandidatesService } from './review/candidates.service';
import { FingerprintsService } from './review/fingerprints.service';
import { ImportedOffersService } from './review/imported-offers.service';
import { JobMonitoringService } from './review/job-monitoring.service';
import { MerchantImportsService } from './review/merchant-imports.service';
import { NetworksService } from './review/networks.service';
import { OptOutsService } from './review/opt-outs.service';
import { ProviderPoliciesService } from './review/provider-policies.service';
import { WebsitesService } from './review/websites.service';
import { ScraperCoreModule } from './scraper-core.module';

/**
 * API side of the scraper: intake, review, publishing, opt-outs and monitoring. It enqueues work and reads
 * results but never fetches a third-party page; crawling happens only in the worker (main-worker.ts).
 */
@Module({
  imports: [ScraperCoreModule, BusinessesModule],
  controllers: [
    AdminWebsitesController,
    AdminCandidatesController,
    AdminProviderPoliciesController,
    AdminOptOutsController,
    AdminJobsController,
    AdminScraperController,
    AdminFingerprintsController,
    AdminAdaptersController,
    AdminNetworkController,
    AdminImportedOffersController,
    AdminRevisionsController,
    MerchantImportsController,
    RemovalRequestsController,
  ],
  providers: [
    OfferLifecycleService,
    WebsitesService,
    CandidatesService,
    OptOutsService,
    ProviderPoliciesService,
    JobMonitoringService,
    AdaptersService,
    MerchantImportsService,
    FingerprintsService,
    NetworksService,
    ImportedOffersService,
    RetentionService,
  ],
  exports: [ScraperCoreModule, JobMonitoringService],
})
export class ScraperModule {}
