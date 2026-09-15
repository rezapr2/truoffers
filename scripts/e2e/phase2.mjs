// Drives the scraper Phase 2 flow against the Docker E2E stack (see scripts/e2e-phase2.sh):
// authorised network discovery → template fingerprint → selector adapter test and approval → extraction
// across matching websites → rollback and re-run → provider adapter precedence → opt-out redaction.
import assert from 'node:assert/strict';
import { call, log, login, waitFor, waitForHealthyStack, waitForJob, waitForRun, WEB } from './client.mjs';

// The fixture websites listen on port 80 in the Docker stack; FIXTURE_PORT points the flow at another fixture server.
const origin = (host) => `http://${host}${process.env.FIXTURE_PORT ? `:${process.env.FIXTURE_PORT}` : ''}`;
const MATCHED = ['exact_match', 'high_confidence_match'];

const health = await waitForHealthyStack();
log(`API healthy with ${health.workers} worker(s)`);

const admin = await login('admin@truoffers.co.uk');
await call('PATCH', '/admin/scraper/settings', { token: admin, body: { defaultRateLimitMs: 500 } });
// The studio's sitemap lists a restaurant that has already asked not to be imported.
await call('POST', '/admin/scraper/opt-outs', { token: admin, body: { domain: 'dragon-wok.test', reason: 'Owner asked us not to import' } });
log('Signed in, set a 500ms per-domain rate limit, and opted dragon-wok.test out');

async function siteByDomain(domain) {
  const page = await call('GET', `/admin/scraper/websites?q=${encodeURIComponent(domain)}&limit=100`, { token: admin });
  return page.items.find((s) => s.domain === domain);
}

// ---------- authorised network ----------

const networkBody = { name: 'Saffron Web Studio clients', sitemapUrls: [`${origin('directory.saffronweb.test')}/sitemap-clients.xml`], basis: 'written_agreement' };
await call('POST', '/admin/scraper/networks', { token: admin, body: networkBody, expect: 400 });
const network = await call('POST', '/admin/scraper/networks', { token: admin, body: { ...networkBody, agreementReference: 'SWS-2026-01' } });
const discovery = await call('POST', `/admin/scraper/networks/${network._id}/discover`, { token: admin });
const discovered = await waitForJob(admin, discovery.jobId, 'network discovery');
assert.deepEqual(
  { listed: discovered.resultCounts.listed, registered: discovered.resultCounts.registered, skippedOptedOut: discovered.resultCounts.skippedOptedOut, skippedNeverCrawl: discovered.resultCounts.skippedNeverCrawl },
  { listed: 5, registered: 3, skippedOptedOut: 1, skippedNeverCrawl: 1 },
  JSON.stringify(discovered.resultCounts),
);
const [spice, lotus, kings] = await Promise.all(['saffron-spice.test', 'lotus-garden.test', 'kings-grill.test'].map(siteByDomain));
for (const site of [spice, lotus, kings]) {
  assert.equal(site?.authorisationStatus, 'authorised');
  assert.equal(site.authorisationSource, 'network_sitemap');
}
assert.equal(await siteByDomain('dragon-wok.test'), undefined);
log('A network without an agreement reference was refused; discovery authorised 3 listed websites and skipped the opted-out one and the marketplace');

// ---------- template fingerprint ----------

await call('POST', '/admin/scraper/fingerprints', { token: admin, body: { name: 'Saffron Theme', exampleWebsiteIds: [spice._id] }, expect: 400 });
const created = await call('POST', '/admin/scraper/fingerprints', { token: admin, body: { name: 'Saffron Theme', exampleWebsiteIds: [spice._id, lotus._id] } });
await waitForJob(admin, created.jobId, 'the template analysis');
const { fingerprint } = await call('GET', `/admin/scraper/fingerprints/${created.fingerprint._id}`, { token: admin });
const required = fingerprint.markers.filter((m) => m.required).map((m) => m.value);
assert.ok(required.includes('saffron theme') && required.includes('by saffron web studio'), JSON.stringify(required));
assert.equal(fingerprint.suggestedConfig?.config?.offers?.container, 'article.sf-offer-card');
assert.ok(fingerprint.examples.every((e) => e.offersFound.length > 0 && e.offersFound.every((o) => o.excerpt.length > 0 && o.excerpt.length <= 200)));
log(`Analysed two example websites: ${fingerprint.markers.length} template traits, generator and attribution required, offer selectors suggested`);

