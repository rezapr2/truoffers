/**
 * MVP migration: moves an existing database to the MVP spec's model. Idempotent; each one-off step records
 * itself in the `migrations` collection and is skipped next time, so admin edits made afterwards are kept.
 *
 *   npm run migrate:mvp                                  (local, ts-node)
 *   docker compose exec api npm run migrate:mvp:prod     (production image)
 *
 * 1. Staff roles: support_admin becomes moderator, sales_admin becomes admin.
 * 2. Existing accounts count as email-verified (once); new sign-ups verify by email.
 * 3. Businesses: verificationStatus becomes verificationLevel (0-3); "Foodbell verified" becomes the separate
 *    Foodbell partner tag; the owner becomes the first team member; source and delivery/collection defaults.
 * 4. Claims filed before the MVP flow get the new fields (kind, phone check result, submission date).
 * 5. Plans get the plan editor's structure; the spec's MVP plans are set up once (Free, Standard,
 *    Professional on sale; Starter and Premium hidden).
 * 6. Promotion products, offer types, site settings and starter content (once); missing settings get defaults.
 * 7. Wallet-funded daily promotions end (their wallet balances are reported, not touched).
 * 8. Cuisines get the taxonomy fields.
 * 9. Indexes for every new collection.
 */
import 'reflect-metadata';
import mongoose, { Model, Schema } from 'mongoose';
import { PromotionStatus, Role } from '../common/enums';
import { DEFAULT_OFFER_TYPES } from '../content/content.service';
import { DEFAULT_PROMOTION_PRODUCTS } from '../promotions/promotions.service';
import { AdminAuditLog, AdminAuditLogSchema } from '../schemas/admin-audit-log.schema';
import { Business, BusinessSchema } from '../schemas/business.schema';
import { BusinessChangeRequest, BusinessChangeRequestSchema, BusinessInvite, BusinessInviteSchema } from '../schemas/business-team.schema';
import { Category, CategorySchema } from '../schemas/category.schema';
import { Claim, ClaimFile, ClaimFileSchema, ClaimSchema } from '../schemas/claim.schema';
import { EmailLog, EmailLogSchema, EmailTemplate, EmailTemplateSchema } from '../schemas/email.schema';
import { LoginEvent, LoginEventSchema } from '../schemas/login-event.schema';
import { Notification, NotificationSchema } from '../schemas/notification.schema';
import { Offer, OfferSchema } from '../schemas/offer.schema';
import { Coupon, CouponSchema, Payment, PaymentSchema, StripeEvent, StripeEventSchema } from '../schemas/payment.schema';
import { Plan, PlanSchema } from '../schemas/plan.schema';
import { Promotion, PromotionProduct, PromotionProductSchema, PromotionSchema } from '../schemas/promotion.schema';
import { BusinessStrike, BusinessStrikeSchema, Report, ReportBlock, ReportBlockSchema, ReportCase, ReportCaseSchema, ReportSchema } from '../schemas/report.schema';
import { SiteSettings, SiteSettingsSchema } from '../schemas/site-settings.schema';
import { Subscription, SubscriptionSchema } from '../schemas/subscription.schema';
import { Area, AreaSchema, HelpPage, HelpPageSchema, OfferTypeConfig, OfferTypeConfigSchema, SiteContent, SiteContentSchema } from '../schemas/taxonomy.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { loadDotEnv, MVP_PLANS, STARTER_AREAS, STARTER_FAQS, STARTER_HELP_PAGES, SUPPLIER_PLANS } from '../seed/mvp-defaults';

loadDotEnv();
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/truoffers';

function model(name: string, schema: Schema<any>): Model<any> {
  return mongoose.models[name] ?? mongoose.model(name, schema);
}

const LEVEL_BY_STATUS: Record<string, number> = {
  unclaimed: 0,
  claimed: 1,
  verified: 2,
  foodbell_verified: 2,
  trusted_partner: 2,
  franchise_verified: 2,
};

