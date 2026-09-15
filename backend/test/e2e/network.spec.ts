import { JwtService } from '@nestjs/jwt';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import type { Server } from 'node:http';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { Role } from '../../src/common/enums';
import {
  AuditAction,
  AuthorisationSource,
  CandidateStatus,
  DomainAuthorisationStatus,
  FingerprintMatchCategory,
  ImportJobStatus,
  ImportJobType,
  OptOutSource,
  ScraperAdapterStatus,
} from '../../src/common/scraper.enums';
import { fixtureNetworkPolicy } from '../../src/scraper/safety/ssrf-policy';
import { registrableDomainOf } from '../../src/scraper/safety/url';
import { ScraperWorkerModule } from '../../src/scraper/scraper-worker.module';
import { CNAME_RESOLVER, HOST_RESOLVER, NETWORK_POLICY, REDIS_CLIENT } from '../../src/scraper/scraper.tokens';
import { AdminAuditLog } from '../../src/schemas/admin-audit-log.schema';
import { DomainOptOut } from '../../src/schemas/domain-opt-out.schema';
import { ExtractedOfferCandidate } from '../../src/schemas/extracted-offer-candidate.schema';
import { ImportJob } from '../../src/schemas/import-job.schema';
import { ScrapedWebsite } from '../../src/schemas/scraped-website.schema';
import { ScraperAdapter } from '../../src/schemas/scraper-adapter.schema';
import { FixtureServer, startFixtureServer, testResolver } from '../helpers/fixture-server';

const SITES = ['directory.saffronweb.test', 'saffron-spice.test', 'lotus-garden.test', 'kings-grill.test', 'dragon-wok.test', 'panda-noodles.test'];

