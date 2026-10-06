/**
 * TruOffers seed script (development only: it wipes the seeded collections).
 * Run with: npm run seed
 *
 * Creates plans, promotion products, cuisines, areas, demo users, takeaways at every verification level,
 * offers in every state, a claim waiting for review, a report case, a profile change, promotions, a paid
 * plan with invoices, and content. Staff accounts are enrolled in two-factor sign-in with a fixed dev secret.
 */
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { deriveBusinessIdentity } from '../common/business-identity';
import { fingerprintOfPublishedOffer } from '../scraper/lifecycle/offer-mapping';
import { encryptSecret, sha256 } from '../platform/crypto';
import { otpauthUrl } from '../auth/totp';
import { DEFAULT_OFFER_TYPES } from '../content/content.service';
import { DEFAULT_PROMOTION_PRODUCTS } from '../promotions/promotions.service';
import { loadDotEnv, MVP_PLANS, STARTER_AREAS, STARTER_FAQS, STARTER_HELP_PAGES, SUPPLIER_PLANS } from './mvp-defaults';

loadDotEnv();
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/truoffers';
// Base32 secret for the seeded staff accounts' authenticator (dev only). Add it to any authenticator app.
const DEV_TOTP_SECRET = 'JBSWY3DPEHPK3PXPTRUOFFERSDEVONLY';

