/**
 * Website import robot migration (phases 1 and 2). Idempotent; run on every deploy that changes the robot,
 * before starting the worker.
 *
 *   npm run migrate:scraper                                  (local, ts-node)
 *   docker compose exec api npm run migrate:scraper:prod     (production image)
 *
 * 1. Backfills Business identity fields (E.164 phone, canonical postcode, normalised name, website host).
 * 2. Reports listings that share a postcode and normalised name, which the new unique index forbids.
 *    The migration stops there unless --skip-duplicates is passed, in which case the newer listing of
 *    each pair is left without a normalised name (so it can't collide) until an admin merges them.
 * 3. Backfills Offer provenance defaults, content fingerprints and dedupe keys; identical live offers
 *    for one business keep a key only on the oldest and are reported.
 * 4. Creates the scraper indexes (including Phase 2 fingerprints, authorised networks and the one-current-
 *    version-per-adapter index), registers the code adapters and the settings document.
 */
import 'reflect-metadata';
import mongoose, { Model, Schema, Types } from 'mongoose';
import { deriveBusinessIdentity } from '../common/business-identity';
import { LIVE_OFFER_STATUSES, OfferStatus } from '../common/enums';
import { OfferOrigin, OfferVerification } from '../common/scraper.enums';
import { AdapterRegistry } from '../scraper/extraction/adapter-registry.service';
import { fingerprintOfPublishedOffer } from '../scraper/lifecycle/offer-mapping';
import { AdminAuditLog, AdminAuditLogSchema } from '../schemas/admin-audit-log.schema';
import { Business, BusinessSchema } from '../schemas/business.schema';
import { DomainCrawlConfig, DomainCrawlConfigSchema } from '../schemas/domain-crawl-config.schema';
import { DomainOptOut, DomainOptOutSchema } from '../schemas/domain-opt-out.schema';
import { ExtractedOfferCandidate, ExtractedOfferCandidateSchema } from '../schemas/extracted-offer-candidate.schema';
import { ImportJob, ImportJobSchema } from '../schemas/import-job.schema';
import { Offer, OfferSchema } from '../schemas/offer.schema';
import { ProviderPolicy, ProviderPolicySchema } from '../schemas/provider-policy.schema';
import { RobotsCache, RobotsCacheSchema } from '../schemas/robots-cache.schema';
import { ScrapedWebsite, ScrapedWebsiteSchema } from '../schemas/scraped-website.schema';
import { ScraperAdapter, ScraperAdapterSchema } from '../schemas/scraper-adapter.schema';
import { SCRAPER_SETTINGS_KEY, ScraperSettings, ScraperSettingsSchema } from '../schemas/scraper-settings.schema';
import { WebsiteFingerprint, WebsiteFingerprintSchema } from '../schemas/website-fingerprint.schema';
import { AuthorisedNetwork, AuthorisedNetworkSchema } from '../schemas/authorised-network.schema';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/truoffers';

// No type argument on mongoose.model: that overload makes tsc compare schema generics structurally.
function model(name: string, schema: Schema<any>): Model<any> {
  return mongoose.models[name] ?? mongoose.model(name, schema);
}

type BusinessRow = { _id: Types.ObjectId; name?: string; slug?: string; phone?: string; postcode?: string; website?: string };
type OfferRow = Pick<Offer, 'businessId' | 'title' | 'discountType' | 'value' | 'code' | 'minOrder' | 'applicableProducts' | 'freeItem' | 'promotionalPrice' | 'endsAt' | 'status'> & {
  _id: Types.ObjectId;
  origin?: OfferOrigin;
  verification?: OfferVerification;
  contentFingerprint?: string;
  dedupeKey?: string;
};

function setOrUnset(fields: Record<string, unknown>) {
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, 1> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) $unset[key] = 1;
    else $set[key] = value;
  }
  return { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) };
}

