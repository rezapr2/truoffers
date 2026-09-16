import { JwtService } from '@nestjs/jwt';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import type Redis from 'ioredis';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { deriveBusinessIdentity } from '../../src/common/business-identity';
import { OfferStatus, Role, VerificationStatus } from '../../src/common/enums';
import {
  AuditAction,
  ImportJobStatus,
  ImportJobType,
  OfferManagedBy,
  OfferRevisionStatus,
  OfferVerification,
} from '../../src/common/scraper.enums';
import { RecheckSchedulerService } from '../../src/scraper/queue/recheck-scheduler.service';
import { ScraperSettingsService } from '../../src/scraper/review/scraper-settings.service';
import { fixtureNetworkPolicy } from '../../src/scraper/safety/ssrf-policy';
import { ScraperWorkerModule } from '../../src/scraper/scraper-worker.module';
import { CNAME_RESOLVER, HOST_RESOLVER, NETWORK_POLICY, REDIS_CLIENT } from '../../src/scraper/scraper.tokens';
import { AdminAuditLog } from '../../src/schemas/admin-audit-log.schema';
import { Business } from '../../src/schemas/business.schema';
import { ImportJob } from '../../src/schemas/import-job.schema';
import { OfferRevision } from '../../src/schemas/offer-revision.schema';
import { Offer } from '../../src/schemas/offer.schema';
import { ScrapedWebsite } from '../../src/schemas/scraped-website.schema';
import { User } from '../../src/schemas/user.schema';
import { FixtureServer, startFixtureServer, testResolver } from '../helpers/fixture-server';

const HOST = 'deals-diner.test';
const HOUR = 60 * 60 * 1000;

const page = (body: string) => `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>Deals Diner</title></head><body>${body}</body></html>`;
const CONTACT = `<footer><p>Deals Diner, 4 Vicar Lane, Leeds, LS2 7EX</p><p><a href="tel:01134960456">0113 496 0456</a></p></footer>`;

// What the offers page shows on the next run.
const OFFER_A_20 = '<article class="offer"><h3>20% off collection orders</h3><p>20% off collection orders over £20. Use code SAVE20.</p></article>';
const OFFER_A_25 = '<article class="offer"><h3>25% off collection orders</h3><p>25% off collection orders over £20. Use code SAVE20.</p></article>';
const OFFER_B = '<article class="offer"><h3>Free garlic bread</h3><p>Free garlic bread on orders over £25.</p></article>';
const OFFER_C = '<article class="offer"><h3>£5 off orders over £30</h3><p>Get £5 off when you spend £30 or more.</p></article>';

