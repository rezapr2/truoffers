import { JwtService } from '@nestjs/jwt';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { deriveBusinessIdentity } from '../../src/common/business-identity';
import { ActorContext } from '../../src/common/actor-context';
import { BusinessMemberRole, DiscountType, OfferStatus, RedemptionType, Role, SubscriptionStatus, VerificationLevel } from '../../src/common/enums';
import { ActorKind, OfferManagedBy, OfferOrigin, OfferVerification } from '../../src/common/scraper.enums';
import { MVP_PLANS } from '../../src/seed/mvp-defaults';
import { AdminAuditLog } from '../../src/schemas/admin-audit-log.schema';
import { Business } from '../../src/schemas/business.schema';
import { Offer } from '../../src/schemas/offer.schema';
import { Plan } from '../../src/schemas/plan.schema';
import { SiteSettings } from '../../src/schemas/site-settings.schema';
import { Subscription } from '../../src/schemas/subscription.schema';
import { User } from '../../src/schemas/user.schema';

/**
 * The MVP spec's main promises, end to end through the HTTP API: roles and permissions, offer publishing
 * (auto-approve and moderation rules), the claim and verification flow, locked profile fields, reports,
 * read-only "view as business", and imported offers looking the same as owner offers in public.
 */
describe('MVP: verification, moderation and permissions', () => {
  let app: NestExpressApplication;
  let http: Server;
  let offers: Model<Offer>;
  let audit: Model<AdminAuditLog>;

  const ids = {
    admin: new Types.ObjectId(),
    moderator: new Types.ObjectId(),
    owner: new Types.ObjectId(),
    staff: new Types.ObjectId(),
    freeOwner: new Types.ObjectId(),
    claimant: new Types.ObjectId(),
    customer: new Types.ObjectId(),
  };
  type Who = keyof typeof ids;
  const tokens = {} as Record<Who, string>;
  const as = (who: Who) => ({ Authorization: `Bearer ${tokens[who]}` });

  // Professional (auto-approve), Free, and an unclaimed listing
  let pro: { _id: Types.ObjectId };
  let free: { _id: Types.ObjectId };
  let unclaimed: { _id: Types.ObjectId; slug: string };
  let importedOfferId: Types.ObjectId;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] }));
    const connection = app.get<Connection>(getConnectionToken());
    await connection.dropDatabase();
    await Promise.all(Object.values(connection.models).map((m) => m.syncIndexes()));
    await app.listen(0, '127.0.0.1');
    http = app.getHttpServer();

    offers = app.get(getModelToken(Offer.name));
    audit = app.get(getModelToken(AdminAuditLog.name));
    await app.get<Model<Plan>>(getModelToken(Plan.name)).insertMany(MVP_PLANS.map((p) => ({ ...p, stripe: {} })));
    await app
      .get<Model<SiteSettings>>(getModelToken(SiteSettings.name))
      .create({ key: 'site', moderation: { bannedWords: ['guaranteed'], maxDiscountPercent: 70, checkLinkDomain: true } });

    const jwt = app.get(JwtService, { strict: false });
    const people: { key: Who; role: Role; email: string; phone?: string }[] = [
      { key: 'admin', role: Role.SUPER_ADMIN, email: 'admin@mvp.test' },
      { key: 'moderator', role: Role.MODERATOR, email: 'moderator@mvp.test' },
      { key: 'owner', role: Role.BUSINESS_OWNER, email: 'owner@pro.test' },
      { key: 'staff', role: Role.BUSINESS_STAFF, email: 'staff@pro.test' },
      { key: 'freeOwner', role: Role.BUSINESS_OWNER, email: 'owner@free.test' },
      { key: 'claimant', role: Role.CUSTOMER, email: 'claimant@mvp.test', phone: '0114 275 0103' },
      { key: 'customer', role: Role.CUSTOMER, email: 'customer@mvp.test' },
    ];
    await app.get<Model<User>>(getModelToken(User.name), { strict: false }).insertMany(
      people.map((p) => ({ _id: ids[p.key], name: p.key, email: p.email, role: p.role, phone: p.phone, emailVerifiedAt: new Date(), passwordHash: 'x' })),
    );
    for (const p of people) tokens[p.key] = jwt.sign({ sub: String(ids[p.key]), email: p.email, role: p.role, name: p.key });

    const businesses = app.get<Model<Business>>(getModelToken(Business.name));
    const listing = (name: string, postcode: string, phone: string, extra: Record<string, unknown> = {}) => ({
      name,
      slug: name.toLowerCase().replace(/\s+/g, '-'),
      postcode,
      phone,
      town: 'Leeds',
      website: `https://${name.toLowerCase().replace(/\s+/g, '')}.test`,
      orderUrl: `https://${name.toLowerCase().replace(/\s+/g, '')}.test/order`,
      ...deriveBusinessIdentity({ name, postcode, phone }),
      ...extra,
    });
    [pro, free, unclaimed] = await businesses.create([
      listing('Pro Pizza', 'LS1 4AP', '0113 496 0123', {
        verificationLevel: VerificationLevel.VERIFIED,
        verifiedAt: new Date(),
        ownerId: ids.owner,
        members: [
          { userId: ids.owner, role: BusinessMemberRole.OWNER, addedAt: new Date() },
          { userId: ids.staff, role: BusinessMemberRole.STAFF, addedAt: new Date() },
        ],
      }),
      listing('Free Fryer', 'LS2 7EY', '0113 496 0456', {
        verificationLevel: VerificationLevel.VERIFIED,
        verifiedAt: new Date(),
        ownerId: ids.freeOwner,
        members: [{ userId: ids.freeOwner, role: BusinessMemberRole.OWNER, addedAt: new Date() }],
      }),
      listing('Golden Wok', 'S1 2HE', '0114 275 0103', { source: 'import' }),
    ]);
    await app.get<Model<Subscription>>(getModelToken(Subscription.name)).create({
      businessId: pro._id,
      userId: ids.owner,
      planKey: 'professional',
      interval: 'monthly',
      price: 39,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: new Date(Date.now() + 20 * 24 * 3600_000),
    });
    // Only a person may publish an imported offer (offer-lifecycle.guard)
    const imported = await ActorContext.run({ kind: ActorKind.ADMIN, userId: String(ids.admin), role: Role.SUPER_ADMIN }, () =>
      offers.create({
        businessId: unclaimed._id,
        title: '20% off collection orders',
        discountType: DiscountType.PERCENT,
        value: 20,
        displayLabel: '20% off',
        redemptionType: RedemptionType.PHONE,
        status: OfferStatus.ACTIVE,
        origin: OfferOrigin.SCRAPER,
        verification: OfferVerification.ADMIN_VERIFIED,
        managedBy: OfferManagedBy.SCRAPER,
        sourceDomain: 'goldenwok.test',
        contentFingerprint: '20% off collection orders',
      }),
    );
    importedOfferId = imported._id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('enforces the role table on admin routes', async () => {
    await request(http).get('/api/admin/overview').expect(401);
    await request(http).get('/api/admin/overview').set(as('owner')).expect(403);
    await request(http).get('/api/admin/overview').set(as('moderator')).expect(200);
    await request(http).get('/api/admin/claims').set(as('moderator')).expect(200);
    // Prices, money, settings and the admin team stay with super admins
    for (const path of ['/api/admin/plans', '/api/admin/settings', '/api/admin/team', '/api/admin/billing/payments', '/api/admin/coupons']) {
      await request(http).get(path).set(as('moderator')).expect(403);
      await request(http).get(path).set(as('admin')).expect(200);
    }
    // Moderators can suggest a suspension but not suspend
    await request(http).post(`/api/admin/businesses/${free._id}/suspend`).set(as('moderator')).send({ reason: 'Fake offers' }).expect(403);
    await request(http).post(`/api/admin/businesses/${free._id}/suspension-review`).set(as('moderator')).send({ reason: 'Fake offers' }).expect(201);
  });

  it('keeps billing and the team with the owner, not staff', async () => {
    await request(http).get(`/api/businesses/${pro._id}/billing`).set(as('staff')).expect(403);
    await request(http).post(`/api/businesses/${pro._id}/team/invites`).set(as('staff')).send({ email: 'x@mvp.test', role: 'staff' }).expect(403);
    await request(http).get(`/api/businesses/${pro._id}/billing`).set(as('owner')).expect(200);
    await request(http).get(`/api/businesses/${free._id}/manage`).set(as('owner')).expect(403);
  });

  it('auto-approves on a plan that allows it, unless a moderation rule is hit', async () => {
    const clean = await request(http)
      .post(`/api/businesses/${pro._id}/offers`)
      .set(as('staff'))
      .send({ title: 'Free garlic bread over £20', discountType: 'free_item', redemptionType: 'show_in_store', submit: true })
      .expect(201);
    expect(clean.body.decision.status).toBe(OfferStatus.ACTIVE);

    const flagged = await request(http)
      .post(`/api/businesses/${pro._id}/offers`)
      .set(as('owner'))
      .send({ title: 'Guaranteed 80% off everything', discountType: 'percent', value: 80, redemptionType: 'show_in_store', submit: true })
      .expect(201);
    expect(flagged.body.decision.status).toBe(OfferStatus.PENDING);
    expect(flagged.body.decision.flags).toEqual(expect.arrayContaining(['banned_word:guaranteed', 'discount_too_high']));

    const onFree = await request(http)
      .post(`/api/businesses/${free._id}/offers`)
      .set(as('freeOwner'))
      .send({ title: 'Free can of drink', discountType: 'free_item', redemptionType: 'show_in_store', submit: true })
      .expect(201);
    expect(onFree.body.decision.status).toBe(OfferStatus.PENDING);

    // A moderator approves it; the decision is in the audit log with before and after
    const id = onFree.body.offer?._id ?? onFree.body._id;
    await request(http).post(`/api/admin/offers/${id}/approve`).set(as('moderator')).expect(201);
    expect((await offers.findById(id).lean())?.status).toBe(OfferStatus.ACTIVE);
    const entry = await audit.findOne({ action: 'offer.approved', targetId: String(id) }).lean();
    expect(entry?.before).toMatchObject({ status: OfferStatus.PENDING });
    expect(entry?.after).toMatchObject({ status: OfferStatus.ACTIVE });
    expect(String(entry?.actor.userId)).toBe(String(ids.moderator));
  });

  it('holds locked-field edits on a verified listing for a moderator', async () => {
    const res = await request(http).patch(`/api/businesses/${pro._id}`).set(as('owner')).send({ phone: '0113 496 0999', description: 'Wood-fired since 1998' }).expect(200);
    expect(res.body.heldFields).toEqual(['phone']);
    const after = await request(http).get(`/api/businesses/${pro._id}/manage`).set(as('owner')).expect(200);
    expect(after.body.business.phone).toBe('0113 496 0123');
    expect(after.body.business.description).toBe('Wood-fired since 1998');

    const queue = await request(http).get('/api/admin/claims/change-requests').set(as('moderator')).expect(200);
    const change = queue.body.find((c: { businessId: { _id: string } }) => c.businessId._id === String(pro._id));
    await request(http).post(`/api/admin/claims/change-requests/${change._id}/approve`).set(as('moderator')).send({}).expect(201);
    const approved = await request(http).get(`/api/businesses/${pro._id}/manage`).set(as('owner')).expect(200);
    expect(approved.body.business.phone).toBe('0113 496 0999');
  });

  it('runs a claim from phone check to verified, releasing offers saved while unverified', async () => {
    const started = await request(http).post('/api/claims').set(as('claimant')).send({ businessId: String(unclaimed._id) }).expect(201);
    const claimId = started.body._id;

    const sent = await request(http).post(`/api/claims/${claimId}/phone/send`).set(as('claimant')).send({ channel: 'sms' }).expect(201);
    expect(sent.body.devCode).toMatch(/^\d{6}$/);
    await request(http).post(`/api/claims/${claimId}/phone/verify`).set(as('claimant')).send({ code: sent.body.devCode === '000000' ? '111111' : '000000' }).expect(400);
    await request(http).post(`/api/claims/${claimId}/phone/verify`).set(as('claimant')).send({ code: sent.body.devCode }).expect(201);

    // Level 1: the claimant can draft, but nothing goes live
    const listing = await request(http).get(`/api/businesses/${unclaimed.slug}`).expect(200);
    expect(listing.body.business.verificationLevel).toBe(VerificationLevel.CLAIM_PENDING);
    const draft = await request(http)
      .post(`/api/businesses/${unclaimed._id}/offers`)
      .set(as('claimant'))
      .send({ title: 'Free prawn crackers', discountType: 'free_item', redemptionType: 'show_in_store', submit: true })
      .expect(201);
    expect(draft.body.decision.status).toBe(OfferStatus.DRAFT);

    // Phone alone is not enough: one more piece of evidence
    await request(http).post(`/api/claims/${claimId}/submit`).set(as('claimant')).expect(400);
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    await request(http).post(`/api/claims/${claimId}/documents`).set(as('claimant')).field('type', 'business_rates').attach('file', pdf, { filename: 'rates.pdf', contentType: 'application/pdf' }).expect(201);
    await request(http).post(`/api/claims/${claimId}/submit`).set(as('claimant')).expect(201);

    // The moderator sees it side by side; documents are private
    const detail = await request(http).get(`/api/admin/claims/${claimId}`).set(as('moderator')).expect(200);
    expect(detail.body.signals.listingPhoneMatchesCheck).toBe(true);
    const docId = detail.body.documents[0]._id;
    await request(http).get(`/api/admin/claims/${claimId}/documents/${docId}`).expect(401);
    await request(http).get(`/api/admin/claims/${claimId}/documents/${docId}`).set(as('customer')).expect(403);
    await request(http).get(`/api/admin/claims/${claimId}/documents/${docId}`).set(as('moderator')).expect(200);

    await request(http).post(`/api/admin/claims/${claimId}/approve`).set(as('moderator')).send({ note: 'Rates bill matches' }).expect(201);
    const verified = await request(http).get(`/api/businesses/${unclaimed.slug}`).expect(200);
    expect(verified.body.business.verificationLevel).toBe(VerificationLevel.VERIFIED);
    expect(verified.body.business.claimState).toBe('verified');
    // On Free the held draft goes to the moderator queue
    expect((await offers.findOne({ title: 'Free prawn crackers' }).lean())?.status).toBe(OfferStatus.PENDING);
    expect(await audit.exists({ action: 'claim.approved', targetId: String(claimId) })).toBeTruthy();
  });

  it('shows imported offers exactly like owner offers in public', async () => {
    const res = await request(http).get(`/api/offers/${importedOfferId}`).expect(200);
    for (const field of ['imported', 'sourceDomain', 'origin', 'verification', 'managedBy', 'sources']) expect(res.body).not.toHaveProperty(field);
  });

  it('hides an offer after reports from three different people, and restores it when the reports are rejected', async () => {
    const offer = await offers.findOne({ title: 'Free garlic bread over £20' }).lean();
    for (const deviceId of ['device-a', 'device-b', 'device-c']) {
      await request(http).post(`/api/offers/${offer!._id}/reports`).field('reason', 'not_honoured').field('deviceId', deviceId).expect(201);
    }
    await request(http).post(`/api/offers/${offer!._id}/reports`).field('reason', 'not_honoured').field('deviceId', 'device-a').expect(409);
    await request(http).get(`/api/offers/${offer!._id}`).expect(404);

    const queue = await request(http).get('/api/admin/reports').set(as('moderator')).expect(200);
    const reportCase = queue.body.items.find((c: { offerId: { _id: string } }) => c.offerId._id === String(offer!._id));
    expect(reportCase).toMatchObject({ autoHidden: true, reportCount: 3 });
    await request(http).post(`/api/admin/reports/${reportCase._id}/reject`).set(as('moderator')).send({ note: 'Checked with the shop: offer is honoured.' }).expect(201);
    await request(http).get(`/api/offers/${offer!._id}`).expect(200);
  });

  it('lets an admin view as the business, read-only and logged', async () => {
    await request(http).post(`/api/admin/businesses/${pro._id}/impersonate`).set(as('moderator')).expect(403);
    const session = await request(http).post(`/api/admin/businesses/${pro._id}/impersonate`).set(as('admin')).expect(201);
    const viewAs = { Authorization: `Bearer ${session.body.accessToken}` };
    await request(http).get(`/api/businesses/${pro._id}/manage`).set(viewAs).expect(200);
    await request(http).patch(`/api/businesses/${pro._id}`).set(viewAs).send({ description: 'changed while viewing' }).expect(403);
    expect(await audit.exists({ action: 'business.impersonated', targetId: String(pro._id) })).toBeTruthy();
  });

  it('exports admin lists as CSV', async () => {
    for (const path of ['/api/admin/businesses?format=csv', '/api/admin/offers?status=all&format=csv', '/api/admin/claims?status=all&format=csv', '/api/admin/reports?status=all&format=csv', '/api/admin/audit?format=csv']) {
      const res = await request(http).get(path).set(as('admin')).expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
    }
  });
});
