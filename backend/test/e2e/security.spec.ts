import { JwtService } from '@nestjs/jwt';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import type { Server } from 'node:http';
import { Connection, Model, Types } from 'mongoose';
import Stripe from 'stripe';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp, parseFlatQuery } from '../../src/app.setup';
import { OAuthProfile, OAuthService } from '../../src/auth/oauth.service';
import { BillingService } from '../../src/billing/billing.module';
import { ActorContext } from '../../src/common/actor-context';
import { deriveBusinessIdentity } from '../../src/common/business-identity';
import {
  ClaimMethod,
  ClaimStatus,
  DiscountType,
  OfferStatus,
  PlanKey,
  RedemptionType,
  Role,
  VerificationStatus,
} from '../../src/common/enums';
import { ActorKind } from '../../src/common/scraper.enums';
import { Business } from '../../src/schemas/business.schema';
import { Claim } from '../../src/schemas/claim.schema';
import { Lead } from '../../src/schemas/lead.schema';
import { Offer } from '../../src/schemas/offer.schema';
import { Plan } from '../../src/schemas/plan.schema';
import { Subscription } from '../../src/schemas/subscription.schema';
import { Supplier } from '../../src/schemas/supplier.schema';
import { User } from '../../src/schemas/user.schema';
import { Wallet } from '../../src/schemas/wallet.schema';
import { WalletTransaction } from '../../src/schemas/wallet-transaction.schema';

type Who = 'admin' | 'owner' | 'customer' | 'attacker' | 'supplierOwner' | 'otherSupplier';