const DAY = 24 * 3600 * 1000;
const inDays = (d: number) => new Date(Date.now() + d * DAY);

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'true') {
    console.log('Note: seeding with NODE_ENV=production (first deploy only). It wipes the seeded collections.');
  }
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db!;
  console.log('Connected to', MONGODB_URI.replace(/\/\/[^@]*@/, '//***@'));

  const collections = [
    'users', 'businesses', 'offers', 'categories', 'claims', 'claimdocuments', 'menuitems', 'suppliers', 'leads',
    'plans', 'subscriptions', 'payments', 'coupons', 'stripeevents', 'analyticsevents', 'redemptions', 'promotions',
    'promotionproducts', 'reports', 'reportcases', 'businessstrikes', 'reportblocks', 'notifications', 'emaillogs',
    'emailtemplates', 'sitesettings', 'sitecontents', 'helppages', 'areas', 'offertypes', 'businessinvites',
    'businesschangerequests', 'loginevents', 'migrations', 'wallets', 'wallettransactions',
    // Scraper collections
    'scrapedwebsites', 'extractedoffercandidates', 'importjobs', 'providerpolicies', 'domainoptouts',
    'robotscaches', 'domaincrawlconfigs', 'adminauditlogs', 'scraperadapters', 'scrapersettings',
    'websitefingerprints', 'authorisednetworks', 'offerrevisions', 'merchantclaiminvitations',
  ];
  for (const c of collections) await db.collection(c).deleteMany({});

  // ---- Plans (spec "Recommended MVP plans") ----
  await db.collection('plans').insertMany([...MVP_PLANS, ...SUPPLIER_PLANS].map((p) => withTimestamps({ ...p, stripe: {} })));
  console.log('Seeded plans: Free, Standard, Professional on sale; Starter and Premium hidden; 3 supplier plans');

  await db.collection('promotionproducts').insertMany(DEFAULT_PROMOTION_PRODUCTS.map((p) => withTimestamps({ ...p, active: true })));
  await db.collection('offertypes').insertMany(DEFAULT_OFFER_TYPES.map(withTimestamps));
  await db.collection('sitesettings').insertOne(
    withTimestamps({
      key: 'site',
      siteName: 'TruOffers',
      contactEmail: 'hello@truoffers.co.uk',
      vatRatePercent: 20,
      pricesIncludeVat: false,
      maintenanceMode: false,
      maintenanceMessage: 'TruOffers is down for maintenance. We will be back shortly.',
      reports: { autoHideThreshold: 3, windowDays: 7, strikeThreshold: 3, strikeWindowDays: 90 },
      moderation: { bannedWords: ['guaranteed', 'free money'], maxDiscountPercent: 70, checkLinkDomain: true },
      knownOrderingDomains: ['foodbell.co.uk', 'foodhub.co.uk', 'foodhub.com', 'grub24.co.uk', 'just-eat.co.uk', 'deliveroo.co.uk', 'ubereats.com'],
      emailFrom: 'TruOffers <hello@truoffers.co.uk>',
      secrets: {},
    }),
  );

  // ---- Cuisines and areas ----
  const categoryDefs = [
    { name: 'Pizza', slug: 'pizza', emoji: '🍕' },
    { name: 'Indian', slug: 'indian', emoji: '🍛' },
    { name: 'Chinese', slug: 'chinese', emoji: '🥡' },
    { name: 'Fish & Chips', slug: 'fish-and-chips', emoji: '🐟' },
    { name: 'Kebab', slug: 'kebab', emoji: '🥙' },
    { name: 'Burgers', slug: 'burgers', emoji: '🍔' },
    { name: 'Thai', slug: 'thai', emoji: '🍜' },
    { name: 'Chicken', slug: 'chicken', emoji: '🍗' },
    { name: 'Desserts', slug: 'desserts', emoji: '🍰' },
    { name: 'Italian', slug: 'italian', emoji: '🍝' },
  ];
  const catResult = await db.collection('categories').insertMany(
    categoryDefs.map((c, i) => withTimestamps({ ...c, businessCount: 0, sortOrder: i, active: true, seoText: `The best ${c.name.toLowerCase()} takeaway offers near you.` })),
  );
  const cats: Record<string, Types.ObjectId> = {};
  categoryDefs.forEach((c, i) => (cats[c.slug] = catResult.insertedIds[i] as Types.ObjectId));
  await db.collection('areas').insertMany(STARTER_AREAS.map(withTimestamps));
  console.log('Seeded cuisines:', categoryDefs.length, '· areas:', STARTER_AREAS.length);

  // ---- Users ----
  const hash = await bcrypt.hash('Password123!', 10);
  const verified = new Date(Date.now() - 60 * DAY);
  // A shared, published secret is fine for local demos but would make 2FA worthless on a real site: in
  // production the staff accounts set up their own authenticator at first sign-in instead.
  const production = process.env.NODE_ENV === 'production';
  const staffTwoFactor = production ? { enabled: false } : { enabled: true, secretEnc: encryptSecret(DEV_TOTP_SECRET), enrolledAt: verified };
  const userDefs = [
    { key: 'admin', name: 'TruOffers Admin', email: 'admin@truoffers.co.uk', role: 'super_admin', twoFactor: staffTwoFactor },
    { key: 'moderator', name: 'Mia Moderator', email: 'moderator@truoffers.co.uk', role: 'moderator', twoFactor: staffTwoFactor },
    { key: 'owner', name: 'Marco Rossi', email: 'owner@bellanapoli.co.uk', role: 'business_owner', phone: '0113 496 0101' },
    { key: 'staff', name: 'Gina Bianchi', email: 'staff@bellanapoli.co.uk', role: 'business_staff' },
    { key: 'claimant', name: 'Li Wei', email: 'li@goldendragon.example', role: 'business_owner', phone: '0114 275 0103' },
    { key: 'customer', name: 'Demo Customer', email: 'customer@example.com', role: 'customer', postcode: 'M14 5TQ' },
    { key: 'customer2', name: 'Sam Taylor', email: 'sam@example.com', role: 'customer', postcode: 'B5 4TR' },
    { key: 'supplier', name: 'PackRight Supplies', email: 'sales@packright.co.uk', role: 'supplier' },
  ];
  const usersResult = await db.collection('users').insertMany(
    userDefs.map(({ key: _key, ...u }) =>
      withTimestamps({
        passwordHash: hash,
        status: 'active',
        provider: 'local',
        emailVerifiedAt: verified,
        offerAlerts: true,
        favouriteCuisines: [],
        savedOffers: [],
        followedBusinesses: [],
        twoFactor: { enabled: false },
        ...u,
      }),
    ),
  );
  const user: Record<string, Types.ObjectId> = {};
  userDefs.forEach((u, i) => (user[u.key] = usersResult.insertedIds[i] as Types.ObjectId));
  console.log('Seeded users:', userDefs.length, '(password for all: Password123!)');

  // ---- Businesses at every verification level ----
  const businessDefs = [
    {
      name: 'Bella Napoli', slug: 'bella-napoli', town: 'Leeds', postcode: 'LS6 3HN', postcodeArea: 'LS6',
      coords: [-1.5734, 53.8188], categories: [cats['pizza'], cats['italian']],
      description: 'Family-run Neapolitan pizzeria in Headingley. Wood-fired sourdough pizzas made with San Marzano tomatoes and fior di latte.',
      phone: '0113 496 0101', website: 'https://bellanapoli.example', orderUrl: 'https://order.bellanapoli.example/menu', isFoodbellClient: true,
      verificationLevel: 2, verifiedAt: inDays(-40), source: 'owner', trustScore: 86, featured: true,
      ownerId: user.owner, members: [{ userId: user.owner, role: 'owner', addedAt: inDays(-45) }, { userId: user.staff, role: 'staff', addedAt: inDays(-20), invitedBy: user.owner }],
      reviews: { provider: 'google', rating: 4.8, count: 412 }, address: '12 Otley Road, Headingley',
      openingHours: { monday: '17:00–22:30', tuesday: '17:00–22:30', wednesday: '17:00–22:30', thursday: '17:00–23:00', friday: '16:00–23:30', saturday: '12:00–23:30', sunday: '12:00–22:00' },
      socialLinks: { instagram: 'https://instagram.com/bellanapoli.example' },
    },
    {
      name: 'Spice Route', slug: 'spice-route', town: 'Manchester', postcode: 'M14 5TQ', postcodeArea: 'M14',
      coords: [-2.2338, 53.4451], categories: [cats['indian']],
      description: 'Authentic Punjabi kitchen on the Curry Mile. Famous for slow-cooked karahi and fresh tandoor breads.',
      phone: '0161 224 0102', website: 'https://spiceroute.example', orderUrl: 'https://spiceroute.example/order', isFoodbellClient: true,
      verificationLevel: 2, verifiedAt: inDays(-90), source: 'admin', trustScore: 82, featured: true,
      reviews: { provider: 'google', rating: 4.9, count: 655 }, address: '84 Wilmslow Road, Rusholme',
    },
    {
      name: 'Golden Dragon', slug: 'golden-dragon', town: 'Sheffield', postcode: 'S1 4PP', postcodeArea: 'S1',
      coords: [-1.4701, 53.3792], categories: [cats['chinese']],
      description: 'Cantonese classics and sizzling specials in Sheffield city centre since 1998.',
      phone: '0114 275 0103', website: 'https://goldendragon.example', orderUrl: 'https://goldendragon.example/order',
      // Level 1: Li Wei passed the phone check and the claim waits for a moderator
      verificationLevel: 1, source: 'admin', trustScore: 60,
      ownerId: user.claimant, members: [{ userId: user.claimant, role: 'owner', addedAt: inDays(-1) }],
      reviews: { provider: 'google', rating: 4.7, count: 289 }, address: '31 Matilda Street',
    },
    {
      name: 'Smokestack Grill', slug: 'smokestack-grill', town: 'Birmingham', postcode: 'B5 4TR', postcodeArea: 'B5',
      coords: [-1.8944, 52.4692], categories: [cats['burgers']],
      description: 'Smashed burgers, loaded fries and house-smoked brisket. Independent and proud.',
      phone: '0121 622 0104', website: 'https://smokestack.example',
      verificationLevel: 2, verifiedAt: inDays(-120), source: 'admin', trustScore: 70,
      reviews: { provider: 'google', rating: 4.5, count: 198 }, address: '7 Hurst Street',
    },
    {
      name: 'Neptune Fish Bar', slug: 'neptune-fish-bar', town: 'Whitby', postcode: 'YO21 3PR', postcodeArea: 'YO21',
      coords: [-0.6431, 54.4837], categories: [cats['fish-and-chips']],
      description: 'Fresh North Sea haddock, twice-cooked chips and homemade tartare by the harbour.',
      phone: '01947 600105', verificationLevel: 2, verifiedAt: inDays(-200), source: 'admin', trustScore: 78, featured: true,
      reviews: { provider: 'google', rating: 4.7, count: 521 }, address: '2 Pier Road',
    },
    {
      name: 'Anatolia Kebab House', slug: 'anatolia-kebab-house', town: 'Manchester', postcode: 'M14 6UP', postcodeArea: 'M14',
      coords: [-2.2301, 53.4488], categories: [cats['kebab']],
      description: 'Charcoal-grilled shish, doner carved to order and fresh flatbreads baked all day.',
      phone: '0161 225 0106', website: 'https://anatolia.example', verificationLevel: 0, source: 'import', trustScore: 40,
      importSource: { domain: 'anatolia.example', importedAt: inDays(-10), lastCheckedAt: inDays(-1) },
      reviews: { provider: 'google', rating: 4.4, count: 233 }, address: '112 Wilmslow Road',
    },
    {
      name: 'Bangkok Street Kitchen', slug: 'bangkok-street-kitchen', town: 'Leeds', postcode: 'LS1 6PU', postcodeArea: 'LS1',
      coords: [-1.5486, 53.7997], categories: [cats['thai']],
      description: 'Bold Thai street food: pad thai, massaman and papaya salad made to order.',
      phone: '0113 245 0107', verificationLevel: 0, source: 'admin', trustScore: 35,
      reviews: { provider: 'google', rating: 4.6, count: 167 }, address: '19 Call Lane',
    },
    {
      name: "Cluck 'n' Roll", slug: 'cluck-n-roll', town: 'Birmingham', postcode: 'B12 0XS', postcodeArea: 'B12',
      coords: [-1.8817, 52.4632], categories: [cats['chicken'], cats['burgers']],
      description: 'Buttermilk fried chicken burgers, wings and waffles. Halal certified.',
      phone: '0121 446 0108', verificationLevel: 0, source: 'admin', trustScore: 30,
      reviews: { provider: 'google', rating: 4.3, count: 145 }, address: '55 Ladypool Road',
    },
    {
      name: 'Gelato & Co', slug: 'gelato-and-co', town: 'Manchester', postcode: 'M4 1LZ', postcodeArea: 'M4',
      coords: [-2.2266, 53.4841], categories: [cats['desserts']],
      description: 'Artisan gelato, warm cookie dough and Belgian waffles in the Northern Quarter.',
      phone: '0161 832 0109', verificationLevel: 0, source: 'admin', trustScore: 28,
      reviews: { provider: 'google', rating: 4.6, count: 98 }, address: '40 Edge Street',
    },
    {
      name: 'Pizza Milano', slug: 'pizza-milano', town: 'Sheffield', postcode: 'S7 1FS', postcodeArea: 'S7',
      coords: [-1.4877, 53.3499], categories: [cats['pizza']],
      description: 'Stone-baked 16-inch pizzas and calzones, open till late.',
      phone: '0114 255 0110', verificationLevel: 0, source: 'admin', trustScore: 25,
      reviews: { provider: 'google', rating: 4.2, count: 176 }, address: '402 Abbeydale Road',
    },
  ];
  const bizResult = await db.collection('businesses').insertMany(
    businessDefs.map((b) => {
      const { coords, ...fields } = b as typeof b & { members?: unknown[]; verifiedAt?: Date };
      return withTimestamps({
        ...fields,
        status: 'active',
        location: { type: 'Point', coordinates: coords },
        reviews: { ...b.reviews, lastSync: new Date() },
        followerCount: 0,
        activeOfferCount: 0,
        featured: !!b.featured,
        isFoodbellClient: !!b.isFoodbellClient,
        delivery: true,
        collection: true,
        frozen: false,
        photos: [],
        members: (fields as { members?: unknown[] }).members ?? [],
        socialLinks: (fields as { socialLinks?: unknown }).socialLinks ?? {},
        ...((fields as { verifiedAt?: Date }).verifiedAt ? { reverificationDueAt: new Date((fields as { verifiedAt: Date }).verifiedAt.getTime() + 365 * DAY) } : {}),
        ...definedOnly(deriveBusinessIdentity({ name: b.name, phone: b.phone, postcode: b.postcode, website: (b as { website?: string }).website })),
      });
    }),
  );
  const biz: Record<string, Types.ObjectId> = {};
  businessDefs.forEach((b, i) => (biz[b.slug] = bizResult.insertedIds[i] as Types.ObjectId));
  for (const def of businessDefs) await db.collection('categories').updateMany({ _id: { $in: def.categories } }, { $inc: { businessCount: 1 } });
  console.log('Seeded businesses:', businessDefs.length, '(levels 0, 1 and 2)');

  // ---- Offers in every state ----
  const nextMonday = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
    d.setUTCHours(0, 0, 0, 0);
    return d;
  })();
  const offerDefs: Record<string, unknown>[] = [
    // Bella Napoli (Professional, auto-approve): the spec's "My offers" wireframe
    { key: 'bella-10', businessId: biz['bella-napoli'], title: '10% off your order', description: 'Order online and get 10% off everything.', discountType: 'percent', value: 10, displayLabel: '10% off', redemptionType: 'direct_link', redemptionUrl: 'https://order.bellanapoli.example/menu?promo=TRU10', terms: 'Online orders only.', status: 'active', impressions: 4100, flips: 340, detailViews: 190, orderClicks: 58, publishedAt: inDays(-30) },
    { key: 'bella-garlic', businessId: biz['bella-napoli'], title: 'Free garlic bread Tuesdays', description: 'Free garlic bread with any pizza order every Tuesday.', discountType: 'free_item', value: 0, displayLabel: 'Freebie', redemptionType: 'code', code: 'TRUGARLIC', terms: 'Tuesdays only, one per order.', eligibleWeekdays: ['tue'], status: 'active', impressions: 900, flips: 70, detailViews: 41, orderClicks: 12, publishedAt: inDays(-20) },
    { key: 'bella-2for1', businessId: biz['bella-napoli'], title: '2 for 1 pizzas Mon to Wed', description: 'Buy any pizza, get a second free, Monday to Wednesday.', discountType: 'bogof', value: 0, displayLabel: '2 for 1', redemptionType: 'show_in_store', terms: 'Show this screen in store. Collection only.', eligibleWeekdays: ['mon', 'tue', 'wed'], startsAt: nextMonday, status: 'scheduled' },
    { key: 'bella-5off', businessId: biz['bella-napoli'], title: '5 pounds off first order', description: 'New customers get £5 off their first order over £20.', discountType: 'fixed', value: 5, displayLabel: '£5 off', minOrder: 20, redemptionType: 'direct_link', redemptionUrl: 'https://lovetinos.co.uk/order', newCustomersOnly: true, terms: 'New customers only.', status: 'pending', moderationFlags: ['link_domain_mismatch'] },
    // Spice Route
    { key: 'spice-freedel', businessId: biz['spice-route'], title: 'Free delivery all week', description: 'Free delivery on every order this week — no minimum spend.', discountType: 'free_delivery', value: 0, displayLabel: 'Free delivery', redemptionType: 'direct_link', redemptionUrl: 'https://spiceroute.example/order?promo=freedel', terms: 'Delivery radius 3 miles.', endsAt: inDays(2), status: 'active', impressions: 3200, flips: 260, detailViews: 150, orderClicks: 71, publishedAt: inDays(-5) },
    { key: 'spice-20', businessId: biz['spice-route'], title: '20% off orders over £15', description: 'Get 20% off your whole order when you spend £15 or more.', discountType: 'percent', value: 20, displayLabel: '20% off', minOrder: 15, redemptionType: 'code', code: 'TRU20', terms: 'Not valid with other offers.', endsAt: inDays(5), status: 'active', impressions: 2800, flips: 210, detailViews: 120, orderClicks: 44, publishedAt: inDays(-3) },
    // Golden Dragon (level 1): saved as a draft until it is verified
    { key: 'dragon-5', businessId: biz['golden-dragon'], title: '£5 off your first collection order', description: 'New customers get £5 off any collection order over £20.', discountType: 'fixed', value: 5, displayLabel: '£5 off', minOrder: 20, redemptionType: 'phone', terms: 'New customers only. Mention TruOffers when you call.', status: 'draft', submitWhenVerified: true },
    // Smokestack (verified, Free plan)
    { key: 'smoke-2for1', businessId: biz['smokestack-grill'], title: '2 for 1 on all burgers Mon–Wed', description: 'Buy any burger, get a second free. Every Monday to Wednesday.', discountType: 'bogof', value: 0, displayLabel: '2 for 1', redemptionType: 'show_in_store', terms: 'Show this screen in store. Dine-in and collection only.', eligibleWeekdays: ['mon', 'tue', 'wed'], status: 'active', impressions: 2100, flips: 190, detailViews: 120, orderClicks: 25, publishedAt: inDays(-12) },
    // Neptune (verified, Free plan: every offer reviewed)
    { key: 'neptune-10', businessId: biz['neptune-fish-bar'], title: '10% off collection before 5pm', description: 'Beat the queue — 10% off all collection orders placed before 5pm.', discountType: 'percent', value: 10, displayLabel: '10% off', redemptionType: 'phone', terms: 'Mention TruOffers when you call.', dailyStartTime: '11:30', dailyEndTime: '17:00', status: 'active', impressions: 700, flips: 52, detailViews: 30, orderClicks: 9, publishedAt: inDays(-25) },
    { key: 'neptune-drink', businessId: biz['neptune-fish-bar'], title: 'Free can of drink with any fish supper', description: 'Any fish supper comes with a free soft drink.', discountType: 'free_item', value: 0, displayLabel: 'Freebie', redemptionType: 'show_in_store', terms: 'Collection only.', status: 'pending' },
    // Anatolia (unclaimed): imported from its website, approved by an admin — looks identical to owner offers
    { key: 'anatolia-wrap', businessId: biz['anatolia-kebab-house'], title: 'Free can of drink with any wrap', description: 'Any wrap comes with a free soft drink of your choice.', discountType: 'free_item', value: 0, displayLabel: 'Freebie', redemptionType: 'show_in_store', terms: 'Collection only.', status: 'active', origin: 'scraper', managedBy: 'scraper_managed', sourceDomain: 'anatolia.example', lastCheckedAt: inDays(-1), impressions: 410, flips: 33, publishedAt: inDays(-9) },
    // An expired one to re-post
    { key: 'bella-expired', businessId: biz['bella-napoli'], title: 'Half-price calzone launch week', description: 'Our new calzone at half price for launch week.', discountType: 'percent', value: 50, displayLabel: '50% off', redemptionType: 'show_in_store', endsAt: inDays(-3), expiredAt: inDays(-3), status: 'expired' },
  ];
  const offerIds: Record<string, Types.ObjectId> = {};
  for (const def of offerDefs) {
    const { key, ...fields } = def;
    const offer = {
      collection: true, delivery: true, minOrder: 0, maxRedemptions: 0, redemptionCount: 0, excludedItems: [], origin: 'merchant',
      verification: 'unverified', submitWhenVerified: false, featured: false, impressions: 0, flips: 0, detailViews: 0, orderClicks: 0, ...fields,
    } as Record<string, unknown>;
    const contentFingerprint = fingerprintOfPublishedOffer(offer as never);
    const live = ['draft', 'pending', 'active', 'scheduled', 'paused', 'hidden_by_reports'].includes(offer.status as string);
    const result = await db.collection('offers').insertOne(withTimestamps({ ...offer, contentFingerprint, ...(live ? { dedupeKey: `${offer.businessId}:${contentFingerprint}` } : {}) }));
    offerIds[key as string] = result.insertedId as Types.ObjectId;
  }
  for (const id of Object.values(biz)) {
    const count = await db.collection('offers').countDocuments({ businessId: id, status: 'active' });
    await db.collection('businesses').updateOne({ _id: id }, { $set: { activeOfferCount: count } });
  }
  console.log('Seeded offers:', offerDefs.length, '(live, scheduled, pending, draft, expired)');

  // ---- Menu (Bella Napoli) ----
  const menu = [
    { section: 'Pizzas', name: 'Margherita', description: 'San Marzano tomato, fior di latte, basil', price: 9.5 },
    { section: 'Pizzas', name: 'Diavola', description: 'Spicy salami, chilli honey, mozzarella', price: 12 },
    { section: 'Pizzas', name: 'Quattro Formaggi', description: 'Mozzarella, gorgonzola, parmesan, taleggio', price: 12.5 },
    { section: 'Sides', name: 'Garlic Bread', description: 'Wood-fired with rosemary', price: 5 },
    { section: 'Sides', name: 'Burrata', description: 'With cherry tomatoes and basil oil', price: 7.5 },
    { section: 'Drinks', name: 'San Pellegrino', description: 'Limonata or Aranciata', price: 2.5 },
  ];
  await db.collection('menuitems').insertMany(menu.map((m, i) => withTimestamps({ ...m, businessId: biz['bella-napoli'], sortOrder: i })));

  // ---- A claim waiting for a moderator (Golden Dragon) ----
  const claimId = new Types.ObjectId();
  const submittedAt = new Date(Date.now() - 5 * 3600 * 1000);
  await db.collection('claims').insertOne(
    withTimestamps({
      _id: claimId,
      businessId: biz['golden-dragon'],
      userId: user.claimant,
      kind: 'existing',
      status: 'pending',
      phoneOtpPassed: true,
      phoneCheck: { phone: '+441142750103', channel: 'sms', mode: 'mock', sentAt: submittedAt, passedAt: submittedAt, attempts: 1, sends: 1 },
      domainCheckPassed: false,
      domainCheck: { domain: 'goldendragon.example', siteToken: randomBytes(12).toString('base64url'), attempts: 0 },
      fhrsMatch: true,
      fhrs: { fhrsId: '1234567', name: 'Golden Dragon', address: '31 Matilda Street, Sheffield', postcode: 'S1 4PP', rating: '5', nameMatches: true, postcodeMatches: true, checkedAt: submittedAt },
      shopPhotoCode: '482-913',
      checklist: {},
      messages: [{ _id: new Types.ObjectId(), from: 'owner', userId: user.claimant, body: 'I have run Golden Dragon since 2015. The rates bill is attached.', createdAt: submittedAt }],
      submittedAt,
    }),
  );
  const docKey = writePrivateFile(minimalPdf('Business rates bill — Golden Dragon, 31 Matilda Street, Sheffield S1 4PP'));
  await db.collection('claimdocuments').insertOne({ claimId, type: 'business_rates', storageKey: docKey, originalName: 'rates-bill.pdf', mime: 'application/pdf', size: 900, status: 'pending', uploadedAt: submittedAt });
  console.log('Seeded a claim waiting for review (Golden Dragon, with a rates bill and an FHRS match)');

  // ---- A locked-field change waiting for a moderator (Bella Napoli's order link) ----
  await db.collection('businesschangerequests').insertOne(
    withTimestamps({ businessId: biz['bella-napoli'], requestedBy: user.owner, status: 'pending', orderLinkCheck: 'ordering_provider', changes: [{ field: 'orderUrl', from: 'https://order.bellanapoli.example/menu', to: 'https://www.foodhub.co.uk/leeds/bella-napoli' }] }),
  );

  // ---- Subscriptions and invoices: Bella Napoli on Professional ----
  const subId = new Types.ObjectId();
  await db.collection('subscriptions').insertOne(
    withTimestamps({ _id: subId, businessId: biz['bella-napoli'], userId: user.owner, planKey: 'professional', interval: 'monthly', price: 39.99, status: 'active', currentPeriodEnd: inDays(12), cancelAtPeriodEnd: false, comp: false, reminderCount: 0 }),
  );
  await db.collection('payments').insertMany([
    paymentDoc(biz['bella-napoli'], subId, 'TO-2026-000001', 'Professional plan (monthly)', 39.99, inDays(-48)),
    paymentDoc(biz['bella-napoli'], subId, 'TO-2026-000002', 'Professional plan renewal (monthly)', 39.99, inDays(-18)),
  ]);

  // ---- Promotions ----
  const promoPayment = paymentDoc(biz['bella-napoli'], undefined, 'TO-2026-000003', 'Top of search: 10% off your order', 24.99, inDays(-2));
  const promoPaymentId = (await db.collection('payments').insertOne({ ...promoPayment, kind: 'promotion' })).insertedId;
  await db.collection('promotions').insertMany([
    withTimestamps({ businessId: biz['bella-napoli'], offerId: offerIds['bella-10'], productKey: 'top_of_search', scope: { area: 'LS6' }, startsAt: inDays(-2), endsAt: inDays(5), unit: 'week', quantity: 1, price: 24.99, status: 'active', source: 'purchase', paymentId: promoPaymentId, createdBy: user.owner, totalSpent: 0, liveNotifiedAt: inDays(-2) }),
    withTimestamps({ businessId: biz['spice-route'], offerId: offerIds['spice-freedel'], productKey: 'flash_deal', scope: {}, startsAt: inDays(-1), endsAt: inDays(1), unit: 'deal', quantity: 1, price: 0, status: 'active', source: 'admin_grant', grantedBy: user.admin, note: 'Launch thank-you', totalSpent: 0, liveNotifiedAt: inDays(-1) }),
    withTimestamps({ businessId: biz['spice-route'], offerId: offerIds['spice-20'], productKey: 'homepage_spot', scope: {}, startsAt: inDays(-3), endsAt: inDays(4), unit: 'week', quantity: 1, price: 0, status: 'active', source: 'admin_grant', grantedBy: user.admin, totalSpent: 0, liveNotifiedAt: inDays(-3) }),
  ]);
  console.log('Seeded promotions: Top of search (LS6), a flash deal and a homepage spot');

  // ---- An offer report case (two reports on Smokestack's 2 for 1) ----
  const caseId = new Types.ObjectId();
  await db.collection('reportcases').insertOne(
    withTimestamps({ _id: caseId, offerId: offerIds['smoke-2for1'], businessId: biz['smokestack-grill'], status: 'open', reportCount: 2, firstReportAt: inDays(-2), latestReportAt: inDays(-1), autoHidden: false, businessReplies: [] }),
  );
  await db.collection('reports').insertMany([
    withTimestamps({ offerId: offerIds['smoke-2for1'], businessId: biz['smokestack-grill'], reporterId: user.customer2, reporterEmail: 'sam@example.com', reporterKey: sha256(`user:${user.customer2}`), reason: 'not_honoured', note: 'They said the 2 for 1 only applies to the classic burger.', status: 'open', createdAt: inDays(-2) }),
    withTimestamps({ offerId: offerIds['smoke-2for1'], businessId: biz['smokestack-grill'], reporterEmail: 'guest@example.com', reporterKey: sha256('device:seed-guest'), reason: 'wrong_terms', status: 'open', createdAt: inDays(-1) }),
  ]);
  console.log('Seeded an open report case (2 reports)');

  // ---- Follows, notifications ----
  await db.collection('users').updateOne({ _id: user.customer }, { $set: { followedBusinesses: [String(biz['spice-route']), String(biz['anatolia-kebab-house'])], savedOffers: [String(offerIds['spice-20'])] } });
  await db.collection('businesses').updateMany({ _id: { $in: [biz['spice-route'], biz['anatolia-kebab-house']] } }, { $inc: { followerCount: 1 } });
  await db.collection('notifications').insertMany([
    { userId: user.owner, businessId: biz['bella-napoli'], type: 'offer_approved', title: '“Free garlic bread Tuesdays” is approved', body: 'It is live now.', link: '/dashboard/offers', createdAt: inDays(-20) },
    { userId: user.owner, businessId: biz['bella-napoli'], type: 'promotion_live', title: 'Top of search is live', body: '“10% off your order” is promoted until next week.', link: '/dashboard/promote', createdAt: inDays(-2) },
  ]);

  // ---- Suppliers (unchanged; phase 2) ----
  const supplierDefs = [
    { name: 'PackRight Supplies', slug: 'packright-supplies', category: 'packaging', description: 'Eco-friendly takeaway packaging: pizza boxes, kraft bowls, branded bags. Next-day delivery across the UK.', serviceArea: 'UK-wide', ownerId: user.supplier, verificationStatus: 'verified', email: 'sales@packright.co.uk', phone: '0800 484 0201', featured: true, leadCount: 1 },
    { name: 'TillPoint EPOS', slug: 'tillpoint-epos', category: 'epos', description: 'EPOS systems built for takeaways: order screens, caller ID, delivery mapping and Foodbell integration.', serviceArea: 'England & Wales', verificationStatus: 'claimed', email: 'hello@tillpoint.example', featured: false, leadCount: 0 },
    { name: 'FryFresh Oils', slug: 'fryfresh-oils', category: 'ingredients', description: 'Premium frying oils with free used-oil collection and waste compliance certificates.', serviceArea: 'North of England', verificationStatus: 'unclaimed', featured: false, leadCount: 0 },
  ];
  const supResult = await db.collection('suppliers').insertMany(supplierDefs.map(withTimestamps));
  await db.collection('leads').insertOne(
    withTimestamps({ supplierId: supResult.insertedIds[0], fromUserId: user.owner, fromBusinessId: biz['bella-napoli'], contactName: 'Marco Rossi', contactEmail: 'owner@bellanapoli.co.uk', message: 'Looking for branded 12-inch pizza boxes, roughly 500/week. Can you quote?', type: 'quote_request', status: 'new', valueEstimate: 250 }),
  );

  // ---- Content ----
  await db.collection('sitecontents').insertMany([
    withTimestamps({ key: 'faqs', value: STARTER_FAQS }),
    withTimestamps({ key: 'banners', value: [{ id: String(new Types.ObjectId()), text: 'Takeaway owners: claim your listing free and post your first offer today.', link: '/claim-your-business', tone: 'sun', active: true }] }),
    withTimestamps({ key: 'home', value: { featuredTakeaways: { mode: 'auto', ids: [] }, topPicks: { mode: 'auto', ids: [] }, flashDeals: { mode: 'auto', ids: [] } } }),
  ]);
  await db.collection('helppages').insertMany(STARTER_HELP_PAGES.map(withTimestamps));

  // ---- Analytics: 14 days of events for the verified takeaways ----
  const events: Record<string, unknown>[] = [];
  const eventOffers: [Types.ObjectId, Types.ObjectId][] = [
    [biz['bella-napoli'], offerIds['bella-10']],
    [biz['bella-napoli'], offerIds['bella-garlic']],
    [biz['spice-route'], offerIds['spice-freedel']],
    [biz['spice-route'], offerIds['spice-20']],
    [biz['smokestack-grill'], offerIds['smoke-2for1']],
  ];
  const areas = ['M14', 'LS6', 'S1', 'B5', 'M20', 'LS1'];
  for (let day = 0; day < 14; day++) {
    const dayDate = new Date(Date.now() - day * DAY);
    for (const [businessId, offerId] of eventOffers) {
      const n = 6 + Math.floor(Math.random() * 18);
      for (let i = 0; i < n; i++) {
        const roll = Math.random();
        const eventName =
          roll < 0.45 ? 'offer_impression'
          : roll < 0.6 ? 'offer_flip'
          : roll < 0.72 ? 'business_profile_view'
          : roll < 0.8 ? 'offer_detail_view'
          : roll < 0.9 ? 'order_click'
          : roll < 0.95 ? 'code_copy'
          : 'call_click';
        events.push({ eventName, businessId, offerId: eventName === 'business_profile_view' || eventName === 'call_click' ? undefined : offerId, postcodeArea: areas[Math.floor(Math.random() * areas.length)], metadata: {}, createdAt: new Date(dayDate.getTime() - Math.random() * 12 * 3600 * 1000) });
      }
    }
    events.push({ eventName: 'postcode_search', postcodeArea: areas[Math.floor(Math.random() * areas.length)], metadata: {}, createdAt: dayDate });
  }
  await db.collection('analyticsevents').insertMany(events.map((e) => definedOnly(e)));
  console.log('Seeded analytics events:', events.length);

  // ---- Scraper: an example provider policy, deliberately left unreviewed ----
  await db.collection('providerpolicies').insertOne(
    withTimestamps({
      name: 'OrderNest (example provider)',
      status: 'unknown',
      autoCreated: false,
      basisNotes: 'Fictional ordering provider used by the scraper test fixtures. Safe to delete.',
      detection: { hostSuffixes: ['ordernest.test'], cnameSuffixes: [], footerPatterns: ['Powered by OrderNest'], generatorPatterns: ['OrderNest Sites'], assetHosts: ['cdn.ordernest.test'] },
    }),
  );

  // The MVP migration has nothing to do on a fresh seed.
  await db.collection('migrations').insertMany(
    ['mvp-users-email-v1', 'mvp-claims-v1', 'mvp-plans-v1', 'mvp-catalogues-v1'].map((id) => ({ _id: id as unknown as Types.ObjectId, at: new Date(), result: 'seeded' })),
  );

  await db.collection('businesses').createIndex({ location: '2dsphere' });
  await db.collection('businesses').createIndex({ slug: 1 }, { unique: true });
  await db.collection('users').createIndex({ email: 1 }, { unique: true });

  console.log('\nSeed complete. Demo logins (password for all: Password123!):');
  console.log('  Super admin:    admin@truoffers.co.uk       (2FA)');
  console.log('  Moderator:      moderator@truoffers.co.uk   (2FA)');
  console.log('  Business owner: owner@bellanapoli.co.uk     (Bella Napoli, verified, Professional plan)');
  console.log('  Business staff: staff@bellanapoli.co.uk     (Bella Napoli team)');
  console.log('  Claimant:       li@goldendragon.example     (Golden Dragon, claim waiting for review)');
  console.log('  Customer:       customer@example.com');
  console.log('  Supplier:       sales@packright.co.uk');
  if (production) {
    console.log('\nStaff two-factor: each staff account sets up its authenticator app at its first sign-in.');
    console.log('Change the seeded passwords straight away (or remove the demo accounts).');
  } else {
    console.log(`\nStaff two-factor (dev only): add this to an authenticator app, or set ADMIN_2FA_DISABLED=true in backend/.env`);
    console.log(`  Secret: ${DEV_TOTP_SECRET}`);
    console.log(`  ${otpauthUrl(DEV_TOTP_SECRET, 'admin@truoffers.co.uk')}`);
  }
  await mongoose.disconnect();
}

