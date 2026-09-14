import { deriveBusinessIdentity } from '../../../src/common/business-identity';
import { outwardCode } from '../../../src/common/postcode.util';
import { BranchMatchStatus } from '../../../src/common/scraper.enums';
import type { ExtractedBusiness } from '../../../src/scraper/extraction/adapter.types';
import { BusinessMatcherService } from '../../../src/scraper/matching/business-matcher.service';
import { syncTestIndexes, testModels, TestModels } from '../../helpers/models';
import { connectTestMongo, disconnectTestMongo, resetTestMongo } from '../../helpers/mongo';

describe('business matching (spec §8)', () => {
  let models: TestModels;
  let matcher: BusinessMatcherService;
  let slugCounter = 0;

  beforeAll(async () => {
    await connectTestMongo();
    models = testModels();
    await syncTestIndexes(models);
    matcher = new BusinessMatcherService(models.businesses as any);
  });
  afterAll(disconnectTestMongo);
  beforeEach(resetTestMongo);

  const listing = (fields: { name: string; postcode: string; phone?: string; website?: string; town?: string; address?: string }) =>
    models.businesses.create({
      ...fields,
      slug: `listing-${++slugCounter}`,
      postcodeArea: outwardCode(fields.postcode),
      ...deriveBusinessIdentity(fields),
    });

  const extracted = (fields: Partial<ExtractedBusiness>): ExtractedBusiness => ({
    branchPath: '/',
    sourceUrl: 'https://pizza-palace.test/',
    evidence: {},
    ...fields,
  });

  it('auto-attaches when phone and postcode identify exactly one listing', async () => {
    const target = await listing({ name: 'Pizza Palace', postcode: 'LS1 4AP', phone: '0113 496 0123' });
    await listing({ name: 'Pizza Palace', postcode: 'M1 1AE', phone: '0161 496 0999' });
    const decision = await matcher.match(extracted({ name: 'Pizza Palace Ltd', telephone: '+441134960123', postcode: 'ls14ap' }), 'pizza-palace.test');
    expect(decision).toMatchObject({ status: BranchMatchStatus.AUTO_MATCHED, businessId: target._id });
    expect(decision.signals).toEqual(expect.arrayContaining(['telephone', 'postcode']));
  });

  it('auto-attaches on postcode plus a near-identical name', async () => {
    const target = await listing({ name: "Domino's Pizza", postcode: 'S1 4GF' });
    const decision = await matcher.match(extracted({ name: 'Dominos Pizza', postcode: 'S1 4GF' }), 'dominos.test');
    expect(decision).toMatchObject({ status: BranchMatchStatus.AUTO_MATCHED, businessId: target._id });
  });

  it('auto-attaches on website domain plus postcode', async () => {
    const target = await listing({ name: 'Bella Napoli', postcode: 'LS2 7DJ', website: 'https://www.bella-napoli.test/' });
    const decision = await matcher.match(extracted({ name: 'Bella Napoli Leeds', postcode: 'LS2 7DJ' }), 'bella-napoli.test');
    expect(decision).toMatchObject({ status: BranchMatchStatus.AUTO_MATCHED, businessId: target._id });
  });

  it('sends a single strong signal to the review queue with suggestions', async () => {
    const shared = await listing({ name: 'Kebab King Leeds', postcode: 'LS1 6HD', phone: '0113 496 0789' });
    const decision = await matcher.match(extracted({ name: 'Kebab King', telephone: '+441134960789' }), 'kebab-king.test');
    expect(decision.status).toBe(BranchMatchStatus.NEEDS_REVIEW);
    expect(decision.suggestions[0].businessId).toEqual(shared._id);
  });

  it('never auto-attaches when a shared ordering line matches several branches', async () => {
    await listing({ name: 'Kebab King Leeds', postcode: 'LS1 6HD', phone: '0113 496 0789' });
    await listing({ name: 'Kebab King Headingley', postcode: 'LS6 3HN', phone: '0113 496 0789' });
    const decision = await matcher.match(extracted({ name: 'Kebab King', telephone: '+441134960789', postcode: 'LS9 9XX' }), 'kebab-king.test');
    expect(decision.status).toBe(BranchMatchStatus.NEEDS_REVIEW);
    expect(decision.suggestions.length).toBeGreaterThanOrEqual(2);
  });

  it('asks for review when the same domain has several listings', async () => {
    await listing({ name: 'Kebab King Leeds', postcode: 'LS1 6HD', website: 'kebab-king.test' });
    await listing({ name: 'Kebab King Manchester', postcode: 'M1 1JG', website: 'kebab-king.test' });
    const decision = await matcher.match(extracted({ name: 'Kebab King' }), 'kebab-king.test');
    expect(decision.status).toBe(BranchMatchStatus.NEEDS_REVIEW);
    expect(decision.suggestions).toHaveLength(2);
  });

  it('proposes a new business when nothing is close', async () => {
    await listing({ name: 'Curry House', postcode: 'S1 4GF', phone: '0114 496 0456' });
    const decision = await matcher.match(extracted({ name: 'Sushi Stop', postcode: 'M3 2BW', telephone: '+441614960777' }), 'sushi-stop.test');
    expect(decision).toEqual({ status: BranchMatchStatus.NEW_BUSINESS_PROPOSED, score: 0, signals: [], suggestions: [] });
  });

  it('prevents duplicate listings with the same name at the same postcode', async () => {
    await listing({ name: 'Curry House', postcode: 'S1 4GF' });
    await expect(listing({ name: 'Curry House Ltd', postcode: 's14gf' })).rejects.toThrow(/E11000/);
  });
});