const match = await call('POST', '/admin/scraper/fingerprints/match', { token: admin, body: { allAuthorised: true } });
assert.ok(match.queued >= 4, JSON.stringify(match));
await waitFor('fingerprint matching', async () => {
  const jobs = await call('GET', '/admin/scraper/jobs?type=match_fingerprint&limit=100', { token: admin });
  const failed = jobs.items.find((j) => ['failed', 'dead_lettered'].includes(j.status));
  if (failed) throw new Error(`match_fingerprint ${failed.domain} ${failed.status}: ${JSON.stringify(failed.errorLog)}`);
  return jobs.items.length >= match.queued && jobs.items.every((j) => j.status === 'completed');
}, 180_000);
const matchedItems = [];
for (const category of MATCHED) {
  const view = await call('GET', `/admin/scraper/network?fingerprintId=${fingerprint._id}&matchCategory=${category}&limit=100`, { token: admin });
  matchedItems.push(...view.items);
}
assert.deepEqual(matchedItems.map((i) => i.domain).sort(), ['kings-grill.test', 'lotus-garden.test', 'saffron-spice.test']);
log('Matched every authorised website: the three Saffron sites match, the studio directory does not');

// ---------- selector adapter ----------

const draftBody = { name: 'Saffron Theme', fingerprintId: fingerprint._id, exampleDomains: ['saffron-spice.test', 'lotus-garden.test'] };
await call('POST', '/admin/scraper/adapters', { token: admin, body: { ...draftBody, configuration: { offers: { container: 'article[', fields: { title: { selector: 'h3' } } } } }, expect: 400 });
const draft = await call('POST', '/admin/scraper/adapters', { token: admin, body: { ...draftBody, configuration: fingerprint.suggestedConfig.config } });
const key = draft.key;
assert.equal(draft.status, 'draft');
await call('POST', `/admin/scraper/adapters/${key}/versions/1/approve`, { token: admin, expect: 400 });
const candidatesBefore = (await call('GET', '/admin/scraper/candidates', { token: admin })).total;
const test = await call('POST', `/admin/scraper/adapters/${key}/versions/1/test`, { token: admin });
await waitForJob(admin, test.jobId, 'the adapter dry run');
const tested = (await call('GET', `/admin/scraper/adapters/${key}`, { token: admin })).versions.find((v) => v.version === '1');
assert.equal(tested.testResults.summary.handled, 2, JSON.stringify(tested.testResults.summary));
assert.ok(tested.testResults.summary.offers >= 5, JSON.stringify(tested.testResults.summary));
assert.equal((await call('GET', '/admin/scraper/candidates', { token: admin })).total, candidatesBefore);
log(`Created adapter ${key}; approval before testing was refused; the dry run found ${tested.testResults.summary.offers} offers and created no candidates`);

await call('POST', `/admin/scraper/adapters/${key}/versions/1/approve`, { token: admin });
await call('PATCH', `/admin/scraper/adapters/${key}/versions/1`, { token: admin, body: { name: 'Changed' }, expect: 400 });
log('Approved version 1; an approved version can no longer be edited');

// Starts an import on each website through the network bulk action and waits for every run to finish.
async function runAcross(sites, description) {
  const before = new Map();
  for (const site of sites) before.set(site._id, (await call('GET', `/admin/scraper/websites/${site._id}`, { token: admin })).site.lastRunRef);
  const bulk = await call('POST', '/admin/scraper/network/bulk', { token: admin, body: { websiteIds: sites.map((s) => s._id), action: 'run' } });
  assert.equal(bulk.succeeded, sites.length, JSON.stringify(bulk));
  await awaitNewRuns(sites, before, description);
}

async function awaitNewRuns(sites, before, description) {
  for (const site of sites) {
    const runId = await waitFor(`${site.domain} to start a run`, async () => {
      const detail = await call('GET', `/admin/scraper/websites/${site._id}`, { token: admin });
      return detail.site.lastRunRef && detail.site.lastRunRef !== before.get(site._id) && detail.site.lastRunRef;
    }, 60_000);
    await waitForRun(admin, runId, `${description} on ${site.domain}`);
  }
}