async function once(db: mongoose.mongo.Db, id: string, step: () => Promise<string>) {
  const migrations = db.collection<{ _id: string; at: Date; result: string }>('migrations');
  if (await migrations.findOne({ _id: id })) {
    console.log(`  ${id}: already done`);
    return;
  }
  const result = await step();
  await migrations.insertOne({ _id: id, at: new Date(), result });
  console.log(`  ${id}: ${result}`);
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db!;
  console.log('MVP migration on', MONGODB_URI.replace(/\/\/[^@]*@/, '//***@'));

  // 1. Staff roles (always safe to repeat)
  const moderators = await db.collection('users').updateMany({ role: Role.SUPPORT_ADMIN }, { $set: { role: Role.MODERATOR } });
  const admins = await db.collection('users').updateMany({ role: Role.SALES_ADMIN }, { $set: { role: Role.ADMIN } });
  console.log(`  roles: ${moderators.modifiedCount} support_admin → moderator, ${admins.modifiedCount} sales_admin → admin`);

  // 2. Existing accounts are treated as verified once; everyone who signs up from now on confirms by email.
  await once(db, 'mvp-users-email-v1', async () => {
    const result = await db.collection('users').updateMany(
      { emailVerifiedAt: { $exists: false }, status: { $ne: 'deleted' } },
      [{ $set: { emailVerifiedAt: { $ifNull: ['$createdAt', '$$NOW'] }, offerAlerts: { $ifNull: ['$offerAlerts', true] } } }],
    );
    return `${result.modifiedCount} existing account(s) marked email-verified`;
  });

  // 3. Businesses (idempotent: only rows without a verificationLevel)
  const businesses = db.collection('businesses');
  let migrated = 0;
  for await (const b of businesses.find({ verificationLevel: { $exists: false } })) {
    const status = (b.verificationStatus as string | undefined) ?? 'unclaimed';
    let level = LEVEL_BY_STATUS[status] ?? 0;
    // "Claimed" without an owner is just unclaimed.
    if (level === 1 && !b.ownerId) level = 0;
    const set: Record<string, unknown> = {
      verificationLevel: level,
      source: b.importSource ? 'import' : b.ownerId ? 'owner' : 'admin',
      delivery: b.delivery ?? true,
      collection: b.collection ?? true,
      frozen: false,
      socialLinks: b.socialLinks ?? {},
    };
    if (status === 'foodbell_verified') set.isFoodbellClient = true;
    if (level >= 2) {
      const verifiedAt = (b.updatedAt as Date | undefined) ?? new Date();
      set.verifiedAt = verifiedAt;
      set.reverificationDueAt = new Date(new Date(verifiedAt).setMonth(verifiedAt.getMonth() + 12));
    }
    if (b.ownerId && !(b.members as unknown[] | undefined)?.length) {
      set.members = [{ userId: b.ownerId, role: 'owner', addedAt: (b.updatedAt as Date | undefined) ?? new Date() }];
    }
    await businesses.updateOne({ _id: b._id }, { $set: set, $unset: { verificationStatus: 1 } });
    migrated++;
  }
  console.log(`  businesses: ${migrated} moved to verification levels and teams`);

  // 4. Claims from before the MVP flow
  await once(db, 'mvp-claims-v1', async () => {
    let count = 0;
    for await (const c of db.collection('claims').find({ kind: { $exists: false } })) {
      const set: Record<string, unknown> = {
        kind: 'existing',
        phoneOtpPassed: !!c.otpVerified,
        domainCheckPassed: false,
        fhrsMatch: false,
        messages: c.evidence ? [{ from: 'owner', body: `Evidence given with the original claim: ${c.evidence}`, createdAt: c.createdAt }] : [],
        checklist: {},
        phoneCheck: { attempts: 0, sends: 0 },
        domainCheck: { attempts: 0 },
      };
      // The driver would store undefined as null, so absent values are left out.
      if (c.status === 'pending') set.submittedAt = c.createdAt;
      if (['approved', 'rejected'].includes(c.status)) set.decidedAt = c.updatedAt;
      if (c.reviewedBy) set.reviewerId = c.reviewedBy;
      if (c.reviewNote) set.notes = c.reviewNote;
      await db.collection('claims').updateOne({ _id: c._id }, { $set: set, $unset: { otpCode: 1, otpVerified: 1, reviewedBy: 1, reviewNote: 1, riskLevel: 1 } });
      count++;
    }
    return `${count} claim(s) given the verification fields`;
  });

  // 5. Plans
  await once(db, 'mvp-plans-v1', async () => {
    const plans = db.collection('plans');
    for (const plan of [...MVP_PLANS, ...SUPPLIER_PLANS]) {
      await plans.updateOne({ key: plan.key }, { $set: { ...plan, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date(), stripe: {} } }, { upsert: true });
    }
    return `${MVP_PLANS.length} takeaway and ${SUPPLIER_PLANS.length} supplier plan(s) set up (Free, Standard, Professional on sale)`;
  });

  // 6. Catalogues and settings
  await once(db, 'mvp-catalogues-v1', async () => {
    const products = db.collection('promotionproducts');
    for (const product of DEFAULT_PROMOTION_PRODUCTS) {
      await products.updateOne({ key: product.key }, { $setOnInsert: { ...product, active: true, createdAt: new Date(), updatedAt: new Date() } }, { upsert: true });
    }
    for (const type of DEFAULT_OFFER_TYPES) {
      await db.collection('offertypes').updateOne({ key: type.key }, { $setOnInsert: { ...type, createdAt: new Date(), updatedAt: new Date() } }, { upsert: true });
    }
    await db.collection('sitesettings').updateOne({ key: 'site' }, { $setOnInsert: { key: 'site', createdAt: new Date() } }, { upsert: true });
    await db.collection('sitecontents').updateOne({ key: 'faqs' }, { $setOnInsert: { key: 'faqs', value: STARTER_FAQS } }, { upsert: true });
    for (const page of STARTER_HELP_PAGES) {
      await db.collection('helppages').updateOne({ slug: page.slug }, { $setOnInsert: { ...page, createdAt: new Date(), updatedAt: new Date() } }, { upsert: true });
    }
    // Towns that already have takeaways become areas.
    const towns: string[] = (await businesses.distinct('town', { status: 'active', town: { $nin: [null, ''] } })) as string[];
    let order = 0;
    for (const town of towns) {
      const starter = STARTER_AREAS.find((a) => a.slug === town.toLowerCase());
      await db.collection('areas').updateOne(
        { slug: town.toLowerCase() },
        { $setOnInsert: { name: town, slug: town.toLowerCase(), sortOrder: order++, active: true, postcodeDistricts: starter?.postcodeDistricts ?? [], ...(starter?.seoText ? { seoText: starter.seoText } : {}), createdAt: new Date(), updatedAt: new Date() } },
        { upsert: true },
      );
    }
    return 'promotion products, offer types, settings, FAQs, help pages and areas created';
  });

  // 6b. The step above created the settings document with only its key. Fill every missing field with its
  // default (ordering providers, moderation rules, report thresholds, VAT) so nothing reads an empty value.
  await once(db, 'mvp-settings-defaults-v1', async () => {
    const stored = ((await db.collection('sitesettings').findOne({ key: 'site' })) ?? {}) as Record<string, unknown>;
    const defaults = new (model(SiteSettings.name, SiteSettingsSchema))({ key: 'site' }).toObject() as Record<string, unknown>;
    const missing = Object.fromEntries(Object.entries(defaults).filter(([field]) => field !== '_id' && stored[field] === undefined));
    await db.collection('sitesettings').updateOne({ key: 'site' }, { $set: { ...missing, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
    return `site settings: ${Object.keys(missing).length} default field(s) filled in`;
  });

  // 7. Wallet promotions
  const legacy = await db.collection('promotions').updateMany(
    { dailyRate: { $exists: true }, productKey: { $exists: false }, status: { $in: ['active', 'paused'] } },
    { $set: { status: PromotionStatus.ENDED, endedAt: new Date(), legacy: true } },
  );
  const wallets = await db.collection('wallets').countDocuments({ balance: { $gt: 0 } }).catch(() => 0);
  console.log(`  promotions: ${legacy.modifiedCount} wallet promotion(s) ended; ${wallets} wallet(s) still hold a balance (refund or credit them by hand)`);

  // 8. Cuisines
  let sort = 0;
  for await (const category of db.collection('categories').find({ sortOrder: { $exists: false } }).sort({ businessCount: -1 })) {
    await db.collection('categories').updateOne({ _id: category._id }, { $set: { sortOrder: sort++, active: true } });
  }
  console.log(`  cuisines: ${sort} given sort order`);

  // 9. Indexes (create only; nothing is dropped)
  const models: [string, Schema<any>][] = [
    [User.name, UserSchema],
    [LoginEvent.name, LoginEventSchema],
    [Business.name, BusinessSchema],
    [BusinessInvite.name, BusinessInviteSchema],
    [BusinessChangeRequest.name, BusinessChangeRequestSchema],
    [Claim.name, ClaimSchema],
    [ClaimFile.name, ClaimFileSchema],
    [Offer.name, OfferSchema],
    [Plan.name, PlanSchema],
    [Subscription.name, SubscriptionSchema],
    [Payment.name, PaymentSchema],
    [Coupon.name, CouponSchema],
    [StripeEvent.name, StripeEventSchema],
    [Promotion.name, PromotionSchema],
    [PromotionProduct.name, PromotionProductSchema],
    [Report.name, ReportSchema],
    [ReportCase.name, ReportCaseSchema],
    [BusinessStrike.name, BusinessStrikeSchema],
    [ReportBlock.name, ReportBlockSchema],
    [Notification.name, NotificationSchema],
    [EmailTemplate.name, EmailTemplateSchema],
    [EmailLog.name, EmailLogSchema],
    [SiteSettings.name, SiteSettingsSchema],
    [Category.name, CategorySchema],
    [Area.name, AreaSchema],
    [OfferTypeConfig.name, OfferTypeConfigSchema],
    [SiteContent.name, SiteContentSchema],
    [HelpPage.name, HelpPageSchema],
    [AdminAuditLog.name, AdminAuditLogSchema],
  ];
  for (const [name, schema] of models) await model(name, schema).createIndexes();
  console.log(`  indexes: ensured for ${models.length} collections`);

  console.log('MVP migration complete.');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
