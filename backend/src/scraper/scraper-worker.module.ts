import { Module } from '@nestjs/common';
import { AdapterRegistry } from './extraction/adapter-registry.service';
import { AnthropicAiOfferExtractor } from './extraction/ai/anthropic-offer-extractor';
import { NullAiOfferExtractor } from './extraction/ai/ai-offer-extractor';
import { RecheckService } from './lifecycle/recheck.service';
import { BusinessMatcherService } from './matching/business-matcher.service';
import { NetworkJobsService } from './pipeline/network-jobs.service';
import { PipelineService } from './pipeline/pipeline.service';
import { RecheckSchedulerService } from './queue/recheck-scheduler.service';
import { ScraperWorkerService } from './queue/scraper-worker.service';
import { StageRunner } from './queue/stage-runner.service';
import { CrawlGateService } from './safety/crawl-gate.service';
import { networkPolicyFromEnv } from './safety/fixture-hosts';
import { PageBudget } from './safety/page-budget.service';
import { systemResolver } from './safety/pinned-lookup';
import { ProviderDetectionService, systemCnameResolver } from './safety/provider-detection.service';
import { DomainRateLimiter } from './safety/rate-limiter.service';
import { RobotsService } from './safety/robots.service';
import { SafeFetchService } from './safety/safe-fetch.service';
import { SitemapService } from './safety/sitemap.service';
import { ScraperCoreModule } from './scraper-core.module';
import { AI_OFFER_EXTRACTOR, CNAME_RESOLVER, HOST_RESOLVER, NETWORK_POLICY } from './scraper.tokens';

// The crawler. Only the worker process imports this module: the API never fetches third-party sites.
@Module({
  imports: [ScraperCoreModule],
  providers: [
    // SECURITY: strict public-address policy unless SCRAPER_FIXTURE_HOSTS lists .test fixture hosts,
    // which loadFixtureHosts refuses in production.
    { provide: NETWORK_POLICY, useFactory: () => networkPolicyFromEnv() },
    { provide: HOST_RESOLVER, useValue: systemResolver },
    { provide: CNAME_RESOLVER, useValue: systemCnameResolver },
    {
      provide: AI_OFFER_EXTRACTOR,
      useFactory: () => (process.env.ANTHROPIC_API_KEY ? new AnthropicAiOfferExtractor() : new NullAiOfferExtractor()),
    },
    SafeFetchService,
    RobotsService,
    SitemapService,
    DomainRateLimiter,
    PageBudget,
    ProviderDetectionService,
    CrawlGateService,
    AdapterRegistry,
    BusinessMatcherService,
    RecheckService,
    PipelineService,
    NetworkJobsService,
    StageRunner,
    ScraperWorkerService,
    RecheckSchedulerService,
  ],
  exports: [StageRunner, PipelineService, RecheckService, RecheckSchedulerService],
})
export class ScraperWorkerModule {}