describe('security fixes, end to end', () => {
  let app: NestExpressApplication;
  let http: Server;
  let businesses: Model<Business>;
  let claims: Model<Claim>;
  let users: Model<User>;
  let offers: Model<Offer>;
  let suppliers: Model<Supplier>;

  const ids: Record<Who, Types.ObjectId> = {
    admin: new Types.ObjectId(),
    owner: new Types.ObjectId(),
    customer: new Types.ObjectId(),
    attacker: new Types.ObjectId(),
    supplierOwner: new Types.ObjectId(),
    otherSupplier: new Types.ObjectId(),
  };
  const tokens = {} as Record<Who, string>;
  const as = (who: Who) => ({ Authorization: `Bearer ${tokens[who]}` });

  // Google sign-in is answered from here instead of Google's tokeninfo endpoint.
  const googleProfiles: Record<string, OAuthProfile> = {};
  let n = 0;

  async function listing(fields: Partial<Business> & { name: string }) {
    const postcode = fields.postcode ?? 'LS1 4AP';
    const phone = fields.phone === undefined ? '0113 496 0100' : fields.phone;
    return businesses.create({
      postcode,
      phone,
      slug: `listing-${++n}`,
      verificationStatus: VerificationStatus.UNCLAIMED,
      ...fields,
      ...deriveBusinessIdentity({ name: fields.name, postcode, phone: phone ?? undefined }),
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OAuthService)
      .useValue({
        googleEnabled: true,
        appleEnabled: false,
        verifyGoogleToken: async (token: string) => googleProfiles[token],
      })
      .compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] }));
    const connection = app.get<Connection>(getConnectionToken());
    await connection.dropDatabase();
    await Promise.all(Object.values(connection.models).map((m) => m.syncIndexes()));
    await app.listen(0, '127.0.0.1');
    http = app.getHttpServer();

    businesses = app.get(getModelToken(Business.name));
    claims = app.get(getModelToken(Claim.name), { strict: false });
    users = app.get(getModelToken(User.name), { strict: false });
    offers = app.get(getModelToken(Offer.name));
    suppliers = app.get(getModelToken(Supplier.name), { strict: false });

    const jwt = app.get(JwtService, { strict: false });
    const roles: Record<Who, Role> = {
      admin: Role.SUPER_ADMIN,
      owner: Role.BUSINESS_OWNER,
      customer: Role.CUSTOMER,
      attacker: Role.BUSINESS_OWNER,
      supplierOwner: Role.SUPPLIER,
      otherSupplier: Role.SUPPLIER,
    };
    for (const who of Object.keys(ids) as Who[]) {
      const person = { _id: ids[who], name: `${who} person`, email: `${who.toLowerCase()}@example.test`, role: roles[who] };
      await users.create(person);
      tokens[who] = jwt.sign({ sub: String(person._id), email: person.email, role: person.role, name: person.name });
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('supplier leads', () => {
    let mine: Types.ObjectId;
    let theirs: Types.ObjectId;

    beforeAll(async () => {
      mine = (await suppliers.create({ name: 'Box Co', slug: 'box-co', category: 'packaging', ownerId: ids.supplierOwner }))._id;
      theirs = (await suppliers.create({ name: 'Till Co', slug: 'till-co', category: 'epos', ownerId: ids.otherSupplier }))._id;
      for (const [supplier, name] of [[mine, 'Mina'], [theirs, 'Theo']] as const) {
        await request(http)
          .post(`/api/suppliers/${supplier}/leads`)
          .send({ contactName: name, contactEmail: `${name.toLowerCase()}@takeaway.test`, message: 'Please call me back' })
          .expect(201);
      }
    });

    it('shows a customer or business owner no leads at all', async () => {
      for (const who of ['customer', 'owner'] as const) {
        const res = await request(http).get('/api/suppliers/leads/mine').set(as(who)).expect(200);
        expect(res.body).toEqual([]);
      }
    });

    it('shows a supplier only the leads sent to its own listings, and an admin all of them', async () => {
      const own = await request(http).get('/api/suppliers/leads/mine').set(as('supplierOwner')).expect(200);
      expect(own.body.map((l: { contactName: string }) => l.contactName)).toEqual(['Mina']);
      const all = await request(http).get('/api/suppliers/leads/mine').set(as('admin')).expect(200);
      expect(all.body).toHaveLength(2);
    });

    it('lets only the supplier change a lead, and only to a real status', async () => {
      const lead = await app.get<Model<Lead>>(getModelToken(Lead.name), { strict: false }).findOne({ supplierId: mine }).lean();
      await request(http).patch(`/api/suppliers/leads/${lead!._id}/status`).set(as('customer')).send({ status: 'won' }).expect(403);
      await request(http).patch(`/api/suppliers/leads/${lead!._id}/status`).set(as('supplierOwner')).send({ status: 'hacked' }).expect(400);
      await request(http).patch(`/api/suppliers/leads/${lead!._id}/status`).set(as('supplierOwner')).send({ status: 'won' }).expect(200);
    });
  });

  describe('claiming a business by phone code', () => {
    const start = (businessId: unknown, who: Who = 'attacker') =>
      request(http).post(`/api/businesses/${businessId}/claim`).set(as(who)).send({ method: ClaimMethod.PHONE_OTP });
    const verify = (claimId: string, otp: string, who: Who = 'attacker') =>
      request(http).post(`/api/businesses/claims/${claimId}/verify-otp`).set(as(who)).send({ otp });
    const wrong = (otp: string) => String((Number(otp) + 1) % 1_000_000).padStart(6, '0');

    it('rejects the claim after five wrong codes, even if the right one comes next', async () => {
      const target = await listing({ name: 'Guess Me Grill' });
      const started = await start(target._id).expect(201);
      expect(started.body.devOtp).toMatch(/^\d{6}$/);
      for (let i = 4; i >= 1; i--) {
        const res = await verify(started.body.claimId, wrong(started.body.devOtp)).expect(400);
        expect(res.body.message).toContain(`${i} attempt`);
      }
      await verify(started.body.claimId, wrong(started.body.devOtp)).expect(400);
      await verify(started.body.claimId, started.body.devOtp).expect(400);

      expect((await claims.findById(started.body.claimId).lean())!.status).toBe(ClaimStatus.REJECTED);
      expect((await businesses.findById(target._id).lean())!.ownerId).toBeUndefined();
    });

    it('limits how many phone-code claims one business takes a day, across all accounts', async () => {
      const target = await listing({ name: 'Popular Pizza' });
      await claims.insertMany(
        Array.from({ length: 5 }, () => ({
          businessId: target._id,
          userId: new Types.ObjectId(),
          method: ClaimMethod.PHONE_OTP,
          status: ClaimStatus.REJECTED,
        })),
      );
      await start(target._id).expect(429);
      // Document review is still open to the real owner.
      await request(http)
        .post(`/api/businesses/${target._id}/claim`)
        .set(as('owner'))
        .send({ method: ClaimMethod.DOCUMENT_UPLOAD })
        .expect(201);
    });

    it('refuses an expired code', async () => {
      const target = await listing({ name: 'Slow Noodles' });
      const started = await start(target._id).expect(201);
      await claims.updateOne({ _id: started.body.claimId }, { $set: { otpExpiresAt: new Date(Date.now() - 1000) } });
      const res = await verify(started.body.claimId, started.body.devOtp).expect(400);
      expect(res.body.message).toMatch(/expired/);
      // A new claim can be started once the old one has expired.
      await start(target._id).expect(201);
    });

    it('never takes a business from the owner who claimed it first', async () => {
      const target = await listing({ name: 'First Come Kebabs' });
      const started = await start(target._id).expect(201);
      await businesses.updateOne({ _id: target._id }, { $set: { ownerId: ids.owner, verificationStatus: VerificationStatus.CLAIMED } });

      await verify(started.body.claimId, started.body.devOtp).expect(409);
      expect(String((await businesses.findById(target._id).lean())!.ownerId)).toBe(String(ids.owner));
      expect((await claims.findById(started.body.claimId).lean())!.status).toBe(ClaimStatus.REJECTED);
    });

    it('still approves the right code on an unclaimed business', async () => {
      const target = await listing({ name: 'Honest Chippy' });
      const started = await start(target._id, 'owner').expect(201);
      await verify(started.body.claimId, started.body.devOtp, 'owner').expect(201);
      const business = await businesses.findById(target._id).lean();
      expect(String(business!.ownerId)).toBe(String(ids.owner));
      expect(business!.verificationStatus).toBe(VerificationStatus.VERIFIED);
    });

    it('needs a phone number on the listing', async () => {
      const target = await listing({ name: 'No Phone Diner', phone: null as unknown as string });
      await start(target._id).expect(400);
    });

    it('takes admin decisions only as real booleans', async () => {
      const target = await listing({ name: 'Paperwork Pies' });
      const started = await request(http)
        .post(`/api/businesses/${target._id}/claim`)
        .set(as('attacker'))
        .send({ method: ClaimMethod.DOCUMENT_UPLOAD })
        .expect(201);
      await request(http).patch(`/api/admin/claims/${started.body.claimId}/review`).set(as('admin')).send({ approve: 'false' }).expect(400);
      await request(http).patch(`/api/admin/claims/${started.body.claimId}/review`).set(as('admin')).send({ approve: false }).expect(200);
      expect((await businesses.findById(target._id).lean())!.ownerId).toBeUndefined();
    });
  });

  describe('Google sign-in', () => {
    it('refuses an unverified Google email, and leaves the account with that address alone', async () => {
      await request(http)
        .post('/api/auth/register')
        .send({ name: 'Vic Victim', email: 'vic@example.test', password: 'correct horse battery' })
        .expect(201);
      googleProfiles.unverified = { provider: 'google', providerId: 'g-1', email: 'vic@example.test', emailVerified: false };
      await request(http).post('/api/auth/google').send({ idToken: 'unverified' }).expect(401);

      googleProfiles.newUnverified = { provider: 'google', providerId: 'g-2', email: 'nobody@example.test', emailVerified: false };
      await request(http).post('/api/auth/google').send({ idToken: 'newUnverified' }).expect(401);
      expect(await users.countDocuments({ email: 'nobody@example.test' })).toBe(0);
    });

    it('lets the verified owner of an address in, and stops a password someone else set for it working', async () => {
      const squatted = await users.create({
        name: 'Squatter',
        email: 'real.owner@example.test',
        passwordHash: await bcrypt.hash('attacker-knows-this', 10),
      });
      googleProfiles.owner = { provider: 'google', providerId: 'g-3', email: 'real.owner@example.test', emailVerified: true };
      const res = await request(http).post('/api/auth/google').send({ idToken: 'owner' }).expect(201);
      expect(res.body.user.id).toBe(String(squatted._id));

      await request(http).post('/api/auth/login').send({ email: 'real.owner@example.test', password: 'attacker-knows-this' }).expect(401);
      // The linked identity keeps working.
      await request(http).post('/api/auth/google').send({ idToken: 'owner' }).expect(201);
    });
  });

  describe('billing', () => {
    let supplierId: Types.ObjectId;
    let businessId: Types.ObjectId;

    beforeAll(async () => {
      const plans = app.get<Model<Plan>>(getModelToken(Plan.name), { strict: false });
      await plans.create([
        { key: PlanKey.STARTER, name: 'Starter', audience: 'takeaway', monthlyPrice: 10, annualPrice: 100 },
        { key: PlanKey.SUPPLIER_PRO, name: 'Supplier Pro', audience: 'supplier', monthlyPrice: 20, annualPrice: 200 },
      ]);
      supplierId = (await suppliers.create({ name: 'Fryer Co', slug: 'fryer-co', category: 'equipment', ownerId: ids.otherSupplier }))._id;
      businessId = (await listing({ name: 'Wallet Wings', ownerId: ids.owner, verificationStatus: VerificationStatus.CLAIMED }))._id;
    });

    const checkout = (who: Who, body: Record<string, unknown>) =>
      request(http).post('/api/billing/checkout').set(as(who)).send({ planKey: PlanKey.SUPPLIER_PRO, interval: 'monthly', ...body });

    it('lets only a supplier’s owner buy (and so replace) its plan', async () => {
      await checkout('supplierOwner', { supplierId }).expect(403);
      await checkout('otherSupplier', { supplierId }).expect(201);
      await checkout('owner', { supplierId, businessId }).expect(400);
    });

    it('refuses free plans and ad credit in production unless mock billing is switched on', async () => {
      const env = { NODE_ENV: process.env.NODE_ENV, BILLING_MOCK_MODE: process.env.BILLING_MOCK_MODE };
      try {
        process.env.NODE_ENV = 'production';
        delete process.env.BILLING_MOCK_MODE;
        await checkout('owner', { planKey: PlanKey.STARTER, businessId }).expect(503);
        await request(http).post(`/api/ads/wallet/${businessId}/topup`).set(as('owner')).send({ amount: 50 }).expect(503);

        process.env.BILLING_MOCK_MODE = 'true';
        await checkout('owner', { planKey: PlanKey.STARTER, businessId }).expect(201);
      } finally {
        process.env.NODE_ENV = env.NODE_ENV;
        if (env.BILLING_MOCK_MODE === undefined) delete process.env.BILLING_MOCK_MODE;
        else process.env.BILLING_MOCK_MODE = env.BILLING_MOCK_MODE;
      }
    });

    it('credits a Stripe top-up once however often the webhook is delivered, and only once it is paid', async () => {
      const models = [Plan, Subscription, Business, Supplier, Wallet, WalletTransaction].map((m) =>
        app.get(getModelToken(m.name), { strict: false }),
      );
      const env = { key: process.env.STRIPE_SECRET_KEY, secret: process.env.STRIPE_WEBHOOK_SECRET };
      process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key';
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
      try {
        const billing = new (BillingService as unknown as new (...args: unknown[]) => BillingService)(...models);
        const stripe = new Stripe('sk_test_not_a_real_key');
        const deliver = (id: string, paymentStatus: string) => {
          const payload = JSON.stringify({
            id: `evt_${id}_${paymentStatus}`,
            object: 'event',
            type: 'checkout.session.completed',
            data: {
              object: {
                id,
                object: 'checkout.session',
                amount_total: 2500,
                payment_status: paymentStatus,
                metadata: { type: 'wallet_topup', businessId: String(businessId), userId: String(ids.owner), amount: '25' },
              },
            },
          });
          const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test_secret' });
          return billing.handleWebhook(Buffer.from(payload), signature);
        };

        await deliver('cs_unpaid', 'unpaid');
        await deliver('cs_paid', 'paid');
        await deliver('cs_paid', 'paid');
        const wallet = await models[4].findOne({ businessId }).lean();
        expect(wallet.balance).toBe(25);
        expect(await models[5].countDocuments({ businessId, type: 'topup' })).toBe(1);
      } finally {
        process.env.STRIPE_SECRET_KEY = env.key;
        process.env.STRIPE_WEBHOOK_SECRET = env.secret;
        if (env.key === undefined) delete process.env.STRIPE_SECRET_KEY;
        if (env.secret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      }
    });

    it('activates a Stripe subscription once', async () => {
      const billing = app.get(BillingService);
      const params = { userId: String(ids.owner), businessId: String(businessId), planKey: PlanKey.STARTER, interval: 'monthly', price: 10, stripeSubscriptionId: 'sub_once' };
      const first = await billing.activateSubscription(params);
      const again = await billing.activateSubscription(params);
      expect(String(again._id)).toBe(String(first._id));
    });
  });

  describe('offers of unverified businesses', () => {
    const offer = {
      title: 'Ten percent off',
      discountType: DiscountType.PERCENT,
      value: 10,
      displayLabel: '10% off',
      redemptionType: RedemptionType.CODE,
      code: 'TEN',
    };

    it('go back to moderation when their owner edits them after approval', async () => {
      const business = await listing({ name: 'Unverified Uncle', ownerId: ids.owner, verificationStatus: VerificationStatus.CLAIMED });
      const created = await request(http).post(`/api/businesses/${business._id}/offers`).set(as('owner')).send(offer).expect(201);
      expect(created.body.status).toBe(OfferStatus.PENDING);
      await request(http).patch(`/api/admin/offers/${created.body._id}/moderate`).set(as('admin')).send({ approve: true }).expect(200);
      await request(http).get(`/api/offers/${created.body._id}`).expect(200);

      const edited = await request(http)
        .patch(`/api/offers/${created.body._id}`)
        .set(as('owner'))
        .send({ ...offer, title: 'Something the moderator never saw' })
        .expect(200);
      expect(edited.body.status).toBe(OfferStatus.PENDING);
      await request(http).get(`/api/offers/${created.body._id}`).expect(404);

      // An admin's own edit doesn't need moderating.
      await ActorContext.run({ kind: ActorKind.ADMIN, userId: String(ids.admin), role: Role.SUPER_ADMIN }, () =>
        offers.updateOne({ _id: created.body._id }, { $set: { status: OfferStatus.ACTIVE } }).exec(),
      );
      const byAdmin = await request(http).patch(`/api/offers/${created.body._id}`).set(as('admin')).send(offer).expect(200);
      expect(byAdmin.body.status).toBe(OfferStatus.ACTIVE);
    });

    it('stay live when a verified business edits them', async () => {
      const business = await listing({ name: 'Verified Vindaloo', ownerId: ids.owner, verificationStatus: VerificationStatus.VERIFIED });
      const created = await request(http).post(`/api/businesses/${business._id}/offers`).set(as('owner')).send(offer).expect(201);
      expect(created.body.status).toBe(OfferStatus.ACTIVE);
      const edited = await request(http).patch(`/api/offers/${created.body._id}`).set(as('owner')).send({ ...offer, title: 'Twelve percent off', value: 12 }).expect(200);
      expect(edited.body.status).toBe(OfferStatus.ACTIVE);
    });
  });

  describe('input validation', () => {
    it('refuses script links on listings and offers, and accepts web links or a blank field', async () => {
      const business = await listing({ name: 'Link Lounge', ownerId: ids.owner, verificationStatus: VerificationStatus.VERIFIED });
      for (const field of ['website', 'orderUrl', 'logoUrl']) {
        await request(http).patch(`/api/businesses/${business._id}`).set(as('owner')).send({ [field]: 'javascript:alert(document.cookie)' }).expect(400);
      }
      await request(http).patch(`/api/businesses/${business._id}`).set(as('owner')).send({ photos: ['https://cdn.example.test/a.jpg', 'data:text/html,x'] }).expect(400);
      await request(http)
        .patch(`/api/businesses/${business._id}`)
        .set(as('owner'))
        .send({ website: 'https://link-lounge.test', orderUrl: '', logoUrl: 'www.link-lounge.test/logo.png' })
        .expect(200);
      await request(http)
        .post(`/api/businesses/${business._id}/offers`)
        .set(as('owner'))
        .send({
          title: 'Click me',
          discountType: DiscountType.PERCENT,
          displayLabel: 'Deal',
          redemptionType: RedemptionType.DIRECT_LINK,
          redemptionUrl: 'javascript:1',
        })
        .expect(400);
    });

    it('follows only real businesses, by id', async () => {
      const business = await listing({ name: 'Followable Falafel' });
      await request(http).post('/api/users/me/follow').set(as('customer')).send({ businessId: { $ne: null } }).expect(400);
      await request(http).post('/api/users/me/follow').set(as('customer')).send({ businessId: String(new Types.ObjectId()) }).expect(404);
      const res = await request(http).post('/api/users/me/follow').set(as('customer')).send({ businessId: String(business._id) }).expect(201);
      expect(res.body.following).toBe(true);
    });

    it('validates every analytics event, including batched ones', async () => {
      await request(http).post('/api/events').send({ eventName: 'offer_impression', offerId: 'not-an-id' }).expect(400);
      await request(http).post('/api/events/batch').send({ events: [{ eventName: 'anything_i_like', metadata: { x: 1 } }] }).expect(400);
      await request(http)
        .post('/api/events/batch')
        .send({ events: Array.from({ length: 51 }, () => ({ eventName: 'page_view' })) })
        .expect(400);
      const ok = await request(http).post('/api/events/batch').send({ events: [{ eventName: 'page_view' }, { eventName: 'postcode_search', postcodeArea: 'LS1' }] }).expect(201);
      expect(ok.body.count).toBe(2);
    });
  });

  describe('query strings', () => {
    it('never reach a filter as an object or an array', async () => {
      const parsed = parseFlatQuery('status[$ne]=x&town=Leeds&town=York&__proto__=y');
      expect(Object.getPrototypeOf(parsed)).toBeNull();
      expect(Object.entries(parsed)).toEqual([['status[$ne]', 'x'], ['town', 'Leeds'], ['__proto__', 'y']]);
      // Used to be a 500 (an object handed to the regex builder); the bracketed name is now just an unknown parameter.
      await request(http).get('/api/businesses?town[$ne]=x&q[$gt]=').expect(200);

      const repeated = await request(http).get('/api/suppliers?category=packaging&category=epos').expect(200);
      expect(repeated.body.map((s: { category: string }) => s.category)).toEqual(['packaging']);
      await request(http).get('/api/admin/claims?status[$ne]=nothing').set(as('admin')).expect(200);
    });
  });
});
