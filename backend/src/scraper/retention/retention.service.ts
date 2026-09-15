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
import { ScraperAdapter, ScraperAdapterDocument } from '../../schemas/scraper-adapter.schema';
import { WebsiteFingerprint, WebsiteFingerprintDocument } from '../../schemas/website-fingerprint.schema';
import { RETENTION } from '../scraper.constants';
import { AdapterTestResults, redactFingerprintExamples, redactTestResults } from './template-excerpts';

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_RUN_OUTPUT_MS = 7 * DAY_MS;

function redact<T extends { sources?: { url: string; pageTitle?: string; checkedAt: Date }[] }>(doc: T) {
  return (doc.sources ?? []).map((s) => ({ url: s.url, pageTitle: s.pageTitle, checkedAt: s.checkedAt, excerpt: '' }));
}

/**
 * Data retention (docs/data-protection.md): raw excerpts are deleted 90 days after a candidate is rejected
 * or fails extraction, or an imported offer expires or is removed. Records stay; the page text goes.
 * Adapter builder output (fingerprint examples, adapter test results) keeps its text for 90 days after the
 * analysis or test ran, and loses it at once for a website that opts out.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    @InjectModel(ExtractedOfferCandidate.name) private readonly candidates: Model<ExtractedOfferCandidateDocument>,
    @InjectModel(Offer.name) private readonly offers: Model<OfferDocument>,
    @InjectModel(ImportJob.name) private readonly jobs: Model<ImportJobDocument>,
    @InjectModel(WebsiteFingerprint.name) private readonly fingerprints: Model<WebsiteFingerprintDocument>,
    @InjectModel(ScraperAdapter.name) private readonly adapters: Model<ScraperAdapterDocument>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async nightly() {
    const result = await this.run();
    if (Object.values(result).some((n) => n > 0)) this.logger.log(`Retention: ${JSON.stringify(result)}`);
  }

  run(now = new Date()) {
    return ActorContext.run({ kind: ActorKind.SYSTEM, component: RETENTION_COMPONENT }, () => this.redact(now));
  }

  /** An opt-out or removal request: builder output from those websites loses its text now, not in 90 days. */
  async redactTemplateExamplesFor(domains: string[]) {
    if (!domains.length) return { fingerprintsRedacted: 0, adapterTestsRedacted: 0 };
    const only = new Set(domains);

    const fingerprints = await this.fingerprints
      .find({ 'examples.domain': { $in: domains } })
      .select('_id examples analysedAt')
      .lean();
    let fingerprintsRedacted = 0;
    for (const fingerprint of fingerprints) {
      const { examples, changed } = redactFingerprintExamples(fingerprint.examples, only);
      if (!changed) continue;
      await this.fingerprints.updateOne({ _id: fingerprint._id, analysedAt: fingerprint.analysedAt }, { $set: { examples } });
      fingerprintsRedacted += 1;
    }

    const adapters = await this.adapters
      .find({ 'testResults.domains.domain': { $in: domains } })
      .select('_id testResults')
      .lean();
    let adapterTestsRedacted = 0;
    for (const adapter of adapters) {
      const tested = adapter.testResults as AdapterTestResults;
      const { results, changed } = redactTestResults(tested, only, new Date());
      if (!changed) continue;
      await this.adapters.updateOne(this.sameTestRun(adapter._id, tested), { $set: { testResults: results } });
      adapterTestsRedacted += 1;
    }
    return { fingerprintsRedacted, adapterTestsRedacted };
  }

  private sameTestRun(_id: unknown, tested: AdapterTestResults) {
    return tested.jobId ? { _id, 'testResults.jobId': tested.jobId } : { _id };
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

    // The filters on analysedAt and jobId skip a record that was re-analysed or re-tested since it was read.
    const fingerprints = await this.fingerprints
      .find({ analysedAt: { $lte: cutoff }, excerptsRedactedAt: { $exists: false } })
      .select('_id examples analysedAt')
      .lean();
    for (const fingerprint of fingerprints) {
      const { examples } = redactFingerprintExamples(fingerprint.examples, null);
      await this.fingerprints.updateOne({ _id: fingerprint._id, analysedAt: fingerprint.analysedAt }, { $set: { examples, excerptsRedactedAt: now } });
    }

    const adapters = await this.adapters
      .find({ 'testResults.ranAt': { $lte: cutoff }, 'testResults.redactedAt': { $exists: false } })
      .select('_id testResults')
      .lean();
    for (const adapter of adapters) {
      const tested = adapter.testResults as AdapterTestResults;
      await this.adapters.updateOne(this.sameTestRun(adapter._id, tested), { $set: { testResults: redactTestResults(tested, null, now).results } });
    }

    return {
      candidatesRedacted: candidates.length,
      offersRedacted: offers.length,
      staleRunOutputsCleared: staleOutputs.modifiedCount,
      fingerprintExamplesRedacted: fingerprints.length,
      adapterTestResultsRedacted: adapters.length,
    };
  }
}
