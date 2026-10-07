import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The MVP's starting data, shared by the seed (fresh databases) and the migration (existing ones). Everything
 * here is editable in the admin panel afterwards.
 */

// Spec "Recommended MVP plans": Free, Standard and Professional are on sale; Starter and Premium stay in the
// plan editor, hidden, ready to re-enable without code.
export const MVP_PLANS = [
  {
    key: 'free',
    name: 'Free',
    audience: 'takeaway',
    monthlyPrice: 0,
    annualPrice: 0,
    trialDays: 0,
    bestFor: 'Every takeaway',
    limits: { maxLiveOffers: 2, maxPhotos: 5, maxBranches: 1 },
    flags: { scheduledOffers: false, couponCodes: false, analytics: 'views', aiOfferWriter: false, qrCodes: false, rankingBoost: 0, prioritySupport: false, freeTopOfSearchWeeksPerMonth: 0 },
    features: ['Claim your listing and profile', '2 live offers', '5 photos', 'Order link and contact details', 'Every offer checked by our team', 'Views in Insights'],
    autoApprove: false,
    isPublic: true,
    archived: false,
    sortOrder: 0,
  },
  {
    key: 'starter',
    name: 'Starter',
    audience: 'takeaway',
    monthlyPrice: 9.99,
    annualPrice: 99,
    trialDays: 0,
    bestFor: 'Small shops testing offers',
    limits: { maxLiveOffers: 5, maxPhotos: 15, maxBranches: 1 },
    flags: { scheduledOffers: false, couponCodes: true, analytics: 'views', aiOfferWriter: false, qrCodes: false, rankingBoost: 0, prioritySupport: false, freeTopOfSearchWeeksPerMonth: 0 },
    features: ['5 live offers', '15 photos', 'Coupon codes', 'Basic Insights'],
    autoApprove: false,
    isPublic: false,
    archived: true,
    sortOrder: 5,
  },
  {
    key: 'standard',
    name: 'Standard',
    audience: 'takeaway',
    monthlyPrice: 19.99,
    annualPrice: 199,
    trialDays: 0,
    bestFor: 'Most independent takeaways',
    limits: { maxLiveOffers: -1, maxPhotos: 20, maxBranches: 1 },
    flags: { scheduledOffers: true, couponCodes: true, analytics: 'full', aiOfferWriter: false, qrCodes: false, rankingBoost: 1, prioritySupport: false, freeTopOfSearchWeeksPerMonth: 0 },
    features: ['Unlimited live offers', '20 photos', 'Offers go live straight away once verified', 'Full Insights per offer and per day', 'Scheduled offers', 'Coupon codes', 'Ranking boost'],
    autoApprove: true,
    isPublic: true,
    archived: false,
    sortOrder: 1,
    badgeText: 'Most popular',
  },
  {
    key: 'professional',
    name: 'Professional',
    audience: 'takeaway',
    monthlyPrice: 39.99,
    annualPrice: 399,
    trialDays: 0,
    bestFor: 'Growth-focused takeaways',
    limits: { maxLiveOffers: -1, maxPhotos: 50, maxBranches: 1 },
    flags: { scheduledOffers: true, couponCodes: true, analytics: 'full_report', aiOfferWriter: true, qrCodes: true, rankingBoost: 2, prioritySupport: true, freeTopOfSearchWeeksPerMonth: 1 },
    features: ['Everything in Standard', '50 photos', 'Monthly email report', 'Higher ranking boost', '1 free Top-of-search week every month', 'QR poster', 'Priority support'],
    autoApprove: true,
    isPublic: true,
    archived: false,
    sortOrder: 2,
  },
  {
    key: 'premium',
    name: 'Premium',
    audience: 'takeaway',
    monthlyPrice: 79.99,
    annualPrice: 799,
    trialDays: 0,
    bestFor: 'High-volume shops and multi-branch',
    limits: { maxLiveOffers: -1, maxPhotos: 120, maxBranches: 10 },
    flags: { scheduledOffers: true, couponCodes: true, analytics: 'full_report', aiOfferWriter: true, qrCodes: true, rankingBoost: 2, prioritySupport: true, freeTopOfSearchWeeksPerMonth: 1 },
    features: ['Everything in Professional', 'Multiple branches', '120 photos'],
    autoApprove: true,
    isPublic: false,
    archived: true,
    sortOrder: 6,
  },
];

