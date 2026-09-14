import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ActorContext } from '../../common/actor-context';
import { OfferStatus } from '../../common/enums';
import { ActorKind, OfferOrigin } from '../../common/scraper.enums';
import {
  ExtractedOfferCandidate,
  ExtractedOfferCandidateDocument,
} from '../../schemas/extracted-offer-candidate.schema';
import { ImportJob, ImportJobDocument } from '../../schemas/import-job.schema';
import { RETENTION_COMPONENT } from '../../schemas/offer-lifecycle.guard';
import { Offer, OfferDocument } from '../../schemas/offer.schema';
import { RETENTION } from '../scraper.constants';

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_RUN_OUTPUT_MS = 7 * DAY_MS;

function redact<T extends { sources?: { url: string; pageTitle?: string; checkedAt: Date }[] }>(doc: T) {
  return (doc.sources ?? []).map((s) => ({ url: s.url, pageTitle: s.pageTitle, checkedAt: s.checkedAt, excerpt: '' }));
}

/**
 * Data retention (docs/data-protection.md): raw excerpts are deleted 90 days after a candidate is rejected
 * or fails extraction, or an imported offer expires or is removed. Records stay; the page text goes.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    @InjectModel(ExtractedOfferCandidate.name) private readonly candidates: Model<ExtractedOfferCandidateDocument>,
    @InjectModel(Offer.name) private readonly offers: Model<OfferDocument>,
    @InjectModel(ImportJob.name) private readonly jobs: Model<ImportJobDocument>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async nightly() {
    const result = await this.run();
    if (Object.values(result).some((n) => n > 0)) this.logger.log(`Retention: ${JSON.stringify(result)}`);
  }

  run(now = new Date()) {
    return ActorContext.run({ kind: ActorKind.SYSTEM, component: RETENTION_COMPONENT }, () => this.redact(now));
  }

  private async redact(now: Date) {
    const cutoff = new Date(now.getTime() - RETENTION.excerptDays * DAY_MS);

    const candidates = await this.candidates
      .find({ excerptsRedactAfter: { $lte: now }, excerptsRedactedAt: { $exists: false } })
      .select('_id sources')
      .lean();
    for (const candidate of candidates) {
      await this.candidates.updateOne({ _id: candidate._id }, { $set: { sources: redact(candidate), evidence: {}, excerptsRedactedAt: now } });
    }

    const offers = await this.offers
      .find({
        origin: OfferOrigin.SCRAPER,
        excerptsRedactedAt: { $exists: false },
        $or: [
          { status: OfferStatus.EXPIRED, expiredAt: { $lte: cutoff } },
          { status: OfferStatus.EXPIRED, expiredAt: { $exists: false }, endsAt: { $lte: cutoff } },
          { status: OfferStatus.REMOVED, removedAt: { $lte: cutoff } },
        ],
      })
      .select('_id sources')
      .lean();
    for (const offer of offers) {
      await this.offers.updateOne({ _id: offer._id }, { $set: { sources: redact(offer), evidence: {}, excerptsRedactedAt: now } });
    }

    // Stage hand-over data is cleared when a run ends; this catches runs that never finished.
    const staleOutputs = await this.jobs.updateMany(
      { updatedAt: { $lte: new Date(now.getTime() - STALE_RUN_OUTPUT_MS) }, $or: [{ output: { $exists: true } }, { payload: { $exists: true } }] },
      { $unset: { output: 1, payload: 1 } },
    );

    return { candidatesRedacted: candidates.length, offersRedacted: offers.length, staleRunOutputsCleared: staleOutputs.modifiedCount };
  }
}
