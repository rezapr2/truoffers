import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditAction, ScraperAdapterStatus } from '../../common/scraper.enums';
import { ExtractedOfferCandidate, ExtractedOfferCandidateDocument } from '../../schemas/extracted-offer-candidate.schema';
import { ScrapedWebsite, ScrapedWebsiteDocument } from '../../schemas/scraped-website.schema';
import { ScraperAdapter, ScraperAdapterDocument } from '../../schemas/scraper-adapter.schema';
import { AuditService } from '../audit/audit.service';

// Phase 1 adapters are built in; admins can see how they perform and pause or resume them.
@Injectable()
export class AdaptersService {
  constructor(
    @InjectModel(ScraperAdapter.name) private readonly adapters: Model<ScraperAdapterDocument>,
    @InjectModel(ScrapedWebsite.name) private readonly sites: Model<ScrapedWebsiteDocument>,
    @InjectModel(ExtractedOfferCandidate.name) private readonly candidates: Model<ExtractedOfferCandidateDocument>,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const [adapters, sites, outcomes] = await Promise.all([
      this.adapters.find().sort({ priority: -1 }).lean(),
      this.sites.aggregate([{ $match: { adapterId: { $exists: true } } }, { $group: { _id: '$adapterId', count: { $sum: 1 } } }]),
      this.candidates.aggregate([{ $group: { _id: { adapter: '$adapterId', status: '$status' }, count: { $sum: 1 } } }]),
    ]);
    return adapters.map((adapter) => {
      const byStatus = Object.fromEntries(outcomes.filter((o) => o._id.adapter === adapter.key).map((o) => [o._id.status, o.count]));
      const decided = (byStatus.approved ?? 0) + (byStatus.rejected ?? 0) + (byStatus.merged ?? 0);
      return {
        ...adapter,
        websites: sites.find((s) => s._id === adapter.key)?.count ?? 0,
        candidates: byStatus,
        approvalRate: decided ? ((byStatus.approved ?? 0) + (byStatus.merged ?? 0)) / decided : null,
      };
    });
  }

  async setPaused(key: string, paused: boolean, reason?: string) {
    const adapter = await this.adapters.findOneAndUpdate(
      { key },
      { $set: { status: paused ? ScraperAdapterStatus.PAUSED : ScraperAdapterStatus.ACTIVE, pausedReason: paused ? reason : undefined } },
      { new: true },
    );
    if (!adapter) throw new NotFoundException('Adapter not found');
    await this.audit.record({
      action: paused ? AuditAction.ADAPTER_PAUSED : AuditAction.ADAPTER_RESUMED,
      targetType: 'ScraperAdapter',
      targetId: adapter._id,
      after: { key, version: adapter.version, status: adapter.status },
      note: reason,
    });
    return adapter;
  }
}