// Supplier plans wait for phase 2; their pages stay as they are.
export const SUPPLIER_PLANS = [
  { key: 'supplier_free', name: 'Supplier Free', audience: 'supplier', monthlyPrice: 0, annualPrice: 0, bestFor: 'Getting started', sortOrder: 10, features: ['Basic supplier page', 'Contact form', '1 category'] },
  { key: 'supplier_pro', name: 'Supplier Pro', audience: 'supplier', monthlyPrice: 29.99, annualPrice: 299, bestFor: 'Growing suppliers', sortOrder: 11, badgeText: 'Most popular', features: ['Featured category placement', 'Quote requests', 'Gallery', 'Offers to takeaways'] },
  { key: 'supplier_elite', name: 'Supplier Elite', audience: 'supplier', monthlyPrice: 79.99, annualPrice: 799, bestFor: 'Market leaders', sortOrder: 12, features: ['Homepage/category sponsorship', 'Lead dashboard', 'Promoted articles', 'Territory targeting'] },
].map((p) => ({
  ...p,
  trialDays: 0,
  limits: { maxLiveOffers: 0, maxPhotos: 0, maxBranches: 1 },
  flags: { scheduledOffers: false, couponCodes: false, analytics: 'views', aiOfferWriter: false, qrCodes: false, rankingBoost: 0, prioritySupport: false, freeTopOfSearchWeeksPerMonth: 0 },
  autoApprove: false,
  isPublic: true,
  archived: false,
}));

export const STARTER_FAQS = [
  { question: 'Do I need an account to use an offer?', answer: 'No. Tap an offer to see how to redeem it: order online, copy a code, call, or show the screen in the shop. An account is only for following takeaways and getting offer alerts.' },
  { question: 'What does “✓ TruOffers verified” mean?', answer: 'Our team has checked that the people running the listing own the takeaway: they proved access to the shop’s phone line and sent evidence such as a business document. Listings without the badge show “Not verified”.' },
  { question: 'An offer was not honoured. What can I do?', answer: 'Use “Report this offer” on the offer. Our team reviews every report and removes offers that are not honoured. We never share who reported.' },
  { question: 'I own a takeaway. How do I get listed?', answer: 'Search for your takeaway on “Claim your business”. If it is listed, claim it; if not, add it. Either way we send a code to the shop phone, then you upload some evidence and a moderator verifies you, usually within a working day.' },
  { question: 'Does TruOffers take commission on orders?', answer: 'No. Customers order directly from the takeaway. Takeaways pay a flat monthly plan if they want more offers and features, and can promote offers for a fixed price.' },
];

export const STARTER_HELP_PAGES = [
  {
    slug: 'getting-verified',
    title: 'Getting your takeaway verified',
    body: 'Verification proves you run the takeaway, and unlocks live offers, plans and promotions.\n\n1. Claim your listing, or add it if it is not on TruOffers yet.\n\n2. We send a 6-digit code by text or automated call to the phone number on the listing. Enter it to prove you have access to the shop line.\n\n3. Add at least one more piece of evidence: a document showing the business name and address (food business registration, business rates bill, utility bill or bank letter, dated within 3 months), a check on your website or business email, your Food Hygiene Rating listing, or a photo of the shop front with your claim code written on paper.\n\n4. A moderator reviews it, usually within 1 working day. We email you when it is done.',
    published: true,
    sortOrder: 0,
  },
  {
    slug: 'posting-offers',
    title: 'Posting an offer',
    body: 'From your dashboard choose “Post an offer” and follow the four steps: the type of offer, the details, how customers redeem it, and when it runs.\n\nOnce your business is verified, offers on Standard and Professional go live straight away unless they need a check (for example a very large discount, or a link to a website that is not yours). Offers on the Free plan are checked by our team first.\n\nYou can pause, edit, duplicate or promote an offer from “My offers”.',
    published: true,
    sortOrder: 1,
  },
];

