import { JwtService } from '@nestjs/jwt';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import type { Server } from 'node:http';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { unsubscribeLink } from '../../src/campaigns/campaigns.service';
import { BusinessMemberRole, Role, VerificationLevel } from '../../src/common/enums';
import { deriveBusinessIdentity } from '../../src/common/business-identity';
import { Business } from '../../src/schemas/business.schema';
import { EmailLog } from '../../src/schemas/email.schema';
import { Notification } from '../../src/schemas/notification.schema';
import { User } from '../../src/schemas/user.schema';

/** The blog, support tickets, campaigns with consent and unsubscribe, and "delete my account". */
describe('Blog, support, campaigns and account', () => {
  let app: NestExpressApplication;
  let http: Server;
  let users: Model<User>;
  let emails: Model<EmailLog>;
  let notifications: Model<Notification>;
  const ids = {
    admin: new Types.ObjectId(),
    moderator: new Types.ObjectId(),
    owner: new Types.ObjectId(),
    optedIn: new Types.ObjectId(),
    optedOut: new Types.ObjectId(),
    leaver: new Types.ObjectId(),
  };
  type Who = keyof typeof ids;
  const tokens = {} as Record<Who, string>;
  const as = (who: Who) => ({ Authorization: `Bearer ${tokens[who]}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] }));
    const connection = app.get<Connection>(getConnectionToken());
    await connection.dropDatabase();
    await Promise.all(Object.values(connection.models).map((m) => m.syncIndexes()));
    await app.listen(0, '127.0.0.1');
    http = app.getHttpServer();
    users = app.get(getModelToken(User.name), { strict: false });
    emails = app.get(getModelToken(EmailLog.name), { strict: false });
    notifications = app.get(getModelToken(Notification.name), { strict: false });

    const passwordHash = await bcrypt.hash('Password123!', 4);
    const people = [
      { key: 'admin', role: Role.SUPER_ADMIN, email: 'admin@extras.test' },
      { key: 'moderator', role: Role.MODERATOR, email: 'mod@extras.test' },
      { key: 'owner', role: Role.BUSINESS_OWNER, email: 'owner@extras.test', phone: '07911 654321', marketingEmails: true },
      { key: 'optedIn', role: Role.CUSTOMER, email: 'in@extras.test', postcode: 'M14 5TQ', phone: '07911 123456', marketingEmails: true, marketingSms: true },
      { key: 'optedOut', role: Role.CUSTOMER, email: 'out@extras.test', postcode: 'M14 6AA' },
      { key: 'leaver', role: Role.CUSTOMER, email: 'leaver@extras.test' },
    ] as const;
    await users.insertMany(people.map(({ key, ...p }) => ({ _id: ids[key], name: `${key} person`, passwordHash, emailVerifiedAt: new Date(), ...p })));
    const jwt = app.get(JwtService, { strict: false });
    for (const p of people) tokens[p.key] = jwt.sign({ sub: String(ids[p.key]), email: p.email, role: p.role, name: `${p.key} person` });

    await app.get<Model<Business>>(getModelToken(Business.name)).create({
      name: 'Extras Kitchen',
      slug: 'extras-kitchen',
      postcode: 'LS1 4AP',
      phone: '0113 496 0777',
      town: 'Leeds',
      verificationLevel: VerificationLevel.VERIFIED,
      ownerId: ids.owner,
      members: [{ userId: ids.owner, role: BusinessMemberRole.OWNER, addedAt: new Date() }],
      ...deriveBusinessIdentity({ name: 'Extras Kitchen', postcode: 'LS1 4AP', phone: '0113 496 0777' }),
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('publishes blog posts written in the admin panel', async () => {
    await request(http).post('/api/admin/blog').set(as('moderator')).send({ title: 'Nope' }).expect(403);
    const draft = await request(http)
      .post('/api/admin/blog')
      .set(as('admin'))
      .send({ title: 'Best curry deals this month', excerpt: 'Where to eat', body: '## Rusholme\n\nLots of offers.', tags: ['City guides'] })
      .expect(201);
    expect(draft.body).toMatchObject({ slug: 'best-curry-deals-this-month', status: 'draft' });
    await request(http).get('/api/blog/best-curry-deals-this-month').expect(404);

    await request(http).patch(`/api/admin/blog/${draft.body._id}`).set(as('admin')).send({ status: 'published' }).expect(200);
    const list = await request(http).get('/api/blog').expect(200);
    expect(list.body.items.map((p: { slug: string }) => p.slug)).toContain('best-curry-deals-this-month');
    expect(list.body.tags).toEqual(['City guides']);
    expect(list.body.items[0].body).toBeUndefined();
    const post = await request(http).get('/api/blog/best-curry-deals-this-month').expect(200);
    expect(post.body.post.body).toContain('Rusholme');

    await request(http).post('/api/admin/blog').set(as('admin')).send({ title: 'Best curry deals this month' }).expect(409);
  });

  it('runs a support conversation for a guest through the link in their email', async () => {
    const created = await request(http)
      .post('/api/support/tickets')
      .send({ name: 'Gail Guest', email: 'gail@extras.test', topic: 'listing', subject: 'Wrong opening hours', message: 'The listing says you close at 10pm but it is 11pm.' })
      .expect(201);
    expect(created.body.number).toMatch(/^T-\d{5}$/);
    const id = created.body._id;
    const receipt = await emails.findOne({ to: 'gail@extras.test', template: 'support_ticket_received' }).lean();
    const token = /[?&]t=([\w-]+)/.exec(receipt!.body)![1];

    // Only the link (or the signed-in requester) opens it
    await request(http).get(`/api/support/tickets/${id}`).expect(404);
    await request(http).get(`/api/support/tickets/${id}?t=wrong`).expect(404);
    await request(http).get(`/api/support/tickets/${id}`).set(as('optedOut')).expect(404);
    await request(http).get(`/api/support/tickets/${id}?t=${token}`).expect(200);

    await request(http).get('/api/admin/support').set(as('owner')).expect(403);
    const inbox = await request(http).get('/api/admin/support').set(as('moderator')).expect(200);
    expect(inbox.body.items.map((t: { _id: string }) => t._id)).toContain(id);

    await request(http).post(`/api/admin/support/${id}/messages`).set(as('moderator')).send({ body: 'Checked their website: 11pm is right.', internal: true }).expect(201);
    const replied = await request(http).post(`/api/admin/support/${id}/messages`).set(as('moderator')).send({ body: 'Thanks, we have fixed the hours.' }).expect(201);
    expect(replied.body.ticket.status).toBe('pending');
    const reply = await emails.findOne({ to: 'gail@extras.test', template: 'support_reply' }).lean();
    expect(reply!.body).toContain('we have fixed the hours');
    expect(reply!.body).toContain(`t=${token}`);

    const view = await request(http).get(`/api/support/tickets/${id}?t=${token}`).expect(200);
    expect(view.body.messages.map((m: { body: string }) => m.body)).toEqual(['The listing says you close at 10pm but it is 11pm.', 'Thanks, we have fixed the hours.']);

    const back = await request(http).post(`/api/support/tickets/${id}/messages`).send({ body: 'Great, thank you!', t: token }).expect(201);
    expect(back.body.status).toBe('open');
    await request(http).patch(`/api/admin/support/${id}`).set(as('moderator')).send({ status: 'closed' }).expect(200);
    const csv = await request(http).get('/api/admin/support?status=all&format=csv').set(as('moderator')).expect(200);
    expect(csv.text).toContain('Wrong opening hours');
  });

  it('lets a business open a ticket from its dashboard and see it in its list', async () => {
    const business = await app.get<Model<Business>>(getModelToken(Business.name)).findOne({ slug: 'extras-kitchen' }).lean();
    const created = await request(http)
      .post('/api/support/tickets')
      .set(as('owner'))
      .send({ topic: 'billing', subject: 'Invoice address', message: 'Please change the address on our invoices.', businessId: String(business!._id) })
      .expect(201);
    const mine = await request(http).get('/api/support/tickets/mine').set(as('owner')).expect(200);
    expect(mine.body[0]).toMatchObject({ _id: created.body._id, subject: 'Invoice address', businessId: { name: 'Extras Kitchen' } });
    await request(http).get(`/api/support/tickets/${created.body._id}`).set(as('owner')).expect(200);
  });

  it('sends marketing campaigns only to people who opted in, with a working unsubscribe link', async () => {
    const audience = { roles: ['customer'], postcodeAreas: ['M14'] };
    const preview = await request(http).post('/api/admin/campaigns/preview').set(as('admin')).send({ kind: 'marketing', audience }).expect(201);
    expect(preview.body).toMatchObject({ total: 2, email: 1, sms: 1, inApp: 2 });
    const service = await request(http).post('/api/admin/campaigns/preview').set(as('admin')).send({ kind: 'service', audience }).expect(201);
    expect(service.body).toMatchObject({ total: 2, email: 2 });

    await request(http).post('/api/admin/campaigns').set(as('moderator')).send({ name: 'x' }).expect(403);
    const created = await request(http)
      .post('/api/admin/campaigns')
      .set(as('admin'))
      .send({ name: 'Curry week', kind: 'marketing', channels: { email: true, sms: true, inApp: true }, audience, subject: 'Curry week, {{name}}', body: 'Hi {{name}}, 20% off curries this week.', smsBody: 'Curry week: 20% off.', link: '/offers' })
      .expect(201);
    const id = created.body._id;
    await request(http).post(`/api/admin/campaigns/${id}/schedule`).set(as('admin')).send({}).expect(201);

    let campaign: { status: string; recipients: number; email: { sent: number; skipped: number }; sms: { sent: number; skipped: number }; inApp: { sent: number } } | undefined;
    for (let i = 0; i < 50; i++) {
      campaign = (await request(http).get(`/api/admin/campaigns/${id}`).set(as('admin'))).body;
      if (campaign!.status === 'sent') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(campaign).toMatchObject({ status: 'sent', recipients: 2, email: { sent: 1, skipped: 1 }, sms: { sent: 1, skipped: 1 }, inApp: { sent: 2 } });

    // Emails and texts share the message log
    const sent = await emails.find({ template: `campaign:${id}`, subject: { $ne: 'SMS' } }).lean();
    expect(sent.map((e) => e.to)).toEqual(['in@extras.test']);
    const texts = await emails.find({ template: `campaign:${id}`, subject: 'SMS' }).lean();
    expect(texts.map((t) => [t.to, t.body])).toEqual([['+447911123456', 'Curry week: 20% off. Reply STOP to opt out.']]);
    expect(sent[0].subject).toBe('Curry week, optedIn');
    expect(sent[0].body).toContain('Unsubscribe: ');
    expect(await notifications.countDocuments({ type: 'campaign' })).toBe(2);
    await request(http).patch(`/api/admin/campaigns/${id}`).set(as('admin')).send({ name: 'changed' }).expect(400);

    // The link from the email turns the consent off without signing in; a forged one doesn't.
    const link = new URL(unsubscribeLink(String(ids.optedIn), 'email', true));
    await request(http).post(`/api/users/unsubscribe?u=${ids.optedIn}&c=email&s=forged-signature-forged-signature`).expect(400);
    await request(http).post(`/api/users/unsubscribe${link.search}`).send('List-Unsubscribe=One-Click').set('Content-Type', 'application/x-www-form-urlencoded').expect(200);
    expect((await users.findById(ids.optedIn).lean())?.marketingEmails).toBe(false);
    const after = await request(http).post('/api/admin/campaigns/preview').set(as('admin')).send({ kind: 'marketing', audience }).expect(201);
    expect(after.body.email).toBe(0);
  });

  it('targets business owners by plan and verification level', async () => {
    const preview = await request(http).post('/api/admin/campaigns/preview').set(as('admin')).send({ kind: 'service', audience: { roles: ['business_owner'], verificationLevels: [2], plans: ['free'] } }).expect(201);
    expect(preview.body.total).toBe(1);
    const none = await request(http).post('/api/admin/campaigns/preview').set(as('admin')).send({ kind: 'service', audience: { roles: ['business_owner'], plans: ['professional'] } }).expect(201);
    expect(none.body.total).toBe(0);
  });

  it('saves marketing preferences and deletes an account on request', async () => {
    const prefs = await request(http).patch('/api/users/me').set(as('optedOut')).send({ marketingEmails: true, marketingSms: false }).expect(200);
    expect(prefs.body).toMatchObject({ marketingEmails: true, marketingSms: false });
    expect((await users.findById(ids.optedOut).lean())?.marketingConsentAt).toBeDefined();

    await request(http).delete('/api/users/me').set(as('leaver')).send({ password: 'wrong' }).expect(403);
    await request(http).delete('/api/users/me').set(as('admin')).send({ password: 'Password123!' }).expect(400);
    await request(http).delete('/api/users/me').set(as('leaver')).send({ password: 'Password123!' }).expect(200);
    const gone = await users.findById(ids.leaver).lean();
    expect(gone).toMatchObject({ status: 'deleted', name: 'Deleted user' });
    expect(gone?.email).not.toContain('leaver');
  });
});
