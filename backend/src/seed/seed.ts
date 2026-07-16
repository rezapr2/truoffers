/**
 * TruOffers seed script.
 * Run with: npm run seed
 * Creates plans, categories, demo users, businesses, offers, menus and suppliers.
 */
import 'reflect-metadata';
import mongoose from 'mongoose';
import * as bcrypt from 'bcryptjs';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/truoffers';

async function main() {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db!;
  console.log('Connected to', MONGODB_URI);

  // Wipe (idempotent seed for dev)
  const collections = [
    'users', 'businesses', 'offers', 'categories', 'claims', 'menuitems',
    'suppliers', 'leads', 'plans', 'subscriptions', 'analyticsevents', 'redemptions',
  ];
  for (const c of collections) {
    await db.collection(c).deleteMany({});
  }

  // ---- Plans (blueprint section 6) ----
  const plans = [
    {
      key: 'free', name: 'Free', audience: 'takeaway', monthlyPrice: 0, annualPrice: 0,
      bestFor: 'Every takeaway', sortOrder: 0,
      limits: { maxLiveOffers: 2, maxPhotos: 5, verifiedBadge: false, analytics: 'none' },
      features: ['Claim profile', '2 live offers', '5 photos', 'Contact details', 'Order link', 'Basic menu'],
    },
    {
      key: 'starter', name: 'Starter', audience: 'takeaway', monthlyPrice: 9.99, annualPrice: 99,
      bestFor: 'Small shops testing offers', sortOrder: 1,
      limits: { maxLiveOffers: 5, maxPhotos: 15, verifiedBadge: true, analytics: 'basic' },
      features: ['5 live offers', 'Verified badge after checks', '15 photos', 'Basic analytics', 'Opening hours', 'Social links'],
    },
    {
      key: 'standard', name: 'Standard', audience: 'takeaway', monthlyPrice: 19.99, annualPrice: 199,
      bestFor: 'Most independent takeaways', sortOrder: 2,
      limits: { maxLiveOffers: -1, maxPhotos: 30, verifiedBadge: true, analytics: 'basic', scheduledOffers: true, couponCodes: true },
      features: ['Unlimited offers', 'Menu sections', 'Scheduled offers', 'Coupon code field', 'Gallery', 'Google review widget', 'Ranking boost'],
    },
    {
      key: 'professional', name: 'Professional', audience: 'takeaway', monthlyPrice: 39.99, annualPrice: 399,
      bestFor: 'Growth-focused takeaways', sortOrder: 3,
      limits: { maxLiveOffers: -1, maxPhotos: 60, verifiedBadge: true, analytics: 'advanced', scheduledOffers: true, couponCodes: true, featuredPlacement: true, aiOfferWriter: true, qrCodes: true, prioritySupport: true },
      features: ['Featured local placement', 'Advanced analytics', 'AI offer writer', 'QR codes', 'Monthly performance report', 'Priority support'],
    },
    {
      key: 'premium', name: 'Premium', audience: 'takeaway', monthlyPrice: 79.99, annualPrice: 799,
      bestFor: 'High-volume shops / multi-branch', sortOrder: 4,
      limits: { maxLiveOffers: -1, maxPhotos: 120, verifiedBadge: true, analytics: 'advanced', scheduledOffers: true, couponCodes: true, featuredPlacement: true, aiOfferWriter: true, qrCodes: true, prioritySupport: true, multiBranch: true },
      features: ['Homepage/category rotation', 'Multiple branches', 'Campaign scheduling', 'API/feed import', 'Competitor offer tracking'],
    },
    {
      key: 'supplier_free', name: 'Supplier Free', audience: 'supplier', monthlyPrice: 0, annualPrice: 0,
      bestFor: 'Getting started', sortOrder: 10,
      limits: {}, features: ['Basic supplier page', 'Contact form', '1 category'],
    },
    {
      key: 'supplier_pro', name: 'Supplier Pro', audience: 'supplier', monthlyPrice: 29.99, annualPrice: 299,
      bestFor: 'Growing suppliers', sortOrder: 11,
      limits: {}, features: ['Featured category placement', 'Quote requests', 'Gallery', 'Offers to takeaways'],
    },
    {
      key: 'supplier_elite', name: 'Supplier Elite', audience: 'supplier', monthlyPrice: 79.99, annualPrice: 799,
      bestFor: 'Market leaders', sortOrder: 12,
      limits: {}, features: ['Homepage/category sponsorship', 'Lead dashboard', 'Promoted articles', 'Territory targeting'],
    },
  ];
  await db.collection('plans').insertMany(plans.map(withTimestamps));
  console.log('Seeded plans:', plans.length);

  // ---- Categories ----
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
    categoryDefs.map((c) => withTimestamps({ ...c, businessCount: 0 })),
  );
  const cats: Record<string, mongoose.Types.ObjectId> = {};
  categoryDefs.forEach((c, i) => (cats[c.slug] = catResult.insertedIds[i] as mongoose.Types.ObjectId));
  console.log('Seeded categories:', categoryDefs.length);

  // ---- Users ----
  const hash = await bcrypt.hash('Password123!', 10);
  const usersResult = await db.collection('users').insertMany([
    withTimestamps({ name: 'TruOffers Admin', email: 'admin@truoffers.co.uk', passwordHash: hash, role: 'super_admin', status: 'active', favouriteCuisines: [], savedOffers: [], followedBusinesses: [] }),
    withTimestamps({ name: 'Marco Rossi', email: 'owner@bellanapoli.co.uk', passwordHash: hash, role: 'business_owner', status: 'active', phone: '0113 496 0101', favouriteCuisines: [], savedOffers: [], followedBusinesses: [] }),
    withTimestamps({ name: 'Demo Customer', email: 'customer@example.com', passwordHash: hash, role: 'customer', status: 'active', postcode: 'M14 5TQ', favouriteCuisines: ['pizza', 'indian'], savedOffers: [], followedBusinesses: [] }),
    withTimestamps({ name: 'PackRight Supplies', email: 'sales@packright.co.uk', passwordHash: hash, role: 'supplier', status: 'active', favouriteCuisines: [], savedOffers: [], followedBusinesses: [] }),
  ]);
  const [adminId, ownerId, customerId, supplierUserId] = Object.values(usersResult.insertedIds);
  console.log('Seeded users: 4 (password for all: Password123!)');

  // ---- Businesses ----
  const businessDefs: any[] = [
    {
      name: 'Bella Napoli', slug: 'bella-napoli', town: 'Leeds', postcode: 'LS6 3HN', postcodeArea: 'LS6',
      coords: [-1.5734, 53.8188], categories: [cats['pizza'], cats['italian']],
      description: 'Family-run Neapolitan pizzeria in Headingley. Wood-fired sourdough pizzas made with San Marzano tomatoes and fior di latte.',
      phone: '0113 496 0101', orderUrl: 'https://order.bellanapoli.example/foodbell', isFoodbellClient: true,
      verificationStatus: 'foodbell_verified', ownerId, trustScore: 86, featured: true,
      reviews: { provider: 'google', rating: 4.8, count: 412 },
      address: '12 Otley Road, Headingley',
    },
    {
      name: 'Spice Route', slug: 'spice-route', town: 'Manchester', postcode: 'M14 5TQ', postcodeArea: 'M14',
      coords: [-2.2338, 53.4451], categories: [cats['indian']],
      description: 'Authentic Punjabi kitchen on the Curry Mile. Famous for slow-cooked karahi and fresh tandoor breads.',
      phone: '0161 224 0102', orderUrl: 'https://order.spiceroute.example/foodbell', isFoodbellClient: true,
      verificationStatus: 'verified', ownerId: null, trustScore: 82, featured: true,
      reviews: { provider: 'google', rating: 4.9, count: 655 },
      address: '84 Wilmslow Road, Rusholme',
    },
    {
      name: 'Golden Dragon', slug: 'golden-dragon', town: 'Sheffield', postcode: 'S1 4PP', postcodeArea: 'S1',
      coords: [-1.4701, 53.3792], categories: [cats['chinese']],
      description: 'Cantonese classics and sizzling specials in Sheffield city centre since 1998.',
      phone: '0114 275 0103', orderUrl: 'https://goldendragon.example/order',
      verificationStatus: 'verified', ownerId: null, trustScore: 74,
      reviews: { provider: 'google', rating: 4.7, count: 289 },
      address: '31 Matilda Street',
    },
    {
      name: 'Smokestack Grill', slug: 'smokestack-grill', town: 'Birmingham', postcode: 'B5 4TR', postcodeArea: 'B5',
      coords: [-1.8944, 52.4692], categories: [cats['burgers']],
      description: 'Smashed burgers, loaded fries and house-smoked brisket. Independent and proud.',
      phone: '0121 622 0104',
      verificationStatus: 'unclaimed', ownerId: null, trustScore: 40,
      reviews: { provider: 'google', rating: 4.5, count: 198 },
      address: '7 Hurst Street',
    },
    {
      name: 'Neptune Fish Bar', slug: 'neptune-fish-bar', town: 'Whitby', postcode: 'YO21 3PR', postcodeArea: 'YO21',
      coords: [-0.6431, 54.4837], categories: [cats['fish-and-chips']],
      description: 'Fresh North Sea haddock, twice-cooked chips and homemade tartare by the harbour.',
      phone: '01947 600105',
      verificationStatus: 'verified', ownerId: null, trustScore: 78, featured: true,
      reviews: { provider: 'google', rating: 4.7, count: 521 },
      address: '2 Pier Road',
    },
    {
      name: 'Anatolia Kebab House', slug: 'anatolia-kebab-house', town: 'Manchester', postcode: 'M14 6UP', postcodeArea: 'M14',
      coords: [-2.2301, 53.4488], categories: [cats['kebab']],
      description: 'Charcoal-grilled shish, doner carved to order and fresh flatbreads baked all day.',
      phone: '0161 225 0106',
      verificationStatus: 'claimed', ownerId: null, trustScore: 55,
      reviews: { provider: 'google', rating: 4.4, count: 233 },
      address: '112 Wilmslow Road',
    },
    {
      name: 'Bangkok Street Kitchen', slug: 'bangkok-street-kitchen', town: 'Leeds', postcode: 'LS1 6PU', postcodeArea: 'LS1',
      coords: [-1.5486, 53.7997], categories: [cats['thai']],
      description: 'Bold Thai street food: pad thai, massaman and papaya salad made to order.',
      phone: '0113 245 0107',
      verificationStatus: 'unclaimed', ownerId: null, trustScore: 35,
      reviews: { provider: 'google', rating: 4.6, count: 167 },
      address: '19 Call Lane',
    },
    {
      name: "Cluck 'n' Roll", slug: 'cluck-n-roll', town: 'Birmingham', postcode: 'B12 0XS', postcodeArea: 'B12',
      coords: [-1.8817, 52.4632], categories: [cats['chicken'], cats['burgers']],
      description: 'Buttermilk fried chicken burgers, wings and waffles. Halal certified.',
      phone: '0121 446 0108',
      verificationStatus: 'unclaimed', ownerId: null, trustScore: 30,
      reviews: { provider: 'google', rating: 4.3, count: 145 },
      address: '55 Ladypool Road',
    },
    {
      name: 'Gelato & Co', slug: 'gelato-and-co', town: 'Manchester', postcode: 'M4 1LZ', postcodeArea: 'M4',
      coords: [-2.2266, 53.4841], categories: [cats['desserts']],
      description: 'Artisan gelato, warm cookie dough and Belgian waffles in the Northern Quarter.',
      phone: '0161 832 0109',
      verificationStatus: 'unclaimed', ownerId: null, trustScore: 28,
      reviews: { provider: 'google', rating: 4.6, count: 98 },
      address: '40 Edge Street',
    },
    {
      name: 'Pizza Milano', slug: 'pizza-milano', town: 'Sheffield', postcode: 'S7 1FS', postcodeArea: 'S7',
      coords: [-1.4877, 53.3499], categories: [cats['pizza']],
      description: 'Stone-baked 16-inch pizzas and calzones, open till late.',
      phone: '0114 255 0110',
      verificationStatus: 'unclaimed', ownerId: null, trustScore: 25,
      reviews: { provider: 'google', rating: 4.2, count: 176 },
      address: '402 Abbeydale Road',
    },
  ];

  const bizResult = await db.collection('businesses').insertMany(
    businessDefs.map((b) =>
      withTimestamps({
        name: b.name, slug: b.slug, description: b.description, status: 'active',
        verificationStatus: b.verificationStatus, trustScore: b.trustScore,
        ownerId: b.ownerId, categories: b.categories, address: b.address,
        postcode: b.postcode, postcodeArea: b.postcodeArea, town: b.town,
        location: { type: 'Point', coordinates: b.coords },
        phone: b.phone, orderUrl: b.orderUrl || null, isFoodbellClient: !!b.isFoodbellClient,
        reviews: { ...b.reviews, lastSync: new Date() },
        followerCount: Math.floor(Math.random() * 120), activeOfferCount: 0,
        featured: !!b.featured, photos: [],
      }),
    ),
  );
  const bizIds = businessDefs.map((_, i) => bizResult.insertedIds[i] as mongoose.Types.ObjectId);
  const biz = Object.fromEntries(businessDefs.map((b, i) => [b.slug, bizIds[i]]));
  console.log('Seeded businesses:', businessDefs.length);

  // Update category business counts
  for (const def of businessDefs) {
    await db.collection('categories').updateMany(
      { _id: { $in: def.categories } },
      { $inc: { businessCount: 1 } },
    );
  }

  // ---- Offers (matching the approved homepage design) ----
  const inDays = (d: number) => new Date(Date.now() + d * 24 * 3600 * 1000);
  const offerDefs = [
    {
      businessId: biz['bella-napoli'], title: '20% off orders over £15',
      description: 'Get 20% off your whole order when you spend £15 or more. Collection and delivery.',
      discountType: 'percent', value: 20, displayLabel: '20% off', minOrder: 15,
      redemptionType: 'code', code: 'TRU20', terms: 'Valid until Sunday. Not valid with other offers.',
      endsAt: inDays(4), status: 'active',
      impressions: 4100, flips: 340, detailViews: 190, orderClicks: 58,
    },
    {
      businessId: biz['spice-route'], title: 'Free delivery all week',
      description: 'Free delivery on every order this week — no minimum spend.',
      discountType: 'free_delivery', value: 0, displayLabel: 'Free del.',
      redemptionType: 'direct_link', redemptionUrl: 'https://order.spiceroute.example/foodbell?promo=freedel',
      terms: 'Ends Friday. Delivery radius 3 miles.', endsAt: inDays(2), status: 'active',
      impressions: 3200, flips: 260, detailViews: 150, orderClicks: 71,
    },
    {
      businessId: biz['smokestack-grill'], title: '2 for 1 on all burgers Mon–Wed',
      description: 'Buy any burger, get a second free. Every Monday to Wednesday.',
      discountType: 'bogof', value: 0, displayLabel: '2 for 1',
      redemptionType: 'show_in_store', terms: 'Show this screen in store. Dine-in and collection only.',
      status: 'active',
      impressions: 2100, flips: 190, detailViews: 120, orderClicks: 25,
    },
    {
      businessId: biz['golden-dragon'], title: '£5 off your first collection order',
      description: 'New customers get £5 off any collection order over £20.',
      discountType: 'fixed', value: 5, displayLabel: '£5 off', minOrder: 20,
      redemptionType: 'code', code: 'TRU5NEW', terms: 'New customers only. One use per customer.',
      maxRedemptions: 50, status: 'active',
      impressions: 1800, flips: 140, detailViews: 90, orderClicks: 31,
    },
    {
      businessId: biz['bella-napoli'], title: 'Free garlic bread on Tuesdays',
      description: 'Free garlic bread with any pizza order every Tuesday.',
      discountType: 'meal_deal', value: 0, displayLabel: 'Freebie',
      redemptionType: 'code', code: 'TRUGARLIC', terms: 'Tuesdays only, one per order.',
      status: 'active', impressions: 900, flips: 70, detailViews: 41, orderClicks: 12,
    },
    {
      businessId: biz['neptune-fish-bar'], title: '10% off collection before 5pm',
      description: 'Beat the queue — 10% off all collection orders placed before 5pm.',
      discountType: 'percent', value: 10, displayLabel: '10% off',
      redemptionType: 'phone', terms: 'Mention TruOffers when you call.',
      status: 'active', impressions: 700, flips: 52, detailViews: 30, orderClicks: 9,
    },
    {
      businessId: biz['anatolia-kebab-house'], title: 'Free can of drink with any wrap',
      description: 'Any wrap comes with a free soft drink of your choice.',
      discountType: 'meal_deal', value: 0, displayLabel: 'Freebie',
      redemptionType: 'show_in_store', terms: 'Collection only.',
      status: 'pending',
      impressions: 0, flips: 0, detailViews: 0, orderClicks: 0,
    },
    {
      businessId: biz['bangkok-street-kitchen'], title: '15% off first order',
      description: 'Try us for the first time and get 15% off.',
      discountType: 'percent', value: 15, displayLabel: '15% off',
      redemptionType: 'code', code: 'TRUTHAI15', terms: 'New customers only.',
      status: 'pending',
      impressions: 0, flips: 0, detailViews: 0, orderClicks: 0,
    },
  ];
  await db.collection('offers').insertMany(
    offerDefs.map((o) =>
      withTimestamps({
        collection: true, delivery: true, minOrder: 0, maxRedemptions: 0,
        redemptionCount: 0, excludedItems: [], ...o,
      }),
    ),
  );
  // Refresh denormalised active offer counts
  for (const id of bizIds) {
    const count = await db.collection('offers').countDocuments({ businessId: id, status: 'active' });
    await db.collection('businesses').updateOne({ _id: id }, { $set: { activeOfferCount: count } });
  }
  console.log('Seeded offers:', offerDefs.length);

  // ---- Menu (Bella Napoli demo) ----
  const menu = [
    { section: 'Pizzas', name: 'Margherita', description: 'San Marzano tomato, fior di latte, basil', price: 9.5 },
    { section: 'Pizzas', name: 'Diavola', description: 'Spicy salami, chilli honey, mozzarella', price: 12 },
    { section: 'Pizzas', name: 'Quattro Formaggi', description: 'Mozzarella, gorgonzola, parmesan, taleggio', price: 12.5 },
    { section: 'Sides', name: 'Garlic Bread', description: 'Wood-fired with rosemary', price: 5 },
    { section: 'Sides', name: 'Burrata', description: 'With cherry tomatoes and basil oil', price: 7.5 },
    { section: 'Drinks', name: 'San Pellegrino', description: 'Limonata or Aranciata', price: 2.5 },
  ];
  await db.collection('menuitems').insertMany(
    menu.map((m, i) => withTimestamps({ ...m, businessId: biz['bella-napoli'], sortOrder: i })),
  );
  console.log('Seeded menu items:', menu.length);

  // ---- Suppliers ----
  const supplierDefs = [
    {
      name: 'PackRight Supplies', slug: 'packright-supplies', category: 'packaging',
      description: 'Eco-friendly takeaway packaging: pizza boxes, kraft bowls, branded bags. Next-day delivery across the UK.',
      serviceArea: 'UK-wide', ownerId: supplierUserId, verificationStatus: 'verified',
      email: 'sales@packright.co.uk', phone: '0800 484 0201', featured: true, leadCount: 2,
    },
    {
      name: 'TillPoint EPOS', slug: 'tillpoint-epos', category: 'epos',
      description: 'EPOS systems built for takeaways: order screens, caller ID, delivery mapping and Foodbell integration.',
      serviceArea: 'England & Wales', verificationStatus: 'claimed',
      email: 'hello@tillpoint.example', featured: false, leadCount: 0,
    },
    {
      name: 'FryFresh Oils', slug: 'fryfresh-oils', category: 'ingredients',
      description: 'Premium frying oils with free used-oil collection and waste compliance certificates.',
      serviceArea: 'North of England', verificationStatus: 'unclaimed',
      featured: false, leadCount: 0,
    },
  ];
  const supResult = await db.collection('suppliers').insertMany(supplierDefs.map(withTimestamps));
  console.log('Seeded suppliers:', supplierDefs.length);

  // ---- Demo lead ----
  await db.collection('leads').insertMany([
    withTimestamps({
      supplierId: supResult.insertedIds[0], fromUserId: ownerId, fromBusinessId: biz['bella-napoli'],
      contactName: 'Marco Rossi', contactEmail: 'owner@bellanapoli.co.uk',
      message: 'Looking for branded 12-inch pizza boxes, roughly 500/week. Can you quote?',
      type: 'quote_request', status: 'new', valueEstimate: 250,
    }),
  ]);

  // ---- Demo subscription: Bella Napoli on Professional ----
  await db.collection('subscriptions').insertMany([
    withTimestamps({
      businessId: biz['bella-napoli'], userId: ownerId, planKey: 'professional',
      interval: 'monthly', price: 39.99, status: 'active',
      currentPeriodEnd: inDays(30),
    }),
  ]);

  // ---- Sample analytics events for the last 14 days ----
  const events: any[] = [];
  const eventBiz = [biz['bella-napoli'], biz['spice-route'], biz['golden-dragon']];
  const areas = ['M14', 'LS6', 'S1', 'B5', 'M20', 'LS1'];
  for (let day = 0; day < 14; day++) {
    const dayDate = new Date(Date.now() - day * 24 * 3600 * 1000);
    for (const businessId of eventBiz) {
      const n = 5 + Math.floor(Math.random() * 20);
      for (let i = 0; i < n; i++) {
        const roll = Math.random();
        const eventName =
          roll < 0.5 ? 'offer_impression'
          : roll < 0.7 ? 'offer_flip'
          : roll < 0.85 ? 'business_profile_view'
          : roll < 0.95 ? 'order_click'
          : 'call_click';
        events.push({
          eventName, businessId,
          postcodeArea: areas[Math.floor(Math.random() * areas.length)],
          sessionId: `seed-${day}-${i}`, metadata: {},
          createdAt: new Date(dayDate.getTime() - Math.random() * 12 * 3600 * 1000),
        });
      }
    }
    events.push({
      eventName: 'postcode_search',
      postcodeArea: areas[Math.floor(Math.random() * areas.length)],
      sessionId: `seed-search-${day}`, metadata: {},
      createdAt: dayDate,
    });
  }
  await db.collection('analyticsevents').insertMany(events);
  console.log('Seeded analytics events:', events.length);

  // Indexes used by geo search
  await db.collection('businesses').createIndex({ location: '2dsphere' });
  await db.collection('businesses').createIndex({ slug: 1 }, { unique: true });
  await db.collection('users').createIndex({ email: 1 }, { unique: true });

  console.log('\nSeed complete. Demo logins (password: Password123!):');
  console.log('  Admin:          admin@truoffers.co.uk');
  console.log('  Business owner: owner@bellanapoli.co.uk (owns Bella Napoli, Professional plan)');
  console.log('  Customer:       customer@example.com');
  console.log('  Supplier:       sales@packright.co.uk (owns PackRight Supplies)');
  await mongoose.disconnect();
}

function withTimestamps(doc: any) {
  const now = new Date();
  return { createdAt: now, updatedAt: now, ...doc };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
