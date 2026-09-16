// Drives the scraper Phase 3 flow against the Docker E2E stack (see scripts/e2e-phase3.sh): rechecks with
// changed and missing offers, revision review, expiry review, rendering a JavaScript-only website in the
// render worker, and a claim invitation for the unclaimed listing.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { call, log, login, waitFor, waitForHealthyStack, waitForRun, WEB } from './client.mjs';

const origin = (host) => `http://${host}${process.env.FIXTURE_PORT ? `:${process.env.FIXTURE_PORT}` : ''}`;
// A volume the fixture web server serves as deals-diner.test, so the offers can change between checks.
const DYNAMIC_SITE = process.env.DYNAMIC_SITE_DIR ?? '/dynamic/deals-diner.test';
const HOST = 'deals-diner.test';

const page = (title, body) =>
  `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}` +
  '<footer><p>Deals Diner, 4 Vicar Lane, Leeds, LS2 7EX</p><p><a href="tel:01134960456">0113 496 0456</a></p></footer></body></html>';
const OFFER_20 = '<article><h3>20% off collection orders</h3><p>20% off collection orders over £20. Use code SAVE20.</p></article>';
const OFFER_25 = '<article><h3>25% off collection orders</h3><p>25% off collection orders over £20. Use code SAVE20.</p></article>';
const GARLIC = '<article><h3>Free garlic bread</h3><p>Free garlic bread on orders over £25.</p></article>';