await runAcross(matchedItems, 'extraction with the selector adapter');
const selectorCandidates = [];
for (const site of matchedItems) {
  const detail = await call('GET', `/admin/scraper/websites/${site._id}`, { token: admin });
  assert.equal(detail.site.adapterId, key, `${site.domain} used ${detail.site.adapterId}`);
  const page = await call('GET', `/admin/scraper/candidates?websiteId=${site._id}&limit=100`, { token: admin });
  selectorCandidates.push(...page.items);
}
const kingsOffers = selectorCandidates.filter((c) => c.domain === 'kings-grill.test');
const tenPercent = kingsOffers.find((c) => c.title === '10% off collection orders');
assert.ok(tenPercent, JSON.stringify(kingsOffers.map((c) => c.title)));
const tenPercentDetail = (await call('GET', `/admin/scraper/candidates/${tenPercent._id}`, { token: admin })).candidate;
assert.equal(tenPercentDetail.promoCode, 'KINGS10');
assert.equal(tenPercentDetail.evidence.title.method, `selector:${key}@1:title`);
log(`Ran the approved adapter on the 3 matching websites: ${selectorCandidates.length} candidates, each field traced to its selector`);

// ---------- rollback and re-run ----------

const v2 = await call('POST', `/admin/scraper/adapters/${key}/versions/1/new-version`, { token: admin });
assert.equal(v2.version, '2');
const rollback = await call('POST', `/admin/scraper/adapters/${key}/rollback`, { token: admin, body: { reason: 'Wrong expiry dates' } });
assert.equal(rollback.withdrawn, '1');
assert.equal(rollback.current, null);
assert.ok(rollback.candidatesNeedingReextraction >= 2, JSON.stringify(rollback));
const flagged = (await call('GET', '/admin/scraper/candidates?status=needs_reextraction&limit=100', { token: admin })).total;
assert.equal(flagged, rollback.candidatesNeedingReextraction);
log(`Rolled back version 1: ${flagged} open candidates now need re-extraction`);

const before = new Map();
for (const site of matchedItems) before.set(site._id, (await call('GET', `/admin/scraper/websites/${site._id}`, { token: admin })).site.lastRunRef);
const rerun = await call('POST', `/admin/scraper/adapters/${key}/rerun`, { token: admin, body: { version: '1' } });
assert.equal(rerun.websites, 3, JSON.stringify(rerun));
await awaitNewRuns(matchedItems, before, 're-extraction after the rollback');
for (const site of matchedItems) {
  const { site: after } = await call('GET', `/admin/scraper/websites/${site._id}`, { token: admin });
  assert.ok(['generic-jsonld', 'generic-html'].includes(after.adapterId), `${site.domain} used ${after.adapterId}`);
}
const versions = (await call('GET', `/admin/scraper/adapters/${key}`, { token: admin })).versions.map((v) => `${v.version}:${v.status}`);
assert.deepEqual(versions, ['2:draft', '1:withdrawn']);
log('Re-ran the 3 websites; with no approved selector version they fall back to the built-in adapters');

// ---------- provider adapter ----------

