import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Worker } from 'bullmq';
import type Redis from 'ioredis';
import { Connection, Model, Types } from 'mongoose';
import { AuthorisationSource, DomainAuthorisationStatus, ImportJobStatus, ImportJobType } from '../../src/common/scraper.enums';
import { bullConnectionOptions } from '../../src/scraper/infra/redis';
import { RENDER_WORKER_HEARTBEAT_PREFIX, SCRAPER_QUEUES, StageJobData } from '../../src/scraper/queue/queue.constants';
import { RunsService } from '../../src/scraper/queue/runs.service';
import { StageRunner } from '../../src/scraper/queue/stage-runner.service';
import { ScraperSettingsService } from '../../src/scraper/review/scraper-settings.service';
import { RenderService } from '../../src/scraper/render/render.service';
import { fixtureNetworkPolicy } from '../../src/scraper/safety/ssrf-policy';
import { registrableDomainOf } from '../../src/scraper/safety/url';
import { ScraperWorkerModule } from '../../src/scraper/scraper-worker.module';
import { CNAME_RESOLVER, HOST_RESOLVER, NETWORK_POLICY, REDIS_CLIENT } from '../../src/scraper/scraper.tokens';
import { ExtractedOfferCandidate } from '../../src/schemas/extracted-offer-candidate.schema';
import { ImportJob } from '../../src/schemas/import-job.schema';
import { ScrapedWebsite } from '../../src/schemas/scraped-website.schema';
import { FixtureServer, startFixtureServer, testResolver } from '../helpers/fixture-server';

const HOST = 'spa-only.test';

describe('rendering JavaScript-only websites, end to end (spec §5)', () => {
  let server: FixtureServer;
  let moduleRef: TestingModule;
  let redis: Redis;
  let renderWorker: Worker<StageJobData> | undefined;
  let jobs: Model<ImportJob>;
  let sites: Model<ScrapedWebsite>;
  let candidates: Model<ExtractedOfferCandidate>;
  let runs: RunsService;
  let settings: ScraperSettingsService;

  beforeAll(async () => {
    server = await startFixtureServer();
    moduleRef = await Test.createTestingModule({ imports: [MongooseModule.forRoot(process.env.MONGODB_URI!), ScraperWorkerModule] })
      .overrideProvider(NETWORK_POLICY)
      .useValue(fixtureNetworkPolicy(new Set([HOST])))
      .overrideProvider(HOST_RESOLVER)
      .useValue(testResolver())
      .overrideProvider(CNAME_RESOLVER)
      .useValue(async () => [])
      .compile();
    redis = moduleRef.get(REDIS_CLIENT);
    const connection = moduleRef.get<Connection>(getConnectionToken());
    await connection.dropDatabase();
    await Promise.all(Object.values(connection.models).map((m) => m.syncIndexes()));
    await redis.flushdb();
    await moduleRef.init();

    jobs = moduleRef.get(getModelToken(ImportJob.name));
    sites = moduleRef.get(getModelToken(ScrapedWebsite.name));
    candidates = moduleRef.get(getModelToken(ExtractedOfferCandidate.name));
    runs = moduleRef.get(RunsService);
    settings = moduleRef.get(ScraperSettingsService);
    await settings.update({ defaultRateLimitMs: 250 });
  }, 60_000);

  afterAll(async () => {
    await renderWorker?.close();
    await moduleRef.close();
    await server.close();
  });

  async function runOnce() {
    const site = await sites.findOneAndUpdate(
      { domain: HOST },
      {
        $setOnInsert: {
          domain: HOST,
          registrableDomain: registrableDomainOf(HOST),
          seedUrl: server.url(HOST, '/'),
          authorisationStatus: DomainAuthorisationStatus.AUTHORISED,
          authorisationSource: AuthorisationSource.ADMIN_MANUAL,
          businesses: [],
        },
      },
      { upsert: true, new: true },
    );
    const { job } = await runs.startRun(site!);
    const deadline = Date.now() + 90_000;
    for (;;) {
      const stages = await jobs.find({ runId: job.runId }).sort({ createdAt: 1 }).lean();
      if (stages.some((s) => s.type === ImportJobType.RECHECK_OFFER && s.status === ImportJobStatus.COMPLETED)) return stages;
      const failed = stages.find((s) => [ImportJobStatus.FAILED, ImportJobStatus.DEAD_LETTERED].includes(s.status));
      if (failed || Date.now() > deadline) throw new Error(`Run did not finish: ${JSON.stringify(stages.map((s) => [s.type, s.status, s.errorLog, s.logs.slice(-3)]))}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  it('does not render unless an admin enabled it and a render worker is running', async () => {
    const stages = await runOnce();
    expect(stages.map((s) => s.type)).not.toContain(ImportJobType.RENDER_PAGES);
    expect(await candidates.countDocuments()).toBe(0);
  });

  it('renders the pages in a render worker and imports what the browser shows', async () => {
    await settings.update({ renderingEnabled: true });
    // What main-worker does with SCRAPER_QUEUE_ROLE=render: consume the render queue and report in.
    const runner = moduleRef.get(StageRunner);
    renderWorker = new Worker<StageJobData>(SCRAPER_QUEUES.render, (job, token) => runner.process(job, token), { connection: bullConnectionOptions(), concurrency: 1 });
    await redis.set(`${RENDER_WORKER_HEARTBEAT_PREFIX}test:${process.pid}`, new Date().toISOString(), 'EX', 300);

    const stages = await runOnce();
    const types = stages.map((s) => s.type);
    expect(types).toEqual([
      ImportJobType.ANALYSE_SEED_WEBSITE,
      ImportJobType.DISCOVER_OFFER_PAGES,
      ImportJobType.EXTRACT_BUSINESS,
      ImportJobType.EXTRACT_OFFERS,
      ImportJobType.RENDER_PAGES,
      ImportJobType.MATCH_BUSINESS,
      ImportJobType.DEDUPLICATE_OFFERS,
      ImportJobType.RECHECK_OFFER,
    ]);
    const render = stages.find((s) => s.type === ImportJobType.RENDER_PAGES)!;
    expect(render.queueName).toBe(SCRAPER_QUEUES.render);
    expect(render.resultCounts).toMatchObject({ rendered: 1 });

    const found = await candidates.find({ domain: HOST }).lean();
    const sushi = found.find((c) => /sushi sunday|25% off/i.test(c.title));
    expect(sushi).toBeDefined();
    expect(sushi!.discountPercentage).toBe(25);
    expect(sushi!.evidence.discountPercentage.text).toMatch(/25% off/);
    // The rendered page's JavaScript ran, but the only document it asked for was the page itself.
    const paths = server.requestsFor(HOST).map((r) => r.path);
    expect(paths).toContain('/app.js');
    expect(server.requestsFor(HOST).every((r) => r.userAgent?.startsWith('TruOffersBot/1.0'))).toBe(true);
    expect(moduleRef.get(RenderService).restarts).toBe(0);
    expect(new Types.ObjectId(String(render.runId))).toBeTruthy();
  });
});
