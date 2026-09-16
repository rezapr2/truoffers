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
  IMPORT_RUN_STAGES,
  CandidateStatus,
  DomainAuthorisationStatus,
  ImportJobStatus,
  ImportJobType,
  OfferManagedBy,
  OfferOrigin,
  OfferVerification,
} from '../../src/common/scraper.enums';
import { SCRAPER_QUEUES } from '../../src/scraper/queue/queue.constants';
import { ScraperQueueService } from '../../src/scraper/queue/scraper-queue.service';
import { fixtureNetworkPolicy } from '../../src/scraper/safety/ssrf-policy';
import { ScraperWorkerModule } from '../../src/scraper/scraper-worker.module';
import { CNAME_RESOLVER, HOST_RESOLVER, NETWORK_POLICY, REDIS_CLIENT } from '../../src/scraper/scraper.tokens';
import { AdminAuditLog } from '../../src/schemas/admin-audit-log.schema';
import { Business } from '../../src/schemas/business.schema';
import { DomainOptOut } from '../../src/schemas/domain-opt-out.schema';
import { ExtractedOfferCandidate } from '../../src/schemas/extracted-offer-candidate.schema';
import { ImportJob } from '../../src/schemas/import-job.schema';
import { Offer } from '../../src/schemas/offer.schema';
import { ScrapedWebsite } from '../../src/schemas/scraped-website.schema';
import { User } from '../../src/schemas/user.schema';
import { FixtureServer, startFixtureServer, testResolver } from '../helpers/fixture-server';

const SITES = ['pizza-palace.test', 'pizza-palace-friends.test', 'curry-house.test'];