async function migrateBusinesses(skipDuplicates: boolean) {
  const collection = mongoose.connection.collection<BusinessRow>('businesses');
  const rows = await collection
    .find({}, { projection: { name: 1, slug: 1, phone: 1, postcode: 1, website: 1 } })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();
  const identities = rows.map((row) => ({ row, identity: deriveBusinessIdentity(row) }));

  const groups = new Map<string, typeof identities>();
  for (const entry of identities) {
    const { postcodeCanonical, nameNormalized } = entry.identity;
    if (!postcodeCanonical || !nameNormalized) continue;
    const key = `${postcodeCanonical}|${nameNormalized}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const duplicateGroups = [...groups.values()].filter((group) => group.length > 1);
  if (duplicateGroups.length) {
    console.log(`\nListings sharing a postcode and name (${duplicateGroups.length} group(s)):`);
    for (const group of duplicateGroups) {
      console.log(`  ${group[0].identity.postcodeCanonical} "${group[0].identity.nameNormalized}": ${group.map((g) => `${g.row.slug} (${g.row._id})`).join(', ')}`);
    }
    if (!skipDuplicates) {
      throw new Error('Merge or rename these listings, or rerun with --skip-duplicates to leave the newer ones unindexed');
    }
  }
  const unindexed = new Set(duplicateGroups.flatMap((group) => group.slice(1).map((g) => String(g.row._id))));

  const ops = identities.map(({ row, identity }) => ({
    updateOne: {
      filter: { _id: row._id },
      update: setOrUnset({ ...identity, nameNormalized: unindexed.has(String(row._id)) ? undefined : identity.nameNormalized }),
    },
  }));
  if (ops.length) await collection.bulkWrite(ops, { ordered: false });
  return { businesses: rows.length, duplicateListings: unindexed.size };
}

async function migrateOffers() {
  const collection = mongoose.connection.collection<OfferRow>('offers');
  const rows = await collection.find({}).sort({ createdAt: 1, _id: 1 }).toArray();
  const liveKeys = new Set<string>();
  const duplicates: string[] = [];

  const ops = rows.map((row) => {
    const contentFingerprint = row.contentFingerprint ?? fingerprintOfPublishedOffer(row);
    let dedupeKey: string | undefined;
    if (LIVE_OFFER_STATUSES.includes(row.status as OfferStatus)) {
      const key = `${String(row.businessId)}:${contentFingerprint}`;
      if (liveKeys.has(key)) duplicates.push(`${row._id} "${row.title}" (business ${row.businessId})`);
      else dedupeKey = key;
      liveKeys.add(key);
    }
    return {
      updateOne: {
        filter: { _id: row._id },
        update: setOrUnset({
          origin: row.origin ?? OfferOrigin.MERCHANT,
          verification: row.verification ?? OfferVerification.UNVERIFIED,
          contentFingerprint,
          dedupeKey,
        }),
      },
    };
  });
  // Raw driver writes: this only fills defaults and derived keys, never publishes or verifies anything.
  if (ops.length) await collection.bulkWrite(ops, { ordered: false });
  if (duplicates.length) {
    console.log(`\nIdentical live offers left without a dedupe key (${duplicates.length}):`);
    for (const line of duplicates) console.log(`  ${line}`);
  }
  return { offers: rows.length, duplicateOffers: duplicates.length };
}

async function main() {
  const skipDuplicates = process.argv.includes('--skip-duplicates');
  await mongoose.connect(MONGODB_URI, { autoIndex: false });
  console.log('Connected to', MONGODB_URI.replace(/\/\/[^@]*@/, '//<credentials>@'));

  const models = {
    business: model(Business.name, BusinessSchema),
    offer: model(Offer.name, OfferSchema),
    audit: model(AdminAuditLog.name, AdminAuditLogSchema),
    config: model(DomainCrawlConfig.name, DomainCrawlConfigSchema),
    optOut: model(DomainOptOut.name, DomainOptOutSchema),
    candidate: model(ExtractedOfferCandidate.name, ExtractedOfferCandidateSchema),
    job: model(ImportJob.name, ImportJobSchema),
    policy: model(ProviderPolicy.name, ProviderPolicySchema),
    robots: model(RobotsCache.name, RobotsCacheSchema),
    site: model(ScrapedWebsite.name, ScrapedWebsiteSchema),
    adapter: model(ScraperAdapter.name, ScraperAdapterSchema),
    settings: model(ScraperSettings.name, ScraperSettingsSchema),
    fingerprint: model(WebsiteFingerprint.name, WebsiteFingerprintSchema),
    network: model(AuthorisedNetwork.name, AuthorisedNetworkSchema),
  };

  const businesses = await migrateBusinesses(skipDuplicates);
  const offers = await migrateOffers();
  // Code adapters are marked current before the one-current-version-per-key index is built.
  await new AdapterRegistry(models.adapter, models.fingerprint).ensureRegistered();

  // createIndexes only adds what the schemas declare; it never drops an existing index.
  for (const [name, m] of Object.entries(models)) {
    await m.createIndexes();
    console.log(`Indexes ready: ${name}`);
  }

  await models.settings.updateOne({ key: SCRAPER_SETTINGS_KEY }, { $setOnInsert: { key: SCRAPER_SETTINGS_KEY } }, { upsert: true });

  console.log('\nScraper migration complete:', JSON.stringify({ ...businesses, ...offers }));
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(`\nMigration stopped: ${(err as Error).message}`);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
