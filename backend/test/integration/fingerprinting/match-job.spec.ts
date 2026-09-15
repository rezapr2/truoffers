import { Types } from 'mongoose';
import {
  DomainAuthorisationStatus,
  FingerprintMatchCategory,
  ImportJobType,
  MarkerCategory,
  ProviderPolicyStatus,
} from '../../../src/common/scraper.enums';
import { AdapterRegistry } from '../../../src/scraper/extraction/adapter-registry.service';
import { NetworkJobsService } from '../../../src/scraper/pipeline/network-jobs.service';
import type { StageContext } from '../../../src/scraper/pipeline/pipeline.service';
import { SitemapService } from '../../../src/scraper/safety/sitemap.service';
import { createSafetyHarness, SafetyHarness } from '../../helpers/safety-harness';

const TEMPLATE = [
  { category: MarkerCategory.GENERATOR, value: 'ordernest sites' },
  { category: MarkerCategory.SCRIPT, value: 'static.ordernest-cdn.test/app.js' },
  { category: MarkerCategory.CSS_CLASS, value: 'on-shop' },
  { category: MarkerCategory.CSS_CLASS, value: 'on-promo' },
];

describe('match_fingerprint job', () => {
  let h: SafetyHarness;
  let jobs: NetworkJobsService;

  beforeAll(async () => {
    h = await createSafetyHarness({ fixtureHosts: [] });
    const m = h.models;
    jobs = new NetworkJobsService(
      m.sites as any,
      m.fingerprints as any,
      m.adapters as any,
      m.networks as any,
      m.policies as any,
      h.fetcher,
      h.gate,
      h.robots,
      new SitemapService(),
      h.rateLimiter,
      h.pageBudget,
      h.settings,
      h.registry,
      new AdapterRegistry(m.adapters as any, m.fingerprints as any),
    );
  });
  afterAll(() => h.close());
  beforeEach(() => h.reset());

  function context(payload: Record<string, unknown>): StageContext & { logs: string[] } {
    const logs: string[] = [];
    const id = new Types.ObjectId();
    return {
      job: { _id: id, runId: id, type: ImportJobType.MATCH_FINGERPRINT, payload, startedAt: new Date() } as any,
      signal: new AbortController().signal,
      log: async (message) => void logs.push(message),
      progress: async () => undefined,
      checkpoint: async () => undefined,
      logs,
    };
  }

  it('links a confidently matched site to the template’s provider and holds it while that provider is not allowed', async () => {
    const policy = await h.models.policies.create({ name: 'OrderNest', status: ProviderPolicyStatus.UNKNOWN });
    const fingerprint = await h.models.fingerprints.create({
      name: 'OrderNest template',
      key: 'ordernest',
      providerRef: policy._id,
      markers: TEMPLATE.map((m) => ({ ...m, weight: 1, required: m.category === MarkerCategory.GENERATOR })),
    });
    // Markers read recently are reused, so this job makes no request at all.
    await h.authorise('luigis.example.test', { siteMarkers: TEMPLATE, markersExtractedAt: new Date() });
    await h.authorise('unrelated.example.test', { siteMarkers: [{ category: MarkerCategory.CSS_CLASS, value: 'on-shop' }], markersExtractedAt: new Date() });
    const [luigis, unrelated] = await Promise.all([h.models.sites.findOne({ domain: 'luigis.example.test' }), h.models.sites.findOne({ domain: 'unrelated.example.test' })]);

    const outcome = await jobs.run(ImportJobType.MATCH_FINGERPRINT, context({ websiteId: String(luigis!._id) }));
    expect(outcome.resultCounts).toMatchObject({ matched: 1, heldForProvider: 1 });
    const matched = await h.models.sites.findById(luigis!._id).lean();
    expect(matched).toMatchObject({
      matchCategory: FingerprintMatchCategory.EXACT,
      fingerprintRef: fingerprint._id,
      providerRef: policy._id,
      authorisationStatus: DomainAuthorisationStatus.AWAITING_PROVIDER_REVIEW,
    });
    expect(matched!.providerSignals).toContain('fingerprint OrderNest template');

    await jobs.run(ImportJobType.MATCH_FINGERPRINT, context({ websiteId: String(unrelated!._id) }));
    const other = await h.models.sites.findById(unrelated!._id).lean();
    expect(other).toMatchObject({ matchCategory: FingerprintMatchCategory.NONE, authorisationStatus: DomainAuthorisationStatus.AUTHORISED });
    expect(other!.fingerprintRef).toBeUndefined();
    expect(other!.providerRef).toBeUndefined();
  });
});