async function publishSite(offers) {
  await mkdir(DYNAMIC_SITE, { recursive: true });
  await writeFile(path.join(DYNAMIC_SITE, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  await writeFile(path.join(DYNAMIC_SITE, 'index.html'), page('Deals Diner', '<h1>Deals Diner</h1><nav><a href="/offers">Offers</a></nav>'));
  await writeFile(path.join(DYNAMIC_SITE, 'offers.html'), page('Offers', `<h1>Our offers</h1><section>${offers.join('')}</section>`));
}

const health = await waitForHealthyStack();
log(`API healthy with ${health.workers} worker(s)`);
const admin = await login('admin@truoffers.co.uk');
await call('PATCH', '/admin/scraper/settings', { token: admin, body: { defaultRateLimitMs: 500 } });

// ---------- import, create the listing, publish ----------

await publishSite([OFFER_20, GARLIC]);
const [intake] = await call('POST', '/admin/scraper/websites', { token: admin, body: { urls: [`${origin(HOST)}/`] } });
assert.equal(intake.outcome, 'queued', JSON.stringify(intake));
await waitForRun(admin, intake.runId, 'the first import');
const websiteId = intake.websiteId;

let site = (await call('GET', `/admin/scraper/websites/${websiteId}`, { token: admin })).site;
const branch = site.businesses[0];
assert.equal(branch?.matchStatus, 'new_business_proposed', JSON.stringify(site.businesses));
await call('PATCH', `/admin/scraper/websites/${websiteId}/branches?path=${encodeURIComponent(branch.branchPath)}`, {
  token: admin,
  body: { action: 'create', business: { name: 'Deals Diner', postcode: 'LS2 7EX', town: 'Leeds', address: '4 Vicar Lane', phone: '0113 496 0456' } },
});
const pending = await call('GET', `/admin/scraper/candidates?websiteId=${websiteId}`, { token: admin });
assert.equal(pending.total, 2, JSON.stringify(pending.items.map((c) => c.title)));
for (const candidate of pending.items) {
  await call('POST', `/admin/scraper/candidates/${candidate._id}/approve`, { token: admin, body: { verification: 'unverified' } });
}
site = (await call('GET', `/admin/scraper/websites/${websiteId}`, { token: admin })).site;
assert.ok(new Date(site.nextCheckAt).getTime() - Date.now() <= 24 * 60 * 60 * 1000 + 60_000, `next check ${site.nextCheckAt}`);
log('Imported two offers, created the listing and published them; the website is due a check within a day');

async function check(description) {
  const started = await call('POST', `/admin/scraper/websites/${websiteId}/analyse`, { token: admin });
  return waitForRun(admin, started.runId, description);
}
const offerState = async (state) => (await call('GET', `/admin/scraper/imported-offers?state=${state}`, { token: admin })).items;

// ---------- rechecks ----------

await publishSite([OFFER_25]);
const second = await check('the second check');
const recheck = second.stages.find((s) => s.type === 'recheck_offer');
assert.equal(recheck.resultCounts.possiblyRemoved, 1, JSON.stringify(recheck.resultCounts));
assert.equal(recheck.resultCounts.revisionPending, 1, JSON.stringify(recheck.resultCounts));
const [changed] = await offerState('revision_pending');
assert.equal(changed.revision.changedFields.includes('value'), true, JSON.stringify(changed.revision));
await call('GET', `/offers/${changed._id}`);
const [hidden] = await offerState('possibly_removed');
const checking = await call('GET', `/offers/${hidden._id}`);
assert.equal(checking.availability, 'checking');
const listing = await call('GET', `/businesses?q=${encodeURIComponent('Deals Diner')}`);
const profile = await call('GET', `/businesses/${listing.items[0].slug}`);
assert.equal(profile.checkingAvailability, 1);
log('Second check: changed terms await review while the offer stays live; the missing offer is hidden and says it is being checked');

await check('the third check');
const [review] = await offerState('expiry_review');
assert.match(review.title, /garlic bread/i);
await call('GET', `/offers/${review._id}`, { expect: 404 });
log('Third check: the offer missing twice in a row went to expiry review');

const detail = await call('GET', `/admin/scraper/imported-offers/${changed._id}`, { token: admin });
const revision = detail.revisions.find((r) => r.status === 'pending');
assert.equal(revision.detectionCount, 2);
const applied = await call('POST', `/admin/scraper/revisions/${revision._id}/apply`, { token: admin, body: { verification: 'admin_verified' } });
assert.equal(applied.offer.value, 25);
assert.equal(applied.offer.status, 'active');
const expired = await call('POST', `/admin/scraper/imported-offers/${review._id}/expiry-decision`, { token: admin, body: { decision: 'expire' } });
assert.equal(expired.status, 'expired');
log('Applied the revision (now 25%, verified) and expired the missing offer');

// ---------- rendering ----------

await call('PATCH', '/admin/scraper/settings', { token: admin, body: { renderingEnabled: true } });
const settings = await waitFor('a render worker', async () => {
  const body = await call('GET', '/admin/scraper/settings', { token: admin });
  return body.renderWorkers > 0 && body;
}, 120_000);
const [spa] = await call('POST', '/admin/scraper/websites', { token: admin, body: { urls: [`${origin('spa-only.test')}/`] } });
const rendered = await waitForRun(admin, spa.runId, 'the JavaScript-only website import', 240_000);
const renderStage = rendered.stages.find((s) => s.type === 'render_pages');
assert.ok(renderStage, `no render stage: ${rendered.stages.map((s) => s.type).join(', ')}`);
assert.equal(renderStage.resultCounts.rendered >= 1, true, JSON.stringify(renderStage.resultCounts));
const sushi = (await call('GET', `/admin/scraper/candidates?websiteId=${spa.websiteId}`, { token: admin })).items;
assert.ok(sushi.some((c) => c.discountPercentage === 25), JSON.stringify(sushi.map((c) => c.title)));
log(`Rendered the JavaScript-only website with ${settings.renderWorkers} render worker(s) and found its 25% offer`);

// ---------- claim invitation ----------

const outreach = await call('GET', '/admin/scraper/outreach', { token: admin });
const diner = outreach.items.find((item) => item.business.name === 'Deals Diner');
assert.ok(diner, JSON.stringify(outreach.items.map((i) => i.business.name)));
const invitation = await call('POST', `/admin/scraper/outreach/${diner.business._id}/invitation`, { token: admin });
assert.match(invitation.qrCode, /^data:image\/png;base64,/);
assert.ok(invitation.messages.whatsapp.includes('TruOffers does not take orders or charge commission.'));
const token = new URL(invitation.claimUrl).searchParams.get('invite');
const resolved = await call('GET', `/claim-invitations/${token}`);
assert.equal(resolved.business.name, 'Deals Diner');
await call('POST', `/admin/scraper/outreach/${diner.business._id}/contacted`, { token: admin, body: { channel: 'phone', note: 'Left a message' } });
log('Generated a claim invitation for the unclaimed listing; its link resolves to that business only');

// ---------- audit and pages ----------

for (const action of ['revision.applied', 'offer.expiry_decided', 'claim_invitation.created', 'outreach.contact_recorded', 'settings.updated']) {
  const entries = await call('GET', `/admin/scraper/audit-log?action=${action}`, { token: admin });
  assert.ok(entries.length > 0, `audit log is missing ${action}`);
}
for (const pathname of ['/admin/scraper/offers', '/admin/scraper/outreach', `/claim-your-business?invite=${token}`]) {
  const res = await fetch(`${WEB}${pathname}`);
  assert.equal(res.status, 200, `${pathname} returned ${res.status}`);
}
log('Audit log and the imported offers, outreach and claim pages are in place');
