import { JwtService } from '@nestjs/jwt';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { ActorContext } from '../../src/common/actor-context';
import { deriveBusinessIdentity } from '../../src/common/business-identity';
import { DiscountType, OfferStatus, RedemptionType, Role, VerificationStatus } from '../../src/common/enums';
import { ActorKind, AuditAction, OfferManagedBy, OfferOrigin } from '../../src/common/scraper.enums';
import { CLAIM_PITCH } from '../../src/scraper/outreach/invitation-messages';
import { AdminAuditLog } from '../../src/schemas/admin-audit-log.schema';
import { Business } from '../../src/schemas/business.schema';
import { MerchantClaimInvitation } from '../../src/schemas/merchant-claim-invitation.schema';
import { Offer } from '../../src/schemas/offer.schema';
import { User } from '../../src/schemas/user.schema';

describe('claim invitations and outreach, end to end (spec §14)', () => {
  let app: NestExpressApplication;
  let http: Server;
  let businesses: Model<Business>;
  let invitations: Model<MerchantClaimInvitation>;
  let audit: Model<AdminAuditLog>;
  let unclaimed: { _id: Types.ObjectId; slug: string };
  let claimed: { _id: Types.ObjectId };

  const adminId = new Types.ObjectId();
  const ownerId = new Types.ObjectId();
  const tokens: Record<string, string> = {};
  const as = (who: 'admin' | 'owner') => ({ Authorization: `Bearer ${tokens[who]}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] }));
    const connection = app.get<Connection>(getConnectionToken());
    await connection.dropDatabase();
    await Promise.all(Object.values(connection.models).map((m) => m.syncIndexes()));
    await app.init();
    http = app.getHttpServer();

    businesses = app.get(getModelToken(Business.name));
    invitations = app.get(getModelToken(MerchantClaimInvitation.name));
    audit = app.get(getModelToken(AdminAuditLog.name));

    const jwt = app.get(JwtService, { strict: false });
    const users = app.get<Model<User>>(getModelToken(User.name), { strict: false });
    const people = [
      { _id: adminId, name: 'Ada Admin', email: 'admin@example.test', role: Role.SUPER_ADMIN },
      { _id: ownerId, name: 'Owen Owner', email: 'owner@wok-this-way.test', role: Role.BUSINESS_OWNER, phone: '0113 496 0777' },
    ];
    await users.insertMany(people);
    for (const [key, person] of [['admin', people[0]], ['owner', people[1]]] as const) {
      tokens[key] = jwt.sign({ sub: String(person._id), email: person.email, role: person.role, name: person.name });
    }

    const identity = { name: 'Wok This Way', postcode: 'LS6 2AA', phone: '0113 496 0777' };
    unclaimed = await businesses.create({
      ...identity,
      slug: 'wok-this-way-leeds',
      town: 'Leeds',
      verificationStatus: VerificationStatus.UNCLAIMED,
      importSource: { scrapedWebsiteRef: new Types.ObjectId(), domain: 'wok-this-way.test', importedAt: new Date() },
      ...deriveBusinessIdentity(identity),
    });
    claimed = await businesses.create({
      name: 'Owned Already',
      slug: 'owned-already-leeds',
      postcode: 'LS1 1AA',
      phone: '0113 496 0999',
      ownerId,
      verificationStatus: VerificationStatus.CLAIMED,
      ...deriveBusinessIdentity({ name: 'Owned Already', postcode: 'LS1 1AA', phone: '0113 496 0999' }),
    });

    const offers = app.get<Model<Offer>>(getModelToken(Offer.name));
    const importedOffer = (businessId: Types.ObjectId, title: string) =>
      ActorContext.run({ kind: ActorKind.ADMIN, userId: String(adminId), role: Role.SUPER_ADMIN }, () =>
        offers.create({
          businessId,
          title,
          discountType: DiscountType.PERCENT,
          value: 20,
          displayLabel: '20% off',
          redemptionType: RedemptionType.PHONE,
          status: OfferStatus.ACTIVE,
          origin: OfferOrigin.SCRAPER,
          managedBy: OfferManagedBy.SCRAPER,
          sourceDomain: 'wok-this-way.test',
          contentFingerprint: title,
        }),
      );
    await importedOffer(unclaimed._id, '20% off your first order');
    await importedOffer(claimed._id, '20% off Tuesdays');
  });

  afterAll(async () => {
    await app?.close();
  });

  let token: string;

  it('lists takeaways whose imported offers are live but unclaimed', async () => {
    const list = await request(http).get('/api/admin/scraper/outreach').set(as('admin')).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ offers: 1, domain: 'wok-this-way.test', invitation: null });
    expect(list.body.items[0].business.name).toBe('Wok This Way');
    await request(http).get('/api/admin/scraper/outreach').set(as('owner')).expect(403);
  });

  it('generates a claim link, QR code and the messages an admin sends themselves', async () => {
    const created = await request(http).post(`/api/admin/scraper/outreach/${unclaimed._id}/invitation`).set(as('admin')).expect(201);
    token = new URL(created.body.claimUrl).searchParams.get('invite')!;
    expect(token.length).toBeGreaterThan(20);
    expect(created.body.qrCode).toMatch(/^data:image\/png;base64,/);
    for (const message of [created.body.messages.email.body, created.body.messages.whatsapp, created.body.messages.phone]) {
      expect(message).toContain(CLAIM_PITCH);
      expect(message).toContain(created.body.claimUrl);
    }
    expect(created.body.messages.email.subject).toContain('Wok This Way');

    // The token itself is never stored, so the link only exists in what the admin copied.
    const stored = await invitations.findById(created.body.invitation._id).lean();
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored).toMatchObject({ tokenHint: token.slice(0, 6) });
    expect(stored!.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);

    await request(http).post(`/api/admin/scraper/outreach/${claimed._id}/invitation`).set(as('admin')).expect(400);
  });

  it('resolves the link to its own business only', async () => {
    const resolved = await request(http).get(`/api/claim-invitations/${token}`).expect(200);
    expect(resolved.body.business).toMatchObject({ name: 'Wok This Way', slug: 'wok-this-way-leeds' });
    await request(http).get('/api/claim-invitations/not-a-real-token').expect(404);

    // A second invitation revokes the first, so only the newest link works.
    const second = await request(http).post(`/api/admin/scraper/outreach/${unclaimed._id}/invitation`).set(as('admin')).expect(201);
    const newToken = new URL(second.body.claimUrl).searchParams.get('invite')!;
    await request(http).get(`/api/claim-invitations/${token}`).expect(404);
    await request(http).get(`/api/claim-invitations/${newToken}`).expect(200);
    token = newToken;

    // An expired link stops working.
    await invitations.updateOne({ tokenHint: token.slice(0, 6) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await request(http).get(`/api/claim-invitations/${token}`).expect(404);
    await invitations.updateOne({ tokenHint: token.slice(0, 6) }, { $set: { expiresAt: new Date(Date.now() + 60_000) } });
  });

  it('records that an admin contacted the business, and sends nothing itself', async () => {
    const contacted = await request(http)
      .post(`/api/admin/scraper/outreach/${unclaimed._id}/contacted`)
      .set(as('admin'))
      .send({ channel: 'phone', note: 'Spoke to the owner, sending the link by text' })
      .expect(201);
    expect(contacted.body.contacts).toHaveLength(1);
    expect(contacted.body.contacts[0]).toMatchObject({ channel: 'phone' });
    await request(http).post(`/api/admin/scraper/outreach/${unclaimed._id}/contacted`).set(as('admin')).send({ channel: 'carrier_pigeon' }).expect(400);

    const actions = (await audit.find().lean()).map((entry) => entry.action);
    expect(actions).toEqual(expect.arrayContaining([AuditAction.CLAIM_INVITATION_CREATED, AuditAction.CLAIM_INVITATION_REVOKED, AuditAction.OUTREACH_CONTACT_RECORDED]));
  });

  it('marks the invitation claimed once the business claims the listing', async () => {
    const started = await request(http)
      .post(`/api/businesses/${unclaimed._id}/claim`)
      .set(as('owner'))
      .send({ method: 'phone_otp' })
      .expect(201);
    await request(http)
      .post(`/api/businesses/claims/${started.body.claimId}/verify-otp`)
      .set(as('owner'))
      .send({ otp: started.body.devOtp })
      .expect(201);

    const invitation = await invitations.findOne({ tokenHint: token.slice(0, 6) }).lean();
    expect(invitation!.claimedAt).toBeInstanceOf(Date);
    expect(String(invitation!.claimedBy)).toBe(String(ownerId));
    // The link is spent, and the business is no longer in the outreach list.
    await request(http).get(`/api/claim-invitations/${token}`).expect(404);
    const list = await request(http).get('/api/admin/scraper/outreach').set(as('admin')).expect(200);
    expect(list.body.items).toHaveLength(0);
  });
});
