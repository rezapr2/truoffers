import { JwtService } from '@nestjs/jwt';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createServer, IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { deriveBusinessIdentity } from '../../src/common/business-identity';
import { BusinessMemberRole, OfferStatus, Role, SubscriptionStatus, VerificationLevel } from '../../src/common/enums';
import { signRequest, verifyRequest } from '../../src/foodbell/foodbell.signature';
import { MVP_PLANS } from '../../src/seed/mvp-defaults';
import { AnalyticsEvent } from '../../src/schemas/analytics-event.schema';
import { Business } from '../../src/schemas/business.schema';
import { MenuItem } from '../../src/schemas/menu.schema';
import { Offer } from '../../src/schemas/offer.schema';
import { Plan } from '../../src/schemas/plan.schema';
import { Subscription } from '../../src/schemas/subscription.schema';
import { User } from '../../src/schemas/user.schema';

const SECRET = 'foodbell-test-shared-secret';
const STORE_ID = '6ac000000000000000000f01';
const CODE = 'K7QM-29XH';

/** A stand-in for Foodbell's partner API that insists on valid signatures. */
function fakeFoodbell() {
  const state = {
    snapshot: null as unknown as Record<string, unknown>,
    seen: [] as { method: string; path: string; signatureOk: boolean }[],
    connectedBusiness: null as string | null,
  };
  const server: HttpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const ok = verifyRequest(SECRET, req.headers['x-truoffers-signature'] as string, req.method!, req.url!, body) === null;
      state.seen.push({ method: req.method!, path: req.url!, signatureOk: ok });
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (!ok) return send(401, { code: 'UNAUTHORIZED', message: 'Invalid or missing signature' });
      if (req.method === 'POST' && req.url === '/api/partners/truoffers/connect') {
        const { code, businessId } = JSON.parse(body);
        if (code !== CODE) return send(404, { code: 'CODE_NOT_FOUND', message: 'That code is not valid or has expired' });
        state.connectedBusiness = businessId;
        return send(200, state.snapshot);
      }
      if (req.method === 'GET' && req.url?.startsWith(`/api/partners/truoffers/stores/${STORE_ID}/snapshot`)) {
        if (!state.connectedBusiness) return send(404, { code: 'NOT_CONNECTED', message: 'not connected' });
        return send(200, state.snapshot);
      }
      if (req.method === 'POST' && req.url === `/api/partners/truoffers/stores/${STORE_ID}/disconnect`) {
        state.connectedBusiness = null;
        return send(200, { disconnected: true });
      }
      send(404, { code: 'NOT_FOUND', message: 'no route' });
    });
  });
  return { server, state };
}

const deal = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: '20% off orders over £15',
  description: null,
  kind: 'percent',
  value: 20,
  label: '20% off',
  appliesTo: 'order',
  minOrder: 15,
  code: null,
  delivery: true,
  collection: true,
  days: null,
  timeFrom: null,
  timeTo: null,
  startsAt: null,
  endsAt: null,
  newCustomersOnly: false,
  needsAccount: false,
  terms: 'Minimum order £15.',
  ...extra,
});

const snapshot = (deals: unknown[]) => ({
  generatedAt: new Date().toISOString(),
  store: {
    id: STORE_ID,
    name: 'Bella Napoli',
    description: 'Wood-fired pizza since 1998.',
    address: '12 Otley Road',
    town: 'Leeds',
    postcode: 'LS6 3HN',
    phone: '0113 496 0101',
    email: 'hello@bellanapoli.test',
    orderUrl: 'https://bellanapoli.foodbell.co.uk',
    domain: 'bellanapoli.foodbell.co.uk',
    logo: 'https://cdn.foodbell.test/logo.png',
    delivery: true,
    collection: false,
    openingHours: { mon: '11:00-22:00', tue: 'closed' },
    socialLinks: { facebook: null, instagram: 'https://instagram.com/bellanapoli', x: null },
  },
  menu: {
    categories: [{ id: 'c1', name: 'Pizzas', description: null }],
    items: [
      { id: 'p1', name: 'Margherita', description: 'Tomato and mozzarella', category: 'Pizzas', price: 8, sizes: [{ label: '10"', price: 8 }, { label: '12"', price: 10.5 }], mealDeal: false, image: null, sortOrder: 0 },
      { id: 'p2', name: 'Garlic bread', description: null, category: 'Sides', price: 3.5, sizes: [], mealDeal: false, image: null, sortOrder: 1 },
    ],
  },
  deals,
  skipped: [{ id: 'g1', title: 'Spin-the-wheel prize', reason: 'personal' }],
});