const policies = await call('GET', '/admin/scraper/provider-policies', { token: admin });
const ordernest = policies.find((p) => p.name.startsWith('OrderNest'));
assert.equal(ordernest?.status, 'unknown');
const [held] = await call('POST', '/admin/scraper/websites', { token: admin, body: { urls: [`${origin('luigis.ordernest.test')}/`] } });
assert.equal(held.outcome, 'queued', JSON.stringify(held));
// The host name identifies the provider before any page is fetched; the run stops after its first stage.
await waitFor('the OrderNest website to be held for provider review', async () => {
  const detail = await call('GET', `/admin/scraper/websites/${held.websiteId}`, { token: admin });
  const stages = detail.runs.find((r) => r.runId === held.runId)?.stages ?? [];
  if (stages.some((s) => ['queued', 'running', 'delayed'].includes(s.status))) return false;
  assert.equal(detail.site.authorisationStatus, 'awaiting_provider_review', JSON.stringify({ site: detail.site.authorisationStatus, stages }));
  assert.deepEqual(stages.map((s) => s.type), ['analyse_seed_website']);
  return true;
}, 120_000);
assert.equal((await call('GET', `/admin/scraper/candidates?websiteId=${held.websiteId}`, { token: admin })).total, 0);
const allowed = await call('PATCH', `/admin/scraper/provider-policies/${ordernest._id}`, { token: admin, body: { status: 'allowed', basis: 'written_agreement', agreementReference: 'ON-2026-07' } });
assert.equal(allowed.status, 'allowed');
assert.equal((await call('GET', `/admin/scraper/websites/${held.websiteId}`, { token: admin })).site.authorisationStatus, 'authorised');
const analysis = await call('POST', `/admin/scraper/websites/${held.websiteId}/analyse`, { token: admin });
await waitForRun(admin, analysis.runId, 'the OrderNest website import');
const luigis = (await call('GET', `/admin/scraper/websites/${held.websiteId}`, { token: admin })).site;
assert.equal(luigis.adapterId, 'provider-ordernest');
const luigisCandidates = await call('GET', `/admin/scraper/candidates?websiteId=${held.websiteId}&limit=100`, { token: admin });
// Two promotion widgets make two candidates: the same promotions read as page text aren't repeated.
assert.deepEqual(luigisCandidates.items.map((c) => c.title).sort(), ['25% off pizzas on Mondays', 'Free garlic bread over £30']);
const garlic = luigisCandidates.items.find((c) => c.promoCode === 'GARLIC30');
const garlicDetail = (await call('GET', `/admin/scraper/candidates/${garlic._id}`, { token: admin })).candidate;
assert.match(garlicDetail.evidence.title.method, /^provider:provider-ordernest@/);
log('An OrderNest website was held until the provider was allowed, then its provider adapter took precedence over JSON-LD');

// ---------- opt-out removes builder output ----------

await call('POST', '/admin/scraper/opt-outs', { token: admin, body: { domain: 'lotus-garden.test', reason: 'Owner asked' } });
const afterOptOut = (await call('GET', `/admin/scraper/fingerprints/${fingerprint._id}`, { token: admin })).fingerprint;
const lotusExample = afterOptOut.examples.find((e) => e.domain === 'lotus-garden.test');
assert.ok(lotusExample.offersFound.length > 0 && lotusExample.offersFound.every((o) => o.excerpt === ''));
assert.ok(afterOptOut.examples.find((e) => e.domain === 'saffron-spice.test').offersFound.every((o) => o.excerpt.length > 0));
const withdrawn = (await call('GET', `/admin/scraper/adapters/${key}`, { token: admin })).versions.find((v) => v.version === '1');
const lotusTest = withdrawn.testResults.domains.find((d) => d.domain === 'lotus-garden.test');
assert.equal(lotusTest.excerptsRedacted, true);
assert.ok(lotusTest.offers.every((o) => o.excerpt === '') && lotusTest.businesses.every((b) => Object.keys(b).every((k) => k === 'branchPath')));
await call('POST', '/admin/scraper/fingerprints/match', { token: admin, body: { websiteIds: [lotus._id] }, expect: 400 });
log('Opting lotus-garden.test out removed its text from the template analysis and adapter test results, and it can no longer be matched');

// ---------- audit and pages ----------

const expected = [
  'network.created',
  'network.discovery_requested',
  'fingerprint.created',
  'fingerprint.match_requested',
  'adapter.created',
  'adapter.test_requested',
  'adapter.approved',
  'adapter.version_created',
  'adapter.rolled_back',
  'adapter.rerun_requested',
  'websites.bulk_action',
  'provider_policy.updated',
  'opt_out.added',
];
for (const action of expected) {
  const entries = await call('GET', `/admin/scraper/audit-log?action=${action}`, { token: admin });
  assert.ok(entries.length > 0, `audit log is missing ${action}`);
}
log(`Audit log has all ${expected.length} expected Phase 2 kinds of entry`);

for (const path of ['/admin/scraper/network', '/admin/scraper/adapters', '/admin/scraper/adapters/new', '/admin/scraper/fingerprints']) {
  const res = await fetch(`${WEB}${path}`);
  assert.equal(res.status, 200, `${path} returned ${res.status}`);
}
log('The network, adapter, adapter builder and template pages are served');