function paymentDoc(businessId: Types.ObjectId, subscriptionId: Types.ObjectId | undefined, number: string, description: string, net: number, at: Date) {
  const vat = Math.round(net * 20) / 100;
  return definedOnly({
    businessId,
    subscriptionId,
    kind: 'subscription',
    description,
    amount: net,
    vat,
    total: Math.round((net + vat) * 100) / 100,
    currency: 'gbp',
    status: 'paid',
    refundedAmount: 0,
    number,
    paidAt: at,
    mock: true,
    createdAt: at,
    updatedAt: at,
  });
}

/** A one-page PDF with a line of text, so the seeded claim has a document to open. */
function minimalPdf(text: string): Buffer {
  const content = `BT /F1 14 Tf 60 760 Td (${text.replace(/[()\\]/g, '')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function writePrivateFile(buffer: Buffer): string {
  const root = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'));
  const now = new Date();
  const key = `private/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomBytes(16).toString('hex')}.pdf`;
  mkdirSync(path.dirname(path.join(root, key)), { recursive: true });
  writeFileSync(path.join(root, key), buffer);
  return key;
}

function definedOnly<T extends object>(fields: T): Partial<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function withTimestamps<T extends object>(doc: T) {
  const now = new Date();
  return { createdAt: now, updatedAt: now, ...doc };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