describe('website network, fingerprints and selector adapters, end to end', () => {
  let server: FixtureServer;
  let app: NestExpressApplication;
  let http: Server;
  let jobs: Model<ImportJob>;
  let sites: Model<ScrapedWebsite>;
  let candidates: Model<ExtractedOfferCandidate>;
  let adapters: Model<ScraperAdapter>;
  let audit: Model<AdminAuditLog>;
  let token: string;
  const admin = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    server = await startFixtureServer();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, ScraperWorkerModule] })
      .overrideProvider(NETWORK_POLICY)
      .useValue(fixtureNetworkPolicy(new Set(SITES)))
      .overrideProvider(HOST_RESOLVER)
      .useValue(testResolver())
      .overrideProvider(CNAME_RESOLVER)
      .useValue(async () => [])
      .compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] }));
    const connection = app.get<Connection>(getConnectionToken());
    await connection.dropDatabase();
    await Promise.all(Object.values(connection.models).map((m) => m.syncIndexes()));
    await app.get<Redis>(REDIS_CLIENT).flushdb();
    await app.init();
    http = app.getHttpServer();

    jobs = app.get(getModelToken(ImportJob.name));
    sites = app.get(getModelToken(ScrapedWebsite.name));
    candidates = app.get(getModelToken(ExtractedOfferCandidate.name));
    adapters = app.get(getModelToken(ScraperAdapter.name));
    audit = app.get(getModelToken(AdminAuditLog.name));
    token = app.get(JwtService, { strict: false }).sign({ sub: String(new Types.ObjectId()), email: 'admin@example.test', role: Role.SUPER_ADMIN, name: 'Ada' });

    // Before discovery: one Saffron site is already known from a link (pending), and the decoy has opted out.
    const known = (domain: string, extra: Record<string, unknown>) =>
      sites.create({ domain, registrableDomain: registrableDomainOf(domain), seedUrl: server.url(domain, '/'), businesses: [], ...extra });
    await known('kings-grill.test', { authorisationStatus: DomainAuthorisationStatus.PENDING_AUTHORISATION, authorisationSource: AuthorisationSource.DISCOVERED_LINK, discoveredFrom: 'elsewhere.test' });
    await known('panda-noodles.test', { authorisationStatus: DomainAuthorisationStatus.PENDING_AUTHORISATION, authorisationSource: AuthorisationSource.DISCOVERED_LINK, discoveredFrom: 'elsewhere.test' });
    await app.get<Model<DomainOptOut>>(getModelToken(DomainOptOut.name)).create({ domain: 'dragon-wok.test', activeKey: 'dragon-wok.test', source: OptOutSource.ADMIN });
    await request(http).patch('/api/admin/scraper/settings').set(admin()).send({ defaultRateLimitMs: 250 }).expect(200);
  });

  afterAll(async () => {
    await app?.close();
    await server?.close();
  });

  async function waitForJob(jobId: string, timeoutMs = 60_000): Promise<ImportJob> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const job = await jobs.findById(jobId).lean();
      if (job && [ImportJobStatus.COMPLETED, ImportJobStatus.FAILED, ImportJobStatus.DEAD_LETTERED].includes(job.status)) {
        if (job.status !== ImportJobStatus.COMPLETED) throw new Error(`${job.type} ${job.status}: ${JSON.stringify(job.errorLog)} ${JSON.stringify(job.logs?.slice(-5))}`);
        return job;
      }
      if (Date.now() > deadline) throw new Error(`Job ${jobId} did not finish: ${JSON.stringify(job?.status)}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  async function waitForRun(domain: string, since: Date, timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const stages = await jobs.find({ domain, createdAt: { $gte: since }, type: { $in: [ImportJobType.ANALYSE_SEED_WEBSITE, ImportJobType.DEDUPLICATE_OFFERS] } }).lean();
      if (stages.some((s) => s.type === ImportJobType.DEDUPLICATE_OFFERS && s.status === ImportJobStatus.COMPLETED)) return;
      const failed = await jobs.findOne({ domain, createdAt: { $gte: since }, status: { $in: [ImportJobStatus.FAILED, ImportJobStatus.DEAD_LETTERED] } }).lean();
      if (failed) throw new Error(`${failed.type} failed: ${JSON.stringify(failed.errorLog)}`);
      if (Date.now() > deadline) throw new Error(`Run for ${domain} did not finish`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  const site = (domain: string) => sites.findOne({ domain }).lean();
  let networkId: string;
  let fingerprintId: string;
  let adapterKey: string;

  it('registers an authorised network and the websites its sitemap lists', async () => {
    await request(http)
      .post('/api/admin/scraper/networks')
      .set(admin())
      .send({ name: 'Saffron Web Studio clients', sitemapUrls: [server.url('directory.saffronweb.test', '/sitemap-clients.xml')], basis: 'written_agreement' })
      .expect(400);
    const created = await request(http)
      .post('/api/admin/scraper/networks')
      .set(admin())
      .send({ name: 'Saffron Web Studio clients', sitemapUrls: [server.url('directory.saffronweb.test', '/sitemap-clients.xml')], basis: 'written_agreement', agreementReference: 'SWS-2026-01' })
      .expect(201);
    networkId = created.body._id;
    expect((await site('directory.saffronweb.test'))?.authorisationStatus).toBe(DomainAuthorisationStatus.AUTHORISED);

    const discovery = await request(http).post(`/api/admin/scraper/networks/${networkId}/discover`).set(admin()).expect(201);
    const job = await waitForJob(discovery.body.jobId);
    expect(job.resultCounts).toMatchObject({ listed: 5, registered: 2, promoted: 1, skippedOptedOut: 1, skippedNeverCrawl: 1 });

    for (const domain of ['saffron-spice.test', 'lotus-garden.test']) {
      expect(await site(domain)).toMatchObject({ authorisationStatus: DomainAuthorisationStatus.AUTHORISED, authorisationSource: AuthorisationSource.NETWORK_SITEMAP });
    }
    expect((await site('kings-grill.test'))?.authorisationStatus).toBe(DomainAuthorisationStatus.AUTHORISED);
    expect(await site('dragon-wok.test')).toBeNull();
    // Linked from the directory page, not listed in the sitemap: stays pending, and the marketplace is never registered.
    expect((await site('panda-noodles.test'))?.authorisationStatus).toBe(DomainAuthorisationStatus.PENDING_AUTHORISATION);
    expect(await sites.exists({ domain: 'just-eat.co.uk' })).toBeNull();
    expect(server.requestsFor('saffron-spice.test')).toHaveLength(0);
  });

  it('builds a fingerprint and selector suggestions from two example sites, and matches a third', async () => {
    const [spice, lotus, kings] = await Promise.all(['saffron-spice.test', 'lotus-garden.test', 'kings-grill.test'].map(site));
    await request(http).post('/api/admin/scraper/fingerprints').set(admin()).send({ name: 'Saffron Theme', exampleWebsiteIds: [String(spice!._id)] }).expect(400);
    const created = await request(http)
      .post('/api/admin/scraper/fingerprints')
      .set(admin())
      .send({ name: 'Saffron Theme', exampleWebsiteIds: [String(spice!._id), String(lotus!._id)] })
      .expect(201);
    fingerprintId = created.body.fingerprint._id;
    await waitForJob(created.body.jobId);

    const detail = await request(http).get(`/api/admin/scraper/fingerprints/${fingerprintId}`).set(admin()).expect(200);
    const fingerprint = detail.body.fingerprint;
    expect(fingerprint.markers.filter((m: { required: boolean }) => m.required).map((m: { value: string }) => m.value)).toEqual(
      expect.arrayContaining(['saffron theme', 'by saffron web studio']),
    );
    expect(fingerprint.examples.map((e: { offersFound: unknown[] }) => e.offersFound.length)).toEqual([3, 2]);
    expect(fingerprint.suggestedConfig.config.offers.container).toBe('article.sf-offer-card');

    const match = await request(http).post('/api/admin/scraper/fingerprints/match').set(admin()).send({ websiteIds: [String(kings!._id)] }).expect(201);
    expect(match.body).toMatchObject({ websites: 1, queued: 1 });
    const matchJob = await jobs.findOne({ type: ImportJobType.MATCH_FINGERPRINT, domain: 'kings-grill.test' }).lean();
    await waitForJob(String(matchJob!._id));
    const matched = await site('kings-grill.test');
    expect([FingerprintMatchCategory.EXACT, FingerprintMatchCategory.HIGH_CONFIDENCE]).toContain(matched!.matchCategory);
    expect(String(matched!.fingerprintRef)).toBe(fingerprintId);

    const view = await request(http).get('/api/admin/scraper/network').query({ fingerprintId, groupBy: 'fingerprint' }).set(admin()).expect(200);
    expect(view.body.items.map((i: { domain: string }) => i.domain)).toEqual(['kings-grill.test']);
    expect(view.body.groups).toEqual([{ key: fingerprintId, count: 1 }]);
  });

  it('creates, tests and approves a selector adapter, then runs it across the network', async () => {
    const fingerprint = (await request(http).get(`/api/admin/scraper/fingerprints/${fingerprintId}`).set(admin())).body.fingerprint;
    await request(http)
      .post('/api/admin/scraper/adapters')
      .set(admin())
      .send({ name: 'Saffron Theme', fingerprintId, exampleDomains: ['saffron-spice.test'], configuration: { offers: { container: 'article[', fields: { title: { selector: 'h3' } } } } })
      .expect(400);
    const draft = await request(http)
      .post('/api/admin/scraper/adapters')
      .set(admin())
      .send({ name: 'Saffron Theme', fingerprintId, exampleDomains: ['saffron-spice.test', 'lotus-garden.test'], configuration: fingerprint.suggestedConfig.config })
      .expect(201);
    adapterKey = draft.body.key;
    expect(draft.body).toMatchObject({ version: '1', status: ScraperAdapterStatus.DRAFT, isCurrent: false });

    await request(http).post(`/api/admin/scraper/adapters/${adapterKey}/versions/1/approve`).set(admin()).expect(400);
    const test = await request(http).post(`/api/admin/scraper/adapters/${adapterKey}/versions/1/test`).set(admin()).expect(201);
    await waitForJob(test.body.jobId);
    const tested = await adapters.findOne({ key: adapterKey, version: '1' }).lean();
    expect(tested!.testResults).toMatchObject({ summary: { domains: 2, handled: 2 } });
    expect((tested!.testResults as { summary: { offers: number } }).summary.offers).toBeGreaterThanOrEqual(5);
    // A dry run creates no candidates.
    expect(await candidates.countDocuments()).toBe(0);

    await request(http).post(`/api/admin/scraper/adapters/${adapterKey}/versions/1/approve`).set(admin()).expect(201);
    await request(http).patch(`/api/admin/scraper/adapters/${adapterKey}/versions/1`).set(admin()).send({ name: 'Changed' }).expect(400);

    const kings = await site('kings-grill.test');
    const since = new Date();
    const bulk = await request(http).post('/api/admin/scraper/network/bulk').set(admin()).send({ websiteIds: [String(kings!._id)], action: 'run' }).expect(201);
    expect(bulk.body).toMatchObject({ succeeded: 1, failed: 0 });
    await waitForRun('kings-grill.test', since);

    expect(await site('kings-grill.test')).toMatchObject({ adapterId: adapterKey, adapterVersion: '1' });
    const found = await candidates.find({ domain: 'kings-grill.test' }).lean();
    const tenPercent = found.find((c) => c.title === '10% off collection orders');
    expect(tenPercent).toMatchObject({ adapterId: adapterKey, adapterVersion: '1', promoCode: 'KINGS10', minimumOrder: 12, endDate: '2030-12-31', status: CandidateStatus.PENDING_REVIEW });
    expect(tenPercent!.evidence.title.method).toBe(`selector:${adapterKey}@1:title`);
  });

  it('rolls back to no selector adapter, flags its candidates for re-extraction, and re-runs the sites', async () => {
    const v2 = await request(http).post(`/api/admin/scraper/adapters/${adapterKey}/versions/1/new-version`).set(admin()).expect(201);
    expect(v2.body).toMatchObject({ version: '2', status: ScraperAdapterStatus.DRAFT, basedOnVersion: '1' });

    const rollback = await request(http).post(`/api/admin/scraper/adapters/${adapterKey}/rollback`).set(admin()).send({ reason: 'Wrong expiry dates' }).expect(201);
    expect(rollback.body).toMatchObject({ withdrawn: '1', current: null });
    expect(rollback.body.candidatesNeedingReextraction).toBeGreaterThanOrEqual(2);
    expect(await candidates.countDocuments({ adapterId: adapterKey, status: CandidateStatus.NEEDS_REEXTRACTION })).toBe(rollback.body.candidatesNeedingReextraction);
    expect(await adapters.findOne({ key: adapterKey, version: '1' }).lean()).toMatchObject({ status: ScraperAdapterStatus.WITHDRAWN, isCurrent: false, withdrawnReason: 'Wrong expiry dates' });

    const since = new Date();
    const rerun = await request(http).post(`/api/admin/scraper/adapters/${adapterKey}/rerun`).set(admin()).send({ version: '1' }).expect(201);
    expect(rerun.body).toMatchObject({ websites: 1, runsStarted: 1 });
    await waitForRun('kings-grill.test', since);
    // With the selector adapter withdrawn the site falls back to structured data.
    expect((await site('kings-grill.test'))?.adapterId).toBe('generic-jsonld');

    const detail = await request(http).get(`/api/admin/scraper/adapters/${adapterKey}`).set(admin()).expect(200);
    expect(detail.body.versions.map((v: { version: string; status: string }) => `${v.version}:${v.status}`)).toEqual(['2:draft', '1:withdrawn']);
  });

  it('applies bulk actions and records every step in the audit log', async () => {
    const panda = await site('panda-noodles.test');
    const bulk = await request(http).post('/api/admin/scraper/network/bulk').set(admin()).send({ websiteIds: [String(panda!._id)], action: 'authorise' }).expect(201);
    expect(bulk.body.succeeded).toBe(1);
    expect((await site('panda-noodles.test'))?.authorisationStatus).toBe(DomainAuthorisationStatus.AUTHORISED);
    await request(http).post('/api/admin/scraper/network/bulk').set(admin()).send({ websiteIds: [String(panda!._id)], action: 'opt_out', reason: 'Asked us to stop' }).expect(201);
    expect((await site('panda-noodles.test'))?.authorisationStatus).toBe(DomainAuthorisationStatus.OPTED_OUT);

    const actions = new Set((await audit.find().lean()).map((entry) => entry.action));
    for (const action of [
      AuditAction.NETWORK_CREATED,
      AuditAction.NETWORK_DISCOVERY_REQUESTED,
      AuditAction.FINGERPRINT_CREATED,
      AuditAction.FINGERPRINT_MATCH_REQUESTED,
      AuditAction.ADAPTER_CREATED,
      AuditAction.ADAPTER_TEST_REQUESTED,
      AuditAction.ADAPTER_APPROVED,
      AuditAction.ADAPTER_VERSION_CREATED,
      AuditAction.ADAPTER_ROLLED_BACK,
      AuditAction.ADAPTER_RERUN_REQUESTED,
      AuditAction.WEBSITES_BULK_ACTION,
    ]) {
      expect(actions.has(action)).toBe(true);
    }
  });

  it('removes an opted-out example website’s text from the fingerprint analysis and adapter test results', async () => {
    const excerptsFor = async (domain: string) => {
      const fingerprint = (await request(http).get(`/api/admin/scraper/fingerprints/${fingerprintId}`).set(admin()).expect(200)).body.fingerprint;
      const tested = (await adapters.findOne({ key: adapterKey, version: '1' }).lean())!.testResults as { domains: { domain: string; offers: { excerpt: string }[]; businesses: object[] }[] };
      const entry = tested.domains.find((d) => d.domain === domain)!;
      return {
        example: fingerprint.examples.find((e: { domain: string }) => e.domain === domain).offersFound.map((o: { excerpt: string }) => o.excerpt),
        tested: entry.offers.map((o) => o.excerpt),
        businesses: entry.businesses,
      };
    };
    expect((await excerptsFor('lotus-garden.test')).example.every((text: string) => text.length > 0)).toBe(true);

    const optOut = await request(http).post('/api/admin/scraper/opt-outs').set(admin()).send({ domain: 'lotus-garden.test', reason: 'Owner asked' }).expect(201);
    expect(optOut.body.websites).toBe(1);

    const lotus = await excerptsFor('lotus-garden.test');
    expect(lotus.example.length).toBeGreaterThan(0);
    expect(lotus.example.every((text: string) => text === '')).toBe(true);
    expect(lotus.tested.every((text) => text === '')).toBe(true);
    expect(lotus.businesses.every((b) => Object.keys(b).every((k) => k === 'branchPath'))).toBe(true);
    const spice = await excerptsFor('saffron-spice.test');
    expect(spice.example.every((text: string) => text.length > 0)).toBe(true);
    expect(spice.tested.every((text) => text.length > 0)).toBe(true);

    const entry = await audit.findOne({ action: AuditAction.OPT_OUT_ADDED }).sort({ createdAt: -1 }).lean();
    expect(entry!.after).toMatchObject({ domain: 'lotus-garden.test', fingerprintsRedacted: 1, adapterTestsRedacted: 1 });

    // Its template traits are gone too, and asking to match it again queues nothing.
    const optedOut = await site('lotus-garden.test');
    expect(optedOut!.siteMarkers).toBeUndefined();
    expect(optedOut!.fingerprintRef).toBeUndefined();
    await request(http).post('/api/admin/scraper/fingerprints/match').set(admin()).send({ websiteIds: [String(optedOut!._id)] }).expect(400);
  });
});