describe('scraper API, end to end', () => {
  let server: FixtureServer;
  let app: NestExpressApplication;
  let http: Server;
  let jwt: JwtService;
  let jobs: Model<ImportJob>;
  let sites: Model<ScrapedWebsite>;
  let candidates: Model<ExtractedOfferCandidate>;
  let offers: Model<Offer>;
  let optOuts: Model<DomainOptOut>;
  let audit: Model<AdminAuditLog>;
  let listing: { _id: Types.ObjectId; slug: string };

  const adminId = new Types.ObjectId();
  const merchantId = new Types.ObjectId();
  const strangerId = new Types.ObjectId();
  const tokens: Record<string, string> = {};
  const as = (who: 'admin' | 'merchant' | 'stranger') => ({ Authorization: `Bearer ${tokens[who]}` });

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
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] }));

    const connection = app.get<Connection>(getConnectionToken());
    await connection.dropDatabase();
    await Promise.all(Object.values(connection.models).map((m) => m.syncIndexes()));
    await app.get<Redis>(REDIS_CLIENT).flushdb();
    await app.init();
    http = app.getHttpServer();

    jobs = app.get(getModelToken(ImportJob.name));
    sites = app.get(getModelToken(ScrapedWebsite.name));
    candidates = app.get(getModelToken(ExtractedOfferCandidate.name));
    offers = app.get(getModelToken(Offer.name));
    optOuts = app.get(getModelToken(DomainOptOut.name));
    audit = app.get(getModelToken(AdminAuditLog.name));

    jwt = app.get(JwtService, { strict: false });
    const users = app.get<Model<User>>(getModelToken(User.name), { strict: false });
    const people = [
      { _id: adminId, name: 'Ada Admin', email: 'admin@example.test', role: Role.SUPER_ADMIN },
      { _id: merchantId, name: 'Mo Merchant', email: 'owner@pizza-palace.test', role: Role.BUSINESS_OWNER },
      { _id: strangerId, name: 'Sam Stranger', email: 'owner@elsewhere.test', role: Role.BUSINESS_OWNER },
    ];
    await users.insertMany(people);
    for (const [key, person] of [['admin', people[0]], ['merchant', people[1]], ['stranger', people[2]]] as const) {
      tokens[key] = jwt.sign({ sub: String(person._id), email: person.email, role: person.role, name: person.name });
    }

    const businesses = app.get<Model<Business>>(getModelToken(Business.name));
    listing = await businesses.create({
      name: 'Pizza Palace',
      slug: 'pizza-palace-leeds',
      postcode: 'LS1 4AP',
      phone: '0113 496 0123',
      ownerId: merchantId,
      verificationStatus: VerificationStatus.VERIFIED,
      ...deriveBusinessIdentity({ name: 'Pizza Palace', postcode: 'LS1 4AP', phone: '0113 496 0123' }),
    });
  });

  afterAll(async () => {
    await app?.close();
    await server?.close();
  });

  async function waitForRun(runId: string, timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const stages = await jobs.find({ runId: new Types.ObjectId(runId) }).lean();
      const done = stages.some((s) => s.type === ImportJobType.RECHECK_OFFER && s.status === ImportJobStatus.COMPLETED);
      const failed = stages.find((s) => [ImportJobStatus.FAILED, ImportJobStatus.DEAD_LETTERED, ImportJobStatus.CANCELLED].includes(s.status));
      if (done) return stages;
      if (failed || Date.now() > deadline) throw new Error(`Run did not complete: ${JSON.stringify(stages.map((s) => [s.type, s.status, s.errorLog]))}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  const auditActions = async () => (await audit.find().lean()).map((entry) => entry.action);

  it('keeps admin routes away from anonymous callers and merchants', async () => {
    await request(http).get('/api/admin/scraper/candidates').expect(401);
    await request(http).get('/api/admin/scraper/candidates').set(as('merchant')).expect(403);
    await request(http).post('/api/admin/scraper/jobs/emergency-stop').set(as('merchant')).expect(403);
  });

  it('updates settings with an audit entry and validates them', async () => {
    await request(http).patch('/api/admin/scraper/settings').set(as('admin')).send({ defaultRateLimitMs: 100 }).expect(400);
    const res = await request(http).patch('/api/admin/scraper/settings').set(as('admin')).send({ defaultRateLimitMs: 250 }).expect(200);
    expect(res.body).toMatchObject({ defaultRateLimitMs: 250, aiExtractionEnabled: false, renderingEnabled: false });
    const current = await request(http).get('/api/admin/scraper/settings').set(as('admin')).expect(200);
    expect(current.body).toMatchObject({ renderWorkers: 0 });
    expect(await auditActions()).toContain(AuditAction.SETTINGS_UPDATED);
  });

  it('refuses a provider client list without an allowed written-agreement policy', async () => {
    const policy = await request(http).post('/api/admin/scraper/provider-policies').set(as('admin')).send({ name: 'OrderNest' }).expect(201);
    await request(http)
      .patch(`/api/admin/scraper/provider-policies/${policy.body._id}`)
      .set(as('admin'))
      .send({ status: 'allowed' })
      .expect(400);
    const res = await request(http)
      .post('/api/admin/scraper/websites/provider-client-list')
      .set(as('admin'))
      .field('providerPolicyId', policy.body._id)
      .attach('file', Buffer.from('url\nhttps://bella.ordernest.test/\n'), 'clients.csv')
      .expect(400);
    expect(res.body.message).toMatch(/written agreement/);
    expect(await sites.countDocuments({ domain: 'bella.ordernest.test' })).toBe(0);
  });

  let runId: string;

  it('accepts submitted websites, rejects marketplaces and crawls the authorised one', async () => {
    const res = await request(http)
      .post('/api/admin/scraper/websites/csv')
      .set(as('admin'))
      .attach('file', Buffer.from(`website\n${server.url('pizza-palace.test', '/')}\nhttps://www.just-eat.co.uk/restaurants-x\nnot a url\n`), 'sites.csv')
      .expect(201);
    expect(res.body).toHaveLength(3);
    expect(res.body[0]).toMatchObject({ domain: 'pizza-palace.test', outcome: 'queued' });
    expect(res.body[1]).toMatchObject({ outcome: 'rejected' });
    expect(res.body[2]).toMatchObject({ outcome: 'rejected' });
    runId = res.body[0].runId;

    const again = await request(http).post('/api/admin/scraper/websites').set(as('admin')).send({ urls: [server.url('pizza-palace.test', '/')] }).expect(201);
    expect(again.body[0]).toMatchObject({ outcome: 'already_running', runId });

    await waitForRun(runId);
    const run = await request(http).get(`/api/admin/scraper/jobs/runs/${runId}`).set(as('admin')).expect(200);
    expect(run.body.stages).toHaveLength(IMPORT_RUN_STAGES.length);
    expect(run.body.stages.every((s: ImportJob) => s.status === ImportJobStatus.COMPLETED)).toBe(true);

    // Links to other sites are recorded for authorisation, never crawled.
    const pending = await request(http).get('/api/admin/scraper/websites').query({ status: 'pending_authorisation' }).set(as('admin')).expect(200);
    expect(pending.body.items.map((s: ScrapedWebsite) => s.domain)).toContain('pizza-palace-friends.test');
    expect(server.requestsFor('pizza-palace-friends.test')).toHaveLength(0);
    expect(await auditActions()).toContain(AuditAction.WEBSITE_SUBMITTED);
  });

  const approvable: string[] = [];

  it('shows candidates with evidence and publishes nothing before review', async () => {
    const list = await request(http).get('/api/admin/scraper/candidates').set(as('admin')).expect(200);
    expect(list.body.total).toBeGreaterThanOrEqual(4);
    for (const item of list.body.items) {
      const detail = await request(http).get(`/api/admin/scraper/candidates/${item._id}`).set(as('admin')).expect(200);
      const candidate = detail.body.candidate;
      expect(candidate.sources.length).toBeGreaterThan(0);
      expect(candidate.sources.every((s: { excerpt: string }) => s.excerpt.length <= 500)).toBe(true);
      expect(candidate.evidence.title?.text).toBeTruthy();
      if (detail.body.canApprove) approvable.push(item._id);
    }
    expect(approvable.length).toBeGreaterThanOrEqual(4);
    expect(await offers.countDocuments()).toBe(0);

    const overview = await request(http).get('/api/admin/scraper/overview').set(as('admin')).expect(200);
    expect(overview.body.candidatesAwaitingReview).toBe(list.body.total);
    expect(overview.body.domainsPendingAuthorisation).toBeGreaterThanOrEqual(1);
  });

  let unverifiedOfferId: string;
  let adminVerifiedOfferId: string;
  let merchantConfirmedOfferId: string;

  it('edits then approves candidates as unverified and admin-verified, with public source notices', async () => {
    const [first, second] = approvable;
    await request(http).patch(`/api/admin/scraper/candidates/${first}`).set(as('admin')).send({ discountPercentage: 150 }).expect(400);
    await request(http).patch(`/api/admin/scraper/candidates/${first}`).set(as('admin')).send({ terms: 'Online orders only' }).expect(200);
    const edited = await candidates.findById(first).lean();
    expect(edited!.evidence.terms.method).toMatch(/^admin_edit:/);
    expect(edited!.edits.map((e) => e.field)).toContain('terms');

    const a = await request(http).post(`/api/admin/scraper/candidates/${first}/approve`).set(as('admin')).send({ verification: 'unverified' }).expect(201);
    unverifiedOfferId = a.body.offerIds[0];
    const b = await request(http).post(`/api/admin/scraper/candidates/${second}/approve`).set(as('admin')).send({ verification: 'admin_verified' }).expect(201);
    adminVerifiedOfferId = b.body.offerIds[0];
    await request(http).post(`/api/admin/scraper/candidates/${second}/approve`).set(as('admin')).send({ verification: 'admin_verified' }).expect(400);

    expect(await offers.findById(unverifiedOfferId).lean()).toMatchObject({
      status: OfferStatus.ACTIVE,
      origin: OfferOrigin.SCRAPER,
      verification: OfferVerification.UNVERIFIED,
      managedBy: OfferManagedBy.SCRAPER,
      businessId: listing._id,
    });

    const publicOffer = await request(http).get(`/api/offers/${adminVerifiedOfferId}`).expect(200);
    expect(publicOffer.body.imported).toMatchObject({ domain: 'pizza-palace.test', verification: OfferVerification.ADMIN_VERIFIED });
    for (const internal of ['sources', 'evidence', 'confidenceScore', 'dedupeKey', 'contentFingerprint']) {
      expect(publicOffer.body).not.toHaveProperty(internal);
    }
    const page = await request(http).get(`/api/businesses/${listing.slug}`).expect(200);
    expect(page.body.offers.map((o: { _id: string }) => o._id)).toEqual(expect.arrayContaining([unverifiedOfferId, adminVerifiedOfferId]));
    expect(page.body.offers.every((o: Record<string, unknown>) => !('evidence' in o))).toBe(true);

    const actions = await auditActions();
    expect(actions).toContain(AuditAction.CANDIDATE_EDITED);
    expect(actions.filter((x) => x === AuditAction.CANDIDATE_APPROVED)).toHaveLength(2);
  });

  it('rejects a candidate with an audit entry', async () => {
    const rejected = approvable[3];
    await request(http).post(`/api/admin/scraper/candidates/${rejected}/reject`).set(as('admin')).send({ reason: 'Expired in store' }).expect(201);
    expect(await candidates.findById(rejected).lean()).toMatchObject({ status: CandidateStatus.REJECTED, reviewNote: 'Expired in store' });
    expect(await auditActions()).toContain(AuditAction.CANDIDATE_REJECTED);
  });

  it('lets the business confirm an offer found on its website, and only that business', async () => {
    const candidateId = approvable[2];
    await request(http).post(`/api/admin/scraper/candidates/${candidateId}/request-merchant-confirmation`).set(as('admin')).expect(201);

    await request(http).get(`/api/businesses/${listing._id}/imported-offers/pending`).set(as('stranger')).expect(403);
    const pending = await request(http).get(`/api/businesses/${listing._id}/imported-offers/pending`).set(as('merchant')).expect(200);
    expect(pending.body.map((c: { _id: string }) => c._id)).toEqual([candidateId]);
    expect(pending.body[0]).not.toHaveProperty('confidenceScore');

    await request(http).post(`/api/businesses/${listing._id}/imported-offers/${candidateId}/confirm`).set(as('stranger')).expect(403);
    await request(http).post(`/api/businesses/${listing._id}/imported-offers/${candidateId}/confirm`).set(as('admin')).expect(403);
    const confirmed = await request(http).post(`/api/businesses/${listing._id}/imported-offers/${candidateId}/confirm`).set(as('merchant')).expect(201);
    merchantConfirmedOfferId = confirmed.body._id;
    expect(confirmed.body).toMatchObject({
      status: OfferStatus.ACTIVE,
      origin: OfferOrigin.SCRAPER,
      verification: OfferVerification.MERCHANT_VERIFIED,
      managedBy: OfferManagedBy.MERCHANT,
    });
    const after = await request(http).get(`/api/businesses/${listing._id}/imported-offers/pending`).set(as('merchant')).expect(200);
    expect(after.body).toHaveLength(0);
  });

  it('hands an imported offer to the merchant when they edit it', async () => {
    const current = await offers.findById(adminVerifiedOfferId).lean();
    await request(http)
      .patch(`/api/offers/${adminVerifiedOfferId}`)
      .set(as('merchant'))
      .send({
        title: `${current!.title} (in store too)`,
        discountType: current!.discountType,
        value: current!.value,
        displayLabel: current!.displayLabel,
        redemptionType: current!.redemptionType,
        terms: 'Collection and delivery',
        endsAt: '2030-09-30',
      })
      .expect(200);
    expect(await offers.findById(adminVerifiedOfferId).lean()).toMatchObject({
      managedBy: OfferManagedBy.MERCHANT,
      verification: OfferVerification.ADMIN_VERIFIED,
      status: OfferStatus.ACTIVE,
      // A calendar day ends at 23:59:59.999 UK time: in September that is BST, one hour ahead of UTC.
      endsAt: new Date('2030-09-30T22:59:59.999Z'),
    });
    // Imported offers don't count towards the free plan's two live offers.
    const manage = await request(http).get(`/api/businesses/${listing._id}/offers/manage`).set(as('merchant')).expect(200);
    expect(manage.body.filter((o: { status: string }) => o.status === OfferStatus.ACTIVE)).toHaveLength(3);
  });

  it('removes imported offers at once on a public removal request, leaving merchant-managed offers alone', async () => {
    await request(http)
      .post('/api/removal-requests')
      .send({ offerId: unverifiedOfferId, email: 'owner@pizza-palace.test', reason: 'Please remove our offers', declaration: false })
      .expect(400);
    const res = await request(http)
      .post('/api/removal-requests')
      .send({ offerId: unverifiedOfferId, name: 'Mo', email: 'owner@pizza-palace.test', reason: 'Please remove our offers', declaration: true })
      .expect(202);
    expect(res.body).toEqual({ received: true });

    await request(http).get(`/api/offers/${unverifiedOfferId}`).expect(404);
    const removed = await offers.findById(unverifiedOfferId).lean();
    expect(removed).toMatchObject({ status: OfferStatus.REMOVED, removedReason: 'Removal requested' });
    expect(removed!.excerptsRedactedAt).toBeInstanceOf(Date);
    expect(removed!.sources.every((s) => s.excerpt === '')).toBe(true);

    await request(http).get(`/api/offers/${adminVerifiedOfferId}`).expect(200);
    await request(http).get(`/api/offers/${merchantConfirmedOfferId}`).expect(200);
    expect((await sites.findOne({ domain: 'pizza-palace.test' }).lean())!.authorisationStatus).toBe(DomainAuthorisationStatus.OPTED_OUT);
    expect(await candidates.countDocuments({ domain: 'pizza-palace.test', status: { $in: [CandidateStatus.PENDING_REVIEW, CandidateStatus.AWAITING_MERCHANT_CONFIRMATION] } })).toBe(0);

    // Unknown targets and bot submissions get exactly the same answer and change nothing.
    const unknown = await request(http)
      .post('/api/removal-requests')
      .send({ offerId: String(new Types.ObjectId()), email: 'someone@example.test', reason: 'Remove this please', declaration: true })
      .expect(202);
    expect(unknown.body).toEqual(res.body);
    const bot = await request(http)
      .post('/api/removal-requests')
      .send({ businessSlug: listing.slug, email: 'bot@example.test', reason: 'Remove this please', declaration: true, website: 'http://spam.example' })
      .expect(202);
    expect(bot.body).toEqual(res.body);
    expect(await optOuts.countDocuments()).toBe(1);

    const queue = await request(http).get('/api/admin/scraper/opt-outs').query({ unacknowledged: 'true' }).set(as('admin')).expect(200);
    expect(queue.body).toHaveLength(1);
    expect(queue.body[0]).toMatchObject({ domain: 'pizza-palace.test', source: 'public_form', requestedBy: { email: 'owner@pizza-palace.test' } });
    await request(http).patch(`/api/admin/scraper/opt-outs/${queue.body[0]._id}/acknowledge`).set(as('admin')).expect(200);
    const overview = await request(http).get('/api/admin/scraper/overview').set(as('admin')).expect(200);
    expect(overview.body.unacknowledgedRemovalRequests).toBe(0);

    // The opted-out domain can't be resubmitted.
    const resubmit = await request(http).post('/api/admin/scraper/websites').set(as('admin')).send({ urls: [server.url('pizza-palace.test', '/')] }).expect(201);
    expect(resubmit.body[0]).toMatchObject({ outcome: 'rejected' });

    const actions = await auditActions();
    expect(actions).toEqual(expect.arrayContaining([AuditAction.REMOVAL_REQUESTED, AuditAction.OFFER_REMOVED, AuditAction.OPT_OUT_ACKNOWLEDGED]));
  });

  it('soft-removes an imported offer the merchant deletes', async () => {
    await request(http).delete(`/api/offers/${merchantConfirmedOfferId}`).set(as('merchant')).expect(200);
    expect(await offers.findById(merchantConfirmedOfferId).lean()).toMatchObject({ status: OfferStatus.REMOVED, managedBy: OfferManagedBy.MERCHANT });
    await request(http).get(`/api/offers/${merchantConfirmedOfferId}`).expect(404);
  });

  it('approves a pending domain, reports health and handles emergency stop and resume with audit entries', async () => {
    const friends = await sites.findOne({ domain: 'pizza-palace-friends.test' }).lean();
    await request(http).patch(`/api/admin/scraper/websites/${friends!._id}/authorise`).set(as('admin')).send({ decision: 'approve' }).expect(200);
    expect((await sites.findById(friends!._id).lean())!.authorisationStatus).toBe(DomainAuthorisationStatus.AUTHORISED);

    const health = await request(http).get('/api/health').expect(200);
    expect(health.body).toMatchObject({ status: 'ok', redis: 'connected', worker: 'running' });

    const stopped = await request(http).post('/api/admin/scraper/jobs/emergency-stop').set(as('admin')).expect(201);
    expect(stopped.body).toMatchObject({ halted: true, paused: true });
    const queues = app.get(ScraperQueueService);
    expect(await queues.isPaused()).toBe(true);
    // Rendering stops too: Chromium pages are closed by the halt message and no new render starts.
    expect(await queues.queue(SCRAPER_QUEUES.render).isPaused()).toBe(true);
    const resumed = await request(http).post('/api/admin/scraper/jobs/resume').set(as('admin')).expect(201);
    expect(resumed.body).toMatchObject({ halted: false, paused: false });
    expect(await queues.queue(SCRAPER_QUEUES.render).isPaused()).toBe(false);

    const adapters = await request(http).get('/api/admin/scraper/adapters').set(as('admin')).expect(200);
    expect(adapters.body.map((a: { key: string }) => a.key)).toEqual(expect.arrayContaining(['generic-jsonld', 'generic-html']));
    await request(http).patch('/api/admin/scraper/adapters/generic-html').set(as('admin')).send({ paused: true, reason: 'Testing' }).expect(200);
    await request(http).patch('/api/admin/scraper/adapters/generic-html').set(as('admin')).send({ paused: false }).expect(200);

    const log = await request(http).get('/api/admin/scraper/audit-log').set(as('admin')).expect(200);
    const actions = log.body.map((entry: { action: string }) => entry.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        AuditAction.WEBSITE_AUTHORISED,
        AuditAction.EMERGENCY_STOP,
        AuditAction.QUEUE_RESUMED,
        AuditAction.ADAPTER_PAUSED,
        AuditAction.ADAPTER_RESUMED,
      ]),
    );
    const stop = log.body.find((entry: { action: string }) => entry.action === AuditAction.EMERGENCY_STOP);
    expect(stop.actor).toMatchObject({ kind: 'admin', role: Role.SUPER_ADMIN });
  });
});