describe('rechecks, revisions and expiry, end to end (spec §9/§10)', () => {
  let server: FixtureServer;
  let app: NestExpressApplication;
  let http: Server;
  let jobs: Model<ImportJob>;
  let sites: Model<ScrapedWebsite>;
  let offers: Model<Offer>;
  let revisions: Model<OfferRevision>;
  let audit: Model<AdminAuditLog>;
  let scheduler: RecheckSchedulerService;
  let websiteId: string;
  let listing: { _id: Types.ObjectId; slug: string };
  let offersHtml = [OFFER_A_20, OFFER_B, OFFER_C].join('');

  const adminId = new Types.ObjectId();
  const merchantId = new Types.ObjectId();
  const tokens: Record<string, string> = {};
  const as = (who: 'admin' | 'merchant') => ({ Authorization: `Bearer ${tokens[who]}` });
  const offerNamed = (title: string) => offers.findOne({ title: new RegExp(title, 'i') }).lean();

  beforeAll(async () => {
    server = await startFixtureServer();
    server.route(HOST, '/', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page(`<h1>Deals Diner</h1><nav><a href="/offers">Offers</a></nav>${CONTACT}`));
    });
    server.route(HOST, '/offers', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page(`<h1>Our offers</h1><section>${offersHtml}</section>${CONTACT}`));
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule, ScraperWorkerModule] })
      .overrideProvider(NETWORK_POLICY)
      .useValue(fixtureNetworkPolicy(new Set([HOST])))
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
    offers = app.get(getModelToken(Offer.name));
    revisions = app.get(getModelToken(OfferRevision.name));
    audit = app.get(getModelToken(AdminAuditLog.name));
    scheduler = app.get(RecheckSchedulerService);

    const jwt = app.get(JwtService, { strict: false });
    const users = app.get<Model<User>>(getModelToken(User.name), { strict: false });
    const people = [
      { _id: adminId, name: 'Ada Admin', email: 'admin@example.test', role: Role.SUPER_ADMIN },
      { _id: merchantId, name: 'Mo Merchant', email: 'owner@deals-diner.test', role: Role.BUSINESS_OWNER },
    ];
    await users.insertMany(people);
    for (const [key, person] of [['admin', people[0]], ['merchant', people[1]]] as const) {
      tokens[key] = jwt.sign({ sub: String(person._id), email: person.email, role: person.role, name: person.name });
    }

    listing = await app.get<Model<Business>>(getModelToken(Business.name)).create({
      name: 'Deals Diner',
      slug: 'deals-diner-leeds',
      postcode: 'LS2 7EX',
      phone: '0113 496 0456',
      town: 'Leeds',
      ownerId: merchantId,
      verificationStatus: VerificationStatus.VERIFIED,
      ...deriveBusinessIdentity({ name: 'Deals Diner', postcode: 'LS2 7EX', phone: '0113 496 0456' }),
    });
    await app.get(ScraperSettingsService).update({ defaultRateLimitMs: 250 });
  });

  afterAll(async () => {
    await app?.close();
    await server?.close();
  });

  // A run ends with recheck_offer: the check applied to offers already published from the website.
  async function waitForRun(runId: string, timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const stages = await jobs.find({ runId: new Types.ObjectId(runId) }).lean();
      if (stages.some((s) => s.type === ImportJobType.RECHECK_OFFER && s.status === ImportJobStatus.COMPLETED)) return stages;
      const failed = stages.find((s) => [ImportJobStatus.FAILED, ImportJobStatus.DEAD_LETTERED, ImportJobStatus.CANCELLED].includes(s.status));
      if (failed || Date.now() > deadline) throw new Error(`Run did not finish: ${JSON.stringify(stages.map((s) => [s.type, s.status, s.errorLog]))}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  async function check() {
    const started = await request(http).post(`/api/admin/scraper/websites/${websiteId}/analyse`).set(as('admin')).expect(201);
    return waitForRun(started.body.runId);
  }

  it('imports and publishes three offers, and schedules the next check', async () => {
    const intake = await request(http).post('/api/admin/scraper/websites').set(as('admin')).send({ urls: [server.url(HOST, '/')] }).expect(201);
    websiteId = intake.body[0].websiteId;
    await waitForRun(intake.body[0].runId);

    const pending = await request(http).get('/api/admin/scraper/candidates').set(as('admin')).expect(200);
    expect(pending.body.items).toHaveLength(3);
    for (const candidate of pending.body.items) {
      await request(http).post(`/api/admin/scraper/candidates/${candidate._id}/approve`).set(as('admin')).send({ verification: 'unverified' }).expect(201);
    }
    expect(await offers.countDocuments({ status: OfferStatus.ACTIVE })).toBe(3);

    // The business takes over the £5 offer, so rechecks may never change it again.
    const fiver = await offerNamed('£5 off');
    await request(http).post(`/api/offers/${fiver!._id}/confirm`).set(as('merchant')).expect(201);

    // Published offers with no end date: checked daily (spec §10).
    const site = await sites.findById(websiteId).lean();
    expect(site!.nextCheckAt!.getTime() - Date.now()).toBeGreaterThan(23 * HOUR);
    expect(site!.nextCheckAt!.getTime() - Date.now()).toBeLessThanOrEqual(24 * HOUR);
  });

  it('turns changed terms into a revision and hides an offer the website no longer shows', async () => {
    offersHtml = OFFER_A_25;
    const stages = await check();
    const recheck = stages.find((s) => s.type === ImportJobType.RECHECK_OFFER)!;
    expect(recheck.resultCounts).toMatchObject({ possiblyRemoved: 1, merchantFlagged: 1, revisionPending: 1 });

    // Changed terms: the published offer stays public while the change waits for an admin.
    const changed = await offerNamed('20% off collection');
    expect(changed).toMatchObject({ status: OfferStatus.REVISION_PENDING, value: 20 });
    const revision = await revisions.findOne({ offerRef: changed!._id }).lean();
    expect(revision).toMatchObject({ status: OfferRevisionStatus.PENDING, detectionCount: 1 });
    expect(revision!.changedFields).toEqual(expect.arrayContaining(['value', 'title']));
    expect(revision!.proposedValues.value).toBe(25);
    await request(http).get(`/api/offers/${changed!._id}`).expect(200);

    // Absent on a page that was read: hidden from the public at once, with the listing saying so.
    const gone = await offerNamed('Free garlic bread');
    expect(gone).toMatchObject({ status: OfferStatus.POSSIBLY_REMOVED, absentChecks: 1 });
    const hidden = await request(http).get(`/api/offers/${gone!._id}`).expect(200);
    expect(hidden.body).toMatchObject({ availability: 'checking' });
    expect(hidden.body.title).toBeUndefined();
    const publicPage = await request(http).get(`/api/businesses/${listing.slug}`).expect(200);
    expect(publicPage.body.checkingAvailability).toBe(1);
    expect(publicPage.body.offers.map((o: { title: string }) => o.title)).toEqual(expect.arrayContaining(['20% off collection orders']));

    // The business manages its own offer: only the source-changed flag, never the offer itself.
    const merchantOffer = await offerNamed('£5 off');
    expect(merchantOffer).toMatchObject({ status: OfferStatus.ACTIVE, managedBy: OfferManagedBy.MERCHANT, sourceChanged: true, value: 5 });
  });

  it('sends an offer absent on two consecutive checks to expiry review', async () => {
    const stages = await check();
    expect(stages.find((s) => s.type === ImportJobType.RECHECK_OFFER)!.resultCounts).toMatchObject({ expiryReview: 1 });

    const gone = await offerNamed('Free garlic bread');
    expect(gone).toMatchObject({ status: OfferStatus.EXPIRY_REVIEW, absentChecks: 2 });
    await request(http).get(`/api/offers/${gone!._id}`).expect(404);

    // The same change found again updates the revision instead of opening another.
    const changed = await offerNamed('20% off collection');
    const revision = await revisions.findOne({ offerRef: changed!._id, status: OfferRevisionStatus.PENDING }).lean();
    expect(revision!.detectionCount).toBe(2);
    expect(await revisions.countDocuments({ offerRef: changed!._id })).toBe(1);
  });

  it('lists what needs an admin, applies the revision and decides the expiry review', async () => {
    const queues = await request(http).get('/api/admin/scraper/imported-offers/counts').set(as('admin')).expect(200);
    expect(queues.body).toMatchObject({ revision_pending: 1, expiry_review: 1, possibly_removed: 0, source_changed: 1 });

    const pending = await request(http).get('/api/admin/scraper/revisions').set(as('admin')).expect(200);
    expect(pending.body.total).toBe(1);
    const revisionId = pending.body.items[0]._id;

    const applied = await request(http)
      .post(`/api/admin/scraper/revisions/${revisionId}/apply`)
      .set(as('admin'))
      .send({ verification: 'admin_verified', note: 'Checked on the website' })
      .expect(201);
    expect(applied.body.offer).toMatchObject({ status: OfferStatus.ACTIVE, value: 25, verification: OfferVerification.ADMIN_VERIFIED });
    expect(applied.body.offer.title).toBe('25% off collection orders');
    expect((await revisions.findById(revisionId).lean())!.status).toBe(OfferRevisionStatus.APPLIED);
    const live = await request(http).get(`/api/offers/${applied.body.offer._id}`).expect(200);
    expect(live.body).toMatchObject({ value: 25, displayLabel: '25% collect' });

    const review = await request(http).get('/api/admin/scraper/imported-offers?state=expiry_review').set(as('admin')).expect(200);
    expect(review.body.items[0].title).toMatch(/garlic bread/i);
    const expired = await request(http)
      .post(`/api/admin/scraper/imported-offers/${review.body.items[0]._id}/expiry-decision`)
      .set(as('admin'))
      .send({ decision: 'expire', note: 'Gone from the website' })
      .expect(201);
    expect(expired.body.status).toBe(OfferStatus.EXPIRED);
    await request(http).get(`/api/offers/${review.body.items[0]._id}`).expect(404);

    const actions = (await audit.find().lean()).map((entry) => entry.action);
    expect(actions).toEqual(expect.arrayContaining([AuditAction.REVISION_APPLIED, AuditAction.OFFER_EXPIRY_DECIDED]));
  });

  it('republishes an offer the next check finds again', async () => {
    // The garlic bread offer is back, but an admin expired it: it returns as a new candidate, not a live offer.
    offersHtml = [OFFER_A_25, OFFER_B].join('');
    await check();
    expect(await offerNamed('Free garlic bread')).toMatchObject({ status: OfferStatus.EXPIRED });

    // Hide the applied offer, then show it again: possibly_removed -> approved, automatically.
    offersHtml = OFFER_B;
    await check();
    const hidden = await offerNamed('25% off collection');
    expect(hidden).toMatchObject({ status: OfferStatus.POSSIBLY_REMOVED, absentChecks: 1 });

    offersHtml = [OFFER_A_25, OFFER_B].join('');
    const stages = await check();
    expect(stages.find((s) => s.type === ImportJobType.RECHECK_OFFER)!.resultCounts).toMatchObject({ republished: 1 });
    const back = await offerNamed('25% off collection');
    expect(back).toMatchObject({ status: OfferStatus.ACTIVE, absentChecks: 0, verification: OfferVerification.ADMIN_VERIFIED });
    expect(back!.lastSeenAt).toBeInstanceOf(Date);
  });

  it('starts due checks and expires offers past their end date on a schedule', async () => {
    const due = new Date(Date.now() - HOUR);
    await sites.updateOne({ _id: websiteId }, { $set: { nextCheckAt: due } });
    const started = await scheduler.startDueChecks();
    expect(started).toMatchObject({ due: 1, started: 1 });
    // Pushed back so a lost run isn't restarted on every tick.
    expect((await sites.findById(websiteId).lean())!.nextCheckAt!.getTime()).toBeGreaterThan(Date.now());
    const run = await jobs.findOne({ domain: HOST, type: ImportJobType.ANALYSE_SEED_WEBSITE }).sort({ createdAt: -1 }).lean();
    await waitForRun(String(run!.runId));

    const live = await offerNamed('25% off collection');
    await offers.updateOne({ _id: live!._id }, { $set: { endsAt: new Date(Date.now() - HOUR) } });
    expect(await scheduler.queueStaleOfferReview()).toEqual({ queued: true });
    const stale = await jobs.findOne({ type: ImportJobType.REVIEW_STALE_OFFER }).sort({ createdAt: -1 }).lean();
    const deadline = Date.now() + 30_000;
    for (;;) {
      const job = await jobs.findById(stale!._id).lean();
      if (job!.status === ImportJobStatus.COMPLETED) break;
      if (Date.now() > deadline) throw new Error(`review_stale_offer did not finish: ${job!.status}`);
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(await offerNamed('25% off collection')).toMatchObject({ status: OfferStatus.EXPIRED });
    expect(await scheduler.queueStaleOfferReview()).toEqual({ queued: false });
  });
});