describe('Foodbell integration', () => {
  let app: NestExpressApplication;
  let http: Server;
  let fake: ReturnType<typeof fakeFoodbell>;
  let offers: Model<Offer>;
  let businesses: Model<Business>;
  let menuItems: Model<MenuItem>;
  const ownerId = new Types.ObjectId();
  const staffId = new Types.ObjectId();
  let businessId: string;
  const tokens: Record<string, string> = {};
  const as = (who: 'owner' | 'staff') => ({ Authorization: `Bearer ${tokens[who]}` });

  const webhook = (event: unknown, secret = SECRET) => {
    const body = JSON.stringify(event);
    return request(http)
      .post('/api/integrations/foodbell/webhook')
      .set('Content-Type', 'application/json')
      .set('x-truoffers-signature', signRequest(secret, 'POST', '/api/integrations/foodbell/webhook', body))
      .send(body);
  };
  const waitFor = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 50; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('timed out');
  };

  beforeAll(async () => {
    fake = fakeFoodbell();
    fake.state.snapshot = snapshot([deal('d1'), deal('d2', { title: 'Free garlic bread with any pizza', kind: 'free_item', value: 0, label: 'Free item', code: 'GARLIC', minOrder: 0, terms: null })]);
    await new Promise<void>((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
    process.env.FOODBELL_API_URL = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}/api`;
    process.env.FOODBELL_SHARED_SECRET = SECRET;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] }));
    const connection = app.get<Connection>(getConnectionToken());
    await connection.dropDatabase();
    await Promise.all(Object.values(connection.models).map((m) => m.syncIndexes()));
    await app.listen(0, '127.0.0.1');
    http = app.getHttpServer();
    offers = app.get(getModelToken(Offer.name));
    businesses = app.get(getModelToken(Business.name));
    menuItems = app.get(getModelToken(MenuItem.name));

    await app.get<Model<Plan>>(getModelToken(Plan.name)).insertMany(MVP_PLANS.map((p) => ({ ...p, stripe: {} })));
    const jwt = app.get(JwtService, { strict: false });
    await app.get<Model<User>>(getModelToken(User.name), { strict: false }).insertMany([
      { _id: ownerId, name: 'Marco Rossi', email: 'owner@foodbell-e2e.test', role: Role.BUSINESS_OWNER, emailVerifiedAt: new Date(), passwordHash: 'x' },
      { _id: staffId, name: 'Gina Staff', email: 'staff@foodbell-e2e.test', role: Role.BUSINESS_STAFF, emailVerifiedAt: new Date(), passwordHash: 'x' },
    ]);
    tokens.owner = jwt.sign({ sub: String(ownerId), email: 'owner@foodbell-e2e.test', role: Role.BUSINESS_OWNER, name: 'Marco Rossi' });
    tokens.staff = jwt.sign({ sub: String(staffId), email: 'staff@foodbell-e2e.test', role: Role.BUSINESS_STAFF, name: 'Gina Staff' });
    const business = await businesses.create({
      name: 'Bella Napoli',
      slug: 'bella-napoli',
      postcode: 'LS6 3HN',
      phone: '0113 496 0101',
      town: 'Leeds',
      verificationLevel: VerificationLevel.VERIFIED,
      verifiedAt: new Date(),
      ownerId,
      members: [
        { userId: ownerId, role: BusinessMemberRole.OWNER, addedAt: new Date() },
        { userId: staffId, role: BusinessMemberRole.STAFF, addedAt: new Date() },
      ],
      ...deriveBusinessIdentity({ name: 'Bella Napoli', postcode: 'LS6 3HN', phone: '0113 496 0101' }),
    });
    businessId = String(business._id);
    // Typed in by the owner before connecting
    await menuItems.create({ businessId: business._id, section: 'Salads', name: 'House salad', price: 5 });
    await app.get<Model<Subscription>>(getModelToken(Subscription.name)).create({
      businessId: business._id,
      userId: ownerId,
      planKey: 'professional',
      interval: 'monthly',
      price: 39,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: new Date(Date.now() + 20 * 24 * 3600_000),
    });
  });

  afterAll(async () => {
    delete process.env.FOODBELL_API_URL;
    delete process.env.FOODBELL_SHARED_SECRET;
    await app?.close();
    await new Promise((r) => fake?.server.close(r));
  });

  it('only lets an owner connect, and only with the code from Foodbell', async () => {
    await request(http).post(`/api/businesses/${businessId}/foodbell/connect`).set(as('staff')).send({ code: CODE }).expect(403);
    const wrong = await request(http).post(`/api/businesses/${businessId}/foodbell/connect`).set(as('owner')).send({ code: 'AAAA-BBBB' }).expect(400);
    expect(wrong.body.message).toContain('not valid or has expired');
  });

  it('connects and mirrors the profile, hours, menu and deals', async () => {
    const res = await request(http).post(`/api/businesses/${businessId}/foodbell/connect`).set(as('owner')).send({ code: CODE }).expect(201);
    expect(res.body.connection).toMatchObject({ storeId: STORE_ID, status: 'connected', domain: 'bellanapoli.foodbell.co.uk' });
    expect(fake.state.seen.every((r) => r.signatureOk)).toBe(true);

    const business = await businesses.findById(businessId).lean();
    expect(business).toMatchObject({
      isFoodbellClient: true,
      orderUrl: 'https://bellanapoli.foodbell.co.uk',
      description: 'Wood-fired pizza since 1998.',
      delivery: true,
      collection: false,
      logoUrl: 'https://cdn.foodbell.test/logo.png',
    });
    expect(business?.openingHours).toMatchObject({ monday: '11:00–22:00', tuesday: 'Closed' });
    expect(business?.socialLinks).toMatchObject({ instagram: 'https://instagram.com/bellanapoli' });

    const menu = await menuItems.find({ businessId, source: 'foodbell' }).sort({ sortOrder: 1 }).lean();
    expect(menu.map((m) => [m.name, m.price, m.section, m.source])).toEqual([
      ['Margherita', 8, 'Pizzas', 'foodbell'],
      ['Garlic bread', 3.5, 'Sides', 'foodbell'],
    ]);
    expect(menu[0].description).toContain('12" £10.50');
    // The Foodbell menu is the menu: the owner's own dish waits behind it, and Foodbell dishes change in Foodbell
    const profile = await request(http).get('/api/businesses/bella-napoli').expect(200);
    expect(profile.body.menu.map((m: { name: string }) => m.name).sort()).toEqual(['Garlic bread', 'Margherita']);
    await request(http).delete(`/api/businesses/${businessId}/menu/${menu[0]._id}`).set(as('owner')).expect(400);

    // Verified, on Professional (auto-approve, coupon codes): both deals go live
    const live = await offers.find({ businessId, 'external.provider': 'foodbell' }).sort({ createdAt: 1 }).lean();
    expect(live.map((o) => [o.external?.id, o.status, o.displayLabel, o.redemptionType, o.code ?? null])).toEqual([
      ['d1', OfferStatus.ACTIVE, '20% off', 'direct_link', null],
      ['d2', OfferStatus.ACTIVE, 'Free item', 'code', 'GARLIC'],
    ]);
    expect(live[0].redemptionUrl).toMatch(/^https:\/\/bellanapoli\.foodbell\.co\.uk\/?$/);
    expect(res.body.connection.summary.skipped).toEqual([{ id: 'g1', title: 'Spin-the-wheel prize', reason: 'personal' }]);
  });

  it('keeps synced deals managed in Foodbell: no edits or deletes here, pausing is fine', async () => {
    const d1 = await offers.findOne({ businessId, 'external.id': 'd1' }).lean();
    const edit = await request(http).patch(`/api/offers/${d1!._id}`).set(as('staff')).send({ title: 'My own words for this deal', discountType: 'percent', value: 25, redemptionType: 'direct_link' }).expect(400);
    expect(edit.body).toMatchObject({ code: 'mirrored_offer' });
    await request(http).delete(`/api/offers/${d1!._id}`).set(as('owner')).expect(400);
    await request(http).post(`/api/offers/${d1!._id}/pause`).set(as('staff')).expect(201);
    await request(http).post(`/api/offers/${d1!._id}/resume`).set(as('staff')).expect(201);
    const listed = await request(http).get(`/api/businesses/${businessId}/offers/manage`).set(as('staff')).expect(200);
    expect(listed.body.offers.find((o: { _id: string }) => o._id === String(d1!._id)).external).toMatchObject({ provider: 'foodbell', id: 'd1' });
    const pub = await request(http).get(`/api/offers/${d1!._id}`).expect(200);
    expect(pub.body.external).toBeUndefined();
    expect(pub.body.businessId?.foodbell).toBeUndefined();
  });

  it('rejects webhooks without the right signature', async () => {
    await webhook({ id: 'e0', type: 'store.updated', storeId: STORE_ID }, 'wrong-secret').expect(400);
    await request(http).post('/api/integrations/foodbell/webhook').send({ type: 'store.updated', storeId: STORE_ID }).expect(400);
  });

  it('re-syncs when Foodbell says the store changed: updates, ends and adds offers', async () => {
    fake.state.snapshot = snapshot([deal('d1', { value: 25, label: '25% off', title: '25% off orders over £15' }), deal('d3', { title: 'Free delivery over £20', kind: 'free_delivery', value: 0, label: 'Free delivery', minOrder: 20 })]);
    await webhook({ id: 'e1', type: 'store.updated', storeId: STORE_ID }).expect(200);
    await waitFor(async () => (await offers.countDocuments({ businessId, 'external.id': 'd3' })) === 1);
    await waitFor(async () => (await offers.findOne({ businessId, 'external.id': 'd2' }).lean())?.status === OfferStatus.EXPIRED);
    const d1 = await offers.findOne({ businessId, 'external.id': 'd1' }).lean();
    expect(d1).toMatchObject({ value: 25, displayLabel: '25% off', status: OfferStatus.ACTIVE });
  });

  it('counts orders Foodbell reports, once each, in the owner’s insights', async () => {
    const d1 = await offers.findOne({ businessId, 'external.id': 'd1' }).lean();
    const order = { id: 'e2', type: 'order.completed', storeId: STORE_ID, data: { orderId: 'o1', clickId: 'clk_123456', campaign: String(d1!._id), total: 24.5, orderType: 'delivery' } };
    await webhook(order).expect(200);
    await webhook({ ...order, id: 'e3' }).expect(200);
    const events = await app.get<Model<AnalyticsEvent>>(getModelToken(AnalyticsEvent.name)).find({ eventName: 'partner_order' }).lean();
    expect(events).toHaveLength(1);
    expect(String(events[0].offerId)).toBe(String(d1!._id));

    const insights = await request(http).get(`/api/businesses/${businessId}/insights?days=30`).set(as('owner')).expect(200);
    expect(insights.body.totals.foodbellOrders).toBe(1);
    expect(insights.body.foodbellRevenue).toBe(24.5);
    const status = await request(http).get(`/api/businesses/${businessId}/foodbell`).set(as('staff')).expect(200);
    expect(status.body.last30Days).toEqual({ orders: 1, revenue: 24.5 });
  });

  it('ignores events for stores that are not connected', async () => {
    const res = await webhook({ id: 'e4', type: 'store.updated', storeId: '6ac000000000000000000fff' }).expect(200);
    expect(res.body).toEqual({ received: true, ignored: true });
  });

  it('disconnects: Foodbell is told, its deals end, the listing stays', async () => {
    await request(http).post(`/api/businesses/${businessId}/foodbell/disconnect`).set(as('staff')).expect(403);
    const res = await request(http).post(`/api/businesses/${businessId}/foodbell/disconnect`).set(as('owner')).expect(201);
    expect(res.body.connection.status).toBe('disconnected');
    expect(fake.state.connectedBusiness).toBeNull();
    const remaining = await offers.countDocuments({ businessId, 'external.provider': 'foodbell', status: { $ne: OfferStatus.EXPIRED } });
    expect(remaining).toBe(0);
    expect((await businesses.findById(businessId).lean())?.isFoodbellClient).toBe(false);
    // The owner's own menu shows again; the Foodbell copy goes
    expect((await menuItems.find({ businessId }).lean()).map((m) => m.name)).toEqual(['House salad']);
  });
});
