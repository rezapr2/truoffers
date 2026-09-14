import mongoose, { Model, Schema } from 'mongoose';
import { AdminAuditLog, AdminAuditLogSchema } from '../../src/schemas/admin-audit-log.schema';
import { Business, BusinessSchema } from '../../src/schemas/business.schema';
import { DomainCrawlConfig, DomainCrawlConfigSchema } from '../../src/schemas/domain-crawl-config.schema';
import { DomainOptOut, DomainOptOutSchema } from '../../src/schemas/domain-opt-out.schema';
import {
  ExtractedOfferCandidate,
  ExtractedOfferCandidateSchema,
} from '../../src/schemas/extracted-offer-candidate.schema';
import { ImportJob, ImportJobSchema } from '../../src/schemas/import-job.schema';
import { Offer, OfferSchema } from '../../src/schemas/offer.schema';
import { ProviderPolicy, ProviderPolicySchema } from '../../src/schemas/provider-policy.schema';
import { RobotsCache, RobotsCacheSchema } from '../../src/schemas/robots-cache.schema';
import { ScrapedWebsite, ScrapedWebsiteSchema } from '../../src/schemas/scraped-website.schema';
import { ScraperAdapter, ScraperAdapterSchema } from '../../src/schemas/scraper-adapter.schema';
import { ScraperSettings, ScraperSettingsSchema } from '../../src/schemas/scraper-settings.schema';

// No explicit type argument on mongoose.model: that overload makes tsc structurally compare the
// Schema generics against each class, which never finishes.
function model<T>(name: string, schema: Schema<any>): Model<T> {
  return (mongoose.models[name] ?? mongoose.model(name, schema)) as unknown as Model<T>;
}

// Mongoose models bound to the default (test) connection, for constructing services without Nest.
export function testModels() {
  return {
    audit: model<AdminAuditLog>(AdminAuditLog.name, AdminAuditLogSchema),
    businesses: model<Business>(Business.name, BusinessSchema),
    candidates: model<ExtractedOfferCandidate>(ExtractedOfferCandidate.name, ExtractedOfferCandidateSchema),
    configs: model<DomainCrawlConfig>(DomainCrawlConfig.name, DomainCrawlConfigSchema),
    jobs: model<ImportJob>(ImportJob.name, ImportJobSchema),
    offers: model<Offer>(Offer.name, OfferSchema),
    optOuts: model<DomainOptOut>(DomainOptOut.name, DomainOptOutSchema),
    policies: model<ProviderPolicy>(ProviderPolicy.name, ProviderPolicySchema),
    robots: model<RobotsCache>(RobotsCache.name, RobotsCacheSchema),
    sites: model<ScrapedWebsite>(ScrapedWebsite.name, ScrapedWebsiteSchema),
    adapters: model<ScraperAdapter>(ScraperAdapter.name, ScraperAdapterSchema),
    settings: model<ScraperSettings>(ScraperSettings.name, ScraperSettingsSchema),
  };
}

export type TestModels = ReturnType<typeof testModels>;

export async function syncTestIndexes(models: TestModels) {
  await Promise.all(Object.values(models).map((m) => m.syncIndexes()));
}