// Starter blog posts about how TruOffers works. Admins edit or remove them in Content → Blog.
export const STARTER_BLOG_POSTS = [
  {
    slug: 'how-truoffers-verifies-takeaways',
    title: 'How TruOffers verifies takeaways',
    excerpt: 'What the “✓ TruOffers verified” badge means, and the checks a takeaway passes before it gets one.',
    tags: ['For customers', 'For owners'],
    body: [
      'Every offer on TruOffers belongs to a real takeaway, and the badge next to its name tells you whether our team has checked who runs it.',
      '## What the badge means',
      '“✓ TruOffers verified” means the people managing the listing have proved they run the takeaway. Listings without that proof say “Not verified”. Both can show offers, but only verified takeaways can publish offers without a check from our team.',
      '## The checks',
      '- A 6-digit code sent by text or automated call to the shop’s phone number, so the person claiming the listing has access to the shop line.',
      '- At least one more piece of evidence: a recent business document, a check on the takeaway’s own website or business email, its Food Hygiene Rating listing, or a photo of the shop front with a code written on paper.',
      '- A review by a moderator, who compares the evidence with the listing and checks the order link goes to the takeaway’s own website or a known ordering provider.',
      '## Keeping it accurate',
      'Changes to a verified takeaway’s name, address, phone number or order link wait for a moderator before they show, and every verification is renewed once a year. If something looks wrong, use “Report this offer” and our team will look into it.',
    ].join('\n\n'),
  },
  {
    slug: 'cutting-marketplace-fees',
    title: 'Cutting marketplace fees without losing orders',
    excerpt: 'A practical guide for takeaways that want more orders through their own website or phone line.',
    tags: ['For owners'],
    body: [
      'Marketplace apps bring orders, but the commission on each one adds up. Many takeaways keep the apps for reach and use offers to move regular customers to ordering direct.',
      '## Give people a reason to order direct',
      'An offer that only works on your own website or by phone, such as free garlic bread over £20 or 10% off collection, gives customers a clear reason to skip the app next time.',
      '## Make ordering direct easy',
      '- Put your own order link on your listing, so every offer sends people straight to it.',
      '- Show your phone number for customers who prefer to call.',
      '- Keep your menu up to date so nobody is surprised by prices.',
      '## Keep customers coming back',
      'Customers can follow your takeaway on TruOffers and get an alert when you post a new offer. A new offer every week or two keeps you in front of them without paying commission on the order.',
      '## Measure it',
      'Your dashboard shows how many people saw each offer, opened it and tapped through to order or call, so you can see which offers bring orders and run more of those.',
    ].join('\n\n'),
  },
  {
    slug: 'getting-the-most-from-takeaway-offers',
    title: 'Getting the most from takeaway offers',
    excerpt: 'How to find the best deals near you, and how to use them when you order.',
    tags: ['For customers'],
    body: [
      'TruOffers lists live offers from takeaways near you, from percentage discounts to meal deals and free extras.',
      '## Search by postcode',
      'Enter your postcode to see offers from takeaways around you, nearest first. Filter by cuisine, delivery or collection, or show verified takeaways only.',
      '## Check how to redeem',
      'Tap an offer to see how it works: some are applied when you order online, some need a code at checkout, some work when you call, and some you show on your phone in the shop. The terms, minimum spend and the days it runs are on the offer.',
      '## Follow your favourites',
      'Follow a takeaway to get an alert when it posts a new offer. You can turn alerts off at any time on your account page.',
      '## Something not right?',
      'If a takeaway does not honour an offer, use “Report this offer”. Our team reviews every report and removes offers that are not honoured.',
    ].join('\n\n'),
  },
].map((p) => ({ ...p, status: 'published', authorName: 'TruOffers team' }));

export const STARTER_AREAS = [
  { name: 'Leeds', slug: 'leeds', sortOrder: 0, postcodeDistricts: ['LS1', 'LS6'], seoText: 'Takeaway offers across Leeds, from Headingley pizzerias to city-centre street food.' },
  { name: 'Manchester', slug: 'manchester', sortOrder: 1, postcodeDistricts: ['M4', 'M14'], seoText: 'Live takeaway deals in Manchester, including the Curry Mile in Rusholme.' },
  { name: 'Sheffield', slug: 'sheffield', sortOrder: 2, postcodeDistricts: ['S1', 'S7'], seoText: 'Takeaway offers in Sheffield, verified by the TruOffers team.' },
  { name: 'Birmingham', slug: 'birmingham', sortOrder: 3, postcodeDistricts: ['B5', 'B12'], seoText: 'The best takeaway deals in Birmingham, ordered direct with no marketplace mark-up.' },
  { name: 'Whitby', slug: 'whitby', sortOrder: 4, postcodeDistricts: ['YO21'], seoText: 'Fish and chips and more by the harbour in Whitby.' },
].map((a) => ({ ...a, active: true }));

/** Scripts run outside Nest, so they read backend/.env themselves (the settings encryption key depends on it). */
export function loadDotEnv(file = path.join(process.cwd(), '.env')) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}
