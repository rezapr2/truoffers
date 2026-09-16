import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type Redis from 'ioredis';
import { Connection, Model, Types } from 'mongoose';
import { deriveBusinessIdentity } from '../../src/common/business-identity';
import {
  AuthorisationSource,
  BranchMatchStatus,
  CandidateStatus,
  DomainAuthorisationStatus,
  ImportJobStatus,
  ImportJobType,
  ProviderPolicyStatus,
} from '../../src/common/scraper.enums';
import { botUserAgent } from '../../src/scraper/scraper.constants';
import { RunsService } from '../../src/scraper/queue/runs.service';
import { ScraperQueueService } from '../../src/scraper/queue/scraper-queue.service';
import { ScraperSettingsService } from '../../src/scraper/review/scraper-settings.service';
import { fixtureNetworkPolicy } from '../../src/scraper/safety/ssrf-policy';
import { registrableDomainOf } from '../../src/scraper/safety/url';
import { ScraperWorkerModule } from '../../src/scraper/scraper-worker.module';
import { CNAME_RESOLVER, HOST_RESOLVER, NETWORK_POLICY, REDIS_CLIENT } from '../../src/scraper/scraper.tokens';
import { Business } from '../../src/schemas/business.schema';
import { DomainCrawlConfig } from '../../src/schemas/domain-crawl-config.schema';
import { ExtractedOfferCandidate } from '../../src/schemas/extracted-offer-candidate.schema';
import { ImportJob } from '../../src/schemas/import-job.schema';
import { Offer } from '../../src/schemas/offer.schema';
import { ProviderPolicy } from '../../src/schemas/provider-policy.schema';
import { ScrapedWebsite } from '../../src/schemas/scraped-website.schema';
import { EVIDENCED_OFFER_FIELDS } from '../../src/scraper/extraction/adapter.types';
import { FixtureServer, startFixtureServer, testResolver } from '../helpers/fixture-server';

const SITES = ['pizza-palace.test', 'curry-house.test', 'kebab-king.test', 'ordernest-bella.test', 'pizza-palace-friends.test'];
const STAGE_ORDER = [
  ImportJobType.ANALYSE_SEED_WEBSITE,
  ImportJobType.DISCOVER_OFFER_PAGES,
  ImportJobType.EXTRACT_BUSINESS,
  ImportJobType.EXTRACT_OFFERS,
  ImportJobType.MATCH_BUSINESS,
  ImportJobType.DEDUPLICATE_OFFERS,
  ImportJobType.RECHECK_OFFER,
];

