import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthorisationSource, DomainAuthorisationStatus } from '../../common/scraper.enums';
import { DomainOptOut, DomainOptOutDocument } from '../../schemas/domain-opt-out.schema';
import { ScrapedWebsite, ScrapedWebsiteDocument } from '../../schemas/scraped-website.schema';
import { neverCrawlReason } from './never-crawl';
import { registrableDomainOf, siteDomainOf } from './url';

export type ScrapedWebsiteLean = ScrapedWebsite & { _id: Types.ObjectId; createdAt?: Date; updatedAt?: Date };

// Spec §2.1: a linked domain is recorded as pending_authorisation and never crawled until an admin approves it.
@Injectable()
export class DomainRegistryService {
  private readonly logger = new Logger(DomainRegistryService.name);

  constructor(
    @InjectModel(ScrapedWebsite.name) private readonly sites: Model<ScrapedWebsiteDocument>,
    @InjectModel(DomainOptOut.name) private readonly optOuts: Model<DomainOptOutDocument>,
  ) {}

  siteFor(hostname: string): Promise<ScrapedWebsiteLean | null> {
    return this.sites.findOne({ domain: siteDomainOf(hostname) }).lean<ScrapedWebsiteLean>();
  }

  async activeOptOutFor(hostname: string): Promise<(DomainOptOut & { _id: Types.ObjectId }) | null> {
    const labels = siteDomainOf(hostname).split('.');
    const suffixes = labels.map((_, i) => labels.slice(i).join('.')).filter((s) => s.includes('.'));
    return this.optOuts.findOne({ activeKey: { $in: suffixes } }).lean<DomainOptOut & { _id: Types.ObjectId }>();
  }

  // Returns true when a new pending domain was recorded.
  async registerDiscovered(url: URL, discoveredFrom: string): Promise<boolean> {
    const domain = siteDomainOf(url.hostname);
    if (neverCrawlReason(domain) || domain === discoveredFrom) return false;
    const result = await this.sites.updateOne(
      { domain },
      {
        $setOnInsert: {
          domain,
          registrableDomain: registrableDomainOf(domain),
          seedUrl: `${url.protocol}//${url.host}/`,
          authorisationStatus: DomainAuthorisationStatus.PENDING_AUTHORISATION,
          authorisationSource: AuthorisationSource.DISCOVERED_LINK,
          discoveredFrom,
          businesses: [],
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount > 0) this.logger.log(`Recorded ${domain} (linked from ${discoveredFrom}) as pending authorisation`);
    return result.upsertedCount > 0;
  }
}
