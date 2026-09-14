import type Redis from 'ioredis';
import { AuthorisationSource, DomainAuthorisationStatus } from '../../src/common/scraper.enums';
import { PageLoader, PageLoaderContext } from '../../src/scraper/pipeline/page-loader';
import { ScraperControlService } from '../../src/scraper/queue/scraper-control.service';
import { ScraperSettingsService } from '../../src/scraper/review/scraper-settings.service';
import { CrawlGateService } from '../../src/scraper/safety/crawl-gate.service';
import { DomainRegistryService } from '../../src/scraper/safety/domain-registry.service';
import { PageBudget } from '../../src/scraper/safety/page-budget.service';
import { DomainRateLimiter } from '../../src/scraper/safety/rate-limiter.service';
import { RobotsService } from '../../src/scraper/safety/robots.service';
import { FetchLimits, SafeFetchService } from '../../src/scraper/safety/safe-fetch.service';
import { fixtureNetworkPolicy } from '../../src/scraper/safety/ssrf-policy';
import { registrableDomainOf } from '../../src/scraper/safety/url';
import { testResolver } from './fixture-server';
import { testModels, syncTestIndexes, TestModels } from './models';
import { connectTestMongo, disconnectTestMongo, resetTestMongo } from './mongo';
import { createTestRedis } from './redis';

export interface SafetyHarness {
  models: TestModels;
  redis: Redis;
  fetcher: SafeFetchService;
  robots: RobotsService;
  settings: ScraperSettingsService;
  control: ScraperControlService;
  registry: DomainRegistryService;
  gate: CrawlGateService;
  rateLimiter: DomainRateLimiter;
  pageBudget: PageBudget;
  loader(ctx: Omit<PageLoaderContext, 'signal' | 'log'> & Partial<Pick<PageLoaderContext, 'signal' | 'log'>>): PageLoader;
  authorise(domain: string, extra?: Record<string, unknown>): Promise<void>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createSafetyHarness(options: {
  fixtureHosts: string[];
  resolverOverrides?: Record<string, string[]>;
  limits?: Partial<FetchLimits>;
}): Promise<SafetyHarness> {
  await connectTestMongo();
  const models = testModels();
  await syncTestIndexes(models);
  const redis = createTestRedis();

  const fetcher = new SafeFetchService(
    fixtureNetworkPolicy(new Set(options.fixtureHosts)),
    testResolver(options.resolverOverrides),
    options.limits,
  );
  const robots = new RobotsService(models.robots as any, fetcher);
  const settings = new ScraperSettingsService(models.settings as any);
  const control = new ScraperControlService(redis);
  const registry = new DomainRegistryService(models.sites as any, models.optOuts as any);
  const gate = new CrawlGateService(
    models.configs as any,
    models.policies as any,
    models.adapters as any,
    registry,
    settings,
    control,
    robots,
  );
  const rateLimiter = new DomainRateLimiter(redis);
  const pageBudget = new PageBudget(redis);

  const harness: SafetyHarness = {
    models,
    redis,
    fetcher,
    robots,
    settings,
    control,
    registry,
    gate,
    rateLimiter,
    pageBudget,
    loader: (ctx) =>
      new PageLoader(
        { fetcher, gate, robots, rateLimiter, pageBudget, settings },
        { signal: new AbortController().signal, log: () => undefined, ...ctx },
      ),
    authorise: async (domain, extra = {}) => {
      await models.sites.create({
        domain,
        registrableDomain: registrableDomainOf(domain),
        seedUrl: `http://${domain}/`,
        authorisationStatus: DomainAuthorisationStatus.AUTHORISED,
        authorisationSource: AuthorisationSource.ADMIN_MANUAL,
        ...extra,
      });
    },
    reset: async () => {
      await resetTestMongo();
      await redis.flushdb();
      settings.invalidate();
      // Fast but still spaced crawling in tests.
      await settings.update({ defaultRateLimitMs: 250 });
    },
    close: async () => {
      await control.onApplicationShutdown();
      await redis.quit();
      await disconnectTestMongo();
    },
  };
  return harness;
}