describe('scraping pipeline, end to end', () => {
  let server: FixtureServer;
  let moduleRef: TestingModule;
  let runs: RunsService;
  let queues: ScraperQueueService;
  let redis: Redis;
  let jobs: Model<ImportJob>;
  let sites: Model<ScrapedWebsite>;
  let candidates: Model<ExtractedOfferCandidate>;
  let offers: Model<Offer>;
  let businesses: Model<Business>;
  let configs: Model<DomainCrawlConfig>;
  let policies: Model<ProviderPolicy>;

  beforeAll(async () => {
    server = await startFixtureServer();
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(process.env.MONGODB_URI!), ScraperWorkerModule],
    })
      .overrideProvider(NETWORK_POLICY)
      .useValue(fixtureNetworkPolicy(new Set(SITES)))
      .overrideProvider(HOST_RESOLVER)
      .useValue(testResolver())
      .overrideProvider(CNAME_RESOLVER)
      .useValue(async () => [])
      .compile();

    runs = moduleRef.get(RunsService);
    queues = moduleRef.get(ScraperQueueService);
    redis = moduleRef.get(REDIS_CLIENT);
    jobs = moduleRef.get(getModelToken(ImportJob.name));
    sites = moduleRef.get(getModelToken(ScrapedWebsite.name));
    candidates = moduleRef.get(getModelToken(ExtractedOfferCandidate.name));
    offers = moduleRef.get(getModelToken(Offer.name));
    businesses = moduleRef.get(getModelToken(Business.name));
    configs = moduleRef.get(getModelToken(DomainCrawlConfig.name));
    policies = moduleRef.get(getModelToken(ProviderPolicy.name));

    const connection = moduleRef.get<Connection>(getConnectionToken());
    await connection.dropDatabase();
    await Promise.all(Object.values(connection.models).map((m) => m.syncIndexes()));
    await redis.flushdb();
    await moduleRef.init();
  });

  afterAll(async () => {
    await moduleRef.close();
    await server.close();
  });

  beforeEach(async () => {
    server.reset();
    const connection = moduleRef.get<Connection>(getConnectionToken());
    for (const name of ['importjobs', 'scrapedwebsites', 'extractedoffercandidates', 'offers', 'businesses', 'domaincrawlconfigs', 'providerpolicies', 'robotscaches', 'domainoptouts']) {
      await connection.collection(name).deleteMany({});
    }
    for (const key of await redis.keys('scraper:*')) await redis.del(key);
    await queues.resumeAll();
    const settings = moduleRef.get(ScraperSettingsService);
    await settings.update({ defaultRateLimitMs: 250 });
  });

  const authorise = (domain: string, extra: Record<string, unknown> = {}) =>
    sites.create({
      domain,
      registrableDomain: registrableDomainOf(domain),
      seedUrl: server.url(domain, '/'),
      authorisationStatus: DomainAuthorisationStatus.AUTHORISED,
      authorisationSource: AuthorisationSource.ADMIN_MANUAL,
      ...extra,
    });

  async function waitForRun(runId: Types.ObjectId, until: (stages: ImportJob[]) => boolean, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const stages = await jobs.find({ runId }).sort({ createdAt: 1 }).lean();
      if (until(stages)) return stages;
      if (Date.now() > deadline) {
        throw new Error(`Run did not settle: ${JSON.stringify(stages.map((s) => ({ type: s.type, status: s.status, logs: s.logs.slice(-3), errors: s.errorLog })))}`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const finished = (stages: ImportJob[]) =>
    stages.some((s) => s.type === ImportJobType.RECHECK_OFFER && s.status === ImportJobStatus.COMPLETED) ||
    stages.some((s) => [ImportJobStatus.FAILED, ImportJobStatus.DEAD_LETTERED, ImportJobStatus.CANCELLED].includes(s.status)) ||
    stages.some((s) => s.status === ImportJobStatus.COMPLETED && (s.resultCounts as Record<string, number>)?.held);

  it('runs every stage, matches the business and queues evidenced candidates without publishing anything', async () => {
    const listing = await businesses.create({
      name: 'Pizza Palace',
      slug: 'pizza-palace-leeds',
      postcode: 'LS1 4AP',
      phone: '0113 496 0123',
      ...deriveBusinessIdentity({ name: 'Pizza Palace', postcode: 'LS1 4AP', phone: '0113 496 0123' }),
    });
    const site = await authorise('pizza-palace.test');

    const { job, created } = await runs.startRun(site);
    expect(created).toBe(true);
    const stages = await waitForRun(job.runId, finished);

    expect(stages.map((s) => s.type)).toEqual(STAGE_ORDER);
    expect(stages.every((s) => s.status === ImportJobStatus.COMPLETED)).toBe(true);
    expect(stages.every((s) => s.output === undefined && s.activeKey === undefined)).toBe(true);

    const stored = await sites.findById(site._id).lean();
    expect(stored).toMatchObject({ adapterId: 'generic-jsonld', adapterVersion: '1.0.0', failureCount: 0, robots: { status: 'ok' } });
    expect(stored!.businesses).toHaveLength(1);
    expect(stored!.businesses[0]).toMatchObject({
      branchPath: '/',
      matchStatus: BranchMatchStatus.AUTO_MATCHED,
      businessRef: listing._id,
    });

    const discovered = await sites.findOne({ domain: 'pizza-palace-friends.test' }).lean();
    expect(discovered?.authorisationStatus).toBe(DomainAuthorisationStatus.PENDING_AUTHORISATION);
    expect(await sites.exists({ domain: 'facebook.com' })).toBeNull();
    expect(server.requestsFor('pizza-palace-friends.test')).toHaveLength(0);

    const found = await candidates.find({ scrapedWebsiteRef: site._id }).lean();
    expect(found.length).toBeGreaterThanOrEqual(5);
    const titles = found.map((c) => c.title);
    expect(titles.join(' | ')).toMatch(/20% off online orders/);
    for (const candidate of found) {
      expect(candidate).toMatchObject({ adapterId: 'generic-jsonld', adapterVersion: '1.0.0', domain: 'pizza-palace.test' });
      for (const field of EVIDENCED_OFFER_FIELDS) {
        const value = (candidate as any)[field];
        if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) continue;
        expect(candidate.evidence[field]?.text).toBeTruthy();
      }
    }
    const christmas = found.find((c) => /mince pie/i.test(c.title));
    expect(christmas?.status).toBe(CandidateStatus.FAILED_EXTRACTION);
    expect(christmas?.confidenceScore).toBeLessThan(40);
    const structured = found.find((c) => /20% off online orders/.test(c.title));
    expect(structured?.status).toBe(CandidateStatus.PENDING_REVIEW);
    expect(structured?.confidenceScore).toBeGreaterThanOrEqual(70);

    expect(await offers.countDocuments()).toBe(0);

    const requested = server.requestsFor('pizza-palace.test');
    expect(requested.every((r) => r.userAgent === botUserAgent())).toBe(true);
    const paths = requested.map((r) => r.path.split('?')[0]);
    expect(paths).not.toContain('/login');
    expect(paths).not.toContain('/basket');
    const pageFetches = paths.filter((p) => p !== '/robots.txt');
    expect(new Set(pageFetches).size).toBe(pageFetches.length);
  });

  it('merges a second run into the same candidates instead of duplicating them', async () => {
    const site = await authorise('curry-house.test');
    const first = await runs.startRun(site);
    await waitForRun(first.job.runId, finished);
    const before = await candidates.find({ scrapedWebsiteRef: site._id }).lean();
    expect(before.length).toBeGreaterThanOrEqual(5);
    // The site had no matching listing, so the branch waits for an admin.
    expect((await sites.findById(site._id).lean())!.businesses[0].matchStatus).toBe(BranchMatchStatus.NEW_BUSINESS_PROPOSED);

    const second = await runs.startRun(site);
    await waitForRun(second.job.runId, finished);
    const after = await candidates.find({ scrapedWebsiteRef: site._id }).lean();
    expect(after).toHaveLength(before.length);
    expect(after.every((c) => String(c.runRef) === String(second.job.runId))).toBe(true);
  });

  it('does not start a second run for a website while one is active', async () => {
    const site = await authorise('kebab-king.test');
    await configs.create({ domain: 'kebab-king.test', rateLimitMs: 1_000 });
    const first = await runs.startRun(site);
    const again = await runs.startRun(site);
    expect(again.created).toBe(false);
    expect(String(again.job.runId)).toBe(String(first.job.runId));
    await runs.cancelRun(String(first.job.runId));
  });

  it('cancels a run cooperatively: no further requests and no candidates', async () => {
    const site = await authorise('kebab-king.test');
    await configs.create({ domain: 'kebab-king.test', rateLimitMs: 1_500 });
    const { job } = await runs.startRun(site);
    await waitForRun(job.runId, (stages) => stages.some((s) => s.type === ImportJobType.EXTRACT_BUSINESS));

    await runs.cancelRun(String(job.runId));
    const stages = await waitForRun(job.runId, (all) => all.every((s) => s.status !== ImportJobStatus.RUNNING && s.status !== ImportJobStatus.QUEUED && s.status !== ImportJobStatus.DELAYED));
    expect(stages.some((s) => s.status === ImportJobStatus.CANCELLED)).toBe(true);
    const requestsAtCancel = server.requestsFor('kebab-king.test').length;
    await new Promise((r) => setTimeout(r, 3_000));
    expect(server.requestsFor('kebab-king.test').length).toBe(requestsAtCancel);
    expect(await candidates.countDocuments({ scrapedWebsiteRef: site._id })).toBe(0);
    expect(stages.map((s) => s.type)).not.toContain(ImportJobType.DEDUPLICATE_OFFERS);
  });

  it('halts everything on emergency stop and carries on after resume', async () => {
    const site = await authorise('curry-house.test');
    await configs.create({ domain: 'curry-house.test', rateLimitMs: 1_000 });
    const { job } = await runs.startRun(site);
    await waitForRun(job.runId, (stages) => stages.some((s) => s.type === ImportJobType.DISCOVER_OFFER_PAGES));

    await runs.emergencyStop();
    expect(await queues.isPaused()).toBe(true);
    await new Promise((r) => setTimeout(r, 1_500));
    const requestsWhileHalted = server.requestsFor('curry-house.test').length;
    await new Promise((r) => setTimeout(r, 2_500));
    expect(server.requestsFor('curry-house.test').length).toBe(requestsWhileHalted);

    await runs.resume();
    // Halted jobs re-check a minute later; promote them now to keep the test short.
    for (const name of ['scraper-fetch', 'scraper-process']) {
      for (const delayed of await queues.queue(name).getDelayed()) await delayed.promote();
    }
    const stages = await waitForRun(job.runId, finished, 90_000);
    expect(stages.map((s) => s.type)).toEqual(STAGE_ORDER);
  });

  it('holds sites whose ordering provider has no allowed policy, after fetching only the homepage', async () => {
    await policies.create({ name: 'OrderNest', status: ProviderPolicyStatus.UNKNOWN, detection: { generatorPatterns: ['OrderNest Sites'] } });
    const site = await authorise('ordernest-bella.test');
    const { job } = await runs.startRun(site);
    const stages = await waitForRun(job.runId, finished);

    expect(stages).toHaveLength(1);
    expect(stages[0].logs.map((l) => l.message).join(' ')).toMatch(/held for provider review/);
    expect((await sites.findById(site._id).lean())?.authorisationStatus).toBe(DomainAuthorisationStatus.AWAITING_PROVIDER_REVIEW);
    expect(server.requestsFor('ordernest-bella.test').map((r) => r.path)).toEqual(['/robots.txt', '/']);
    expect(await candidates.countDocuments()).toBe(0);
  });

  it('never contacts a domain that is pending authorisation', async () => {
    const site = await authorise('pizza-palace-friends.test', { authorisationStatus: DomainAuthorisationStatus.PENDING_AUTHORISATION });
    const { job } = await runs.startRun(site);
    const stages = await waitForRun(job.runId, finished);
    expect(stages[0].status).toBe(ImportJobStatus.FAILED);
    expect(stages[0].errorLog[0].message).toMatch(/awaiting admin authorisation/);
    expect(server.requestsFor('pizza-palace-friends.test')).toHaveLength(0);
  });
});
