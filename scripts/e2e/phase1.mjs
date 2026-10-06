// Drives the scraper Phase 1 flow against the Docker E2E stack (see scripts/e2e-phase1.sh).
// Runs inside the isolated compose network; talks to the API and web containers only.
import assert from 'node:assert/strict';
import { call, log, login, waitForHealthyStack, waitForRun, WEB } from './client.mjs';

const health = await waitForHealthyStack();
log(`API healthy with ${health.workers} worker(s)`);

const admin = await login('admin@truoffers.co.uk');
const owner = await login('owner@bellanapoli.co.uk');
await call('GET', '/admin/scraper/candidates', { token: owner, expect: 403 });
log('Signed in; merchants are kept out of the scraper admin');

// The owner also runs Pizza Palace, whose website the admin is about to import. Since the MVP spec, owners add
// a business through the claim flow; here an admin creates the listing and makes the owner its (claimed,
// not yet verified) owner.
const listing = await call('POST', '/admin/businesses', {
  token: admin,
  body: { name: 'Pizza Palace', postcode: 'LS1 4AP', phone: '0113 496 0123', town: 'Leeds', address: '14 Call Lane' },
});
await call('POST', `/admin/businesses/${listing._id}/owner`, { token: admin, body: { email: 'owner@bellanapoli.co.uk' } });
await call('POST', `/admin/businesses/${listing._id}/level`, { token: admin, body: { level: 1, note: 'E2E: claimed, not verified' } });
await call('PATCH', '/admin/scraper/settings', { token: admin, body: { defaultRateLimitMs: 500 } });
log(`Created the Pizza Palace listing (${listing.slug}) and set a 500ms per-domain rate limit`);

const intake = await call('POST', '/admin/scraper/websites', {
  token: admin,
  body: { urls: ['http://pizza-palace.test/', 'https://www.just-eat.co.uk/restaurants-pizza-palace', 'https://www.google.com/maps/place/x'] },
});
assert.equal(intake[0].outcome, 'queued', JSON.stringify(intake[0]));
assert.deepEqual(intake.slice(1).map((r) => r.outcome), ['rejected', 'rejected']);
log('Submitted the website; marketplace and Google URLs were refused');

const run = await waitForRun(admin, intake[0].runId, 'the crawl to finish');
log(`Crawl finished: ${run.stages.map((s) => s.type).join(' → ')}`);

const website = await call('GET', `/admin/scraper/websites/${intake[0].websiteId}`, { token: admin });
assert.equal(website.site.businesses[0].matchStatus, 'auto_matched');
assert.equal(String(website.site.businesses[0].businessRef?._id ?? website.site.businesses[0].businessRef), listing._id);
const pendingDomains = await call('GET', '/admin/scraper/websites?status=pending_authorisation', { token: admin });
assert.ok(pendingDomains.items.some((s) => s.domain === 'pizza-palace-friends.test'));
log('Matched the website to the listing; a linked domain waits for authorisation, uncrawled');

const candidates = await call('GET', '/admin/scraper/candidates', { token: admin });
const approvable = [];
for (const item of candidates.items) {
  const detail = await call('GET', `/admin/scraper/candidates/${item._id}`, { token: admin });
  assert.ok(detail.candidate.evidence.title?.text, `candidate ${item._id} has no title evidence`);
  assert.ok(detail.candidate.sources.every((s) => s.excerpt.length <= 500));
  if (detail.canApprove) approvable.push(detail.candidate);
}
assert.ok(approvable.length >= 3, `only ${approvable.length} approvable candidates`);
const publicBefore = await call('GET', `/offers?businessId=${listing._id}`);
assert.equal(publicBefore.length, 0);
log(`${candidates.total} candidates with field evidence; nothing public before review`);

const [first, second, third] = approvable;
const unverified = await call('POST', `/admin/scraper/candidates/${first._id}/approve`, { token: admin, body: { verification: 'unverified' } });
const verified = await call('POST', `/admin/scraper/candidates/${second._id}/approve`, { token: admin, body: { verification: 'admin_verified', note: 'Checked on the website' } });
const publicOffer = await call('GET', `/offers/${unverified.offerIds[0]}`);
// MVP spec: imported offers look exactly like owner offers in public: no source, no evidence.
for (const field of ['imported', 'sourceDomain', 'evidence', 'sources', 'origin', 'verification']) {
  assert.equal(publicOffer[field], undefined, `public offer exposes ${field}`);
}
log('Approved one offer as unverified and one as admin-verified; the public offer does not reveal it was imported');

await call('POST', `/admin/scraper/candidates/${third._id}/request-merchant-confirmation`, { token: admin });
const pending = await call('GET', `/businesses/${listing._id}/imported-offers/pending`, { token: owner });
assert.deepEqual(pending.map((c) => c._id), [third._id]);
const confirmed = await call('POST', `/businesses/${listing._id}/imported-offers/${third._id}/confirm`, { token: owner });
assert.equal(confirmed.verification, 'merchant_verified');
assert.equal(confirmed.managedBy, 'merchant_managed');
// A claimed (not yet verified) business goes through the existing moderation queue.
assert.equal(confirmed.status, 'pending');
await call('POST', `/admin/offers/${confirmed._id}/approve`, { token: admin });
await call('GET', `/offers/${confirmed._id}`);
log('The business confirmed an offer found on its website; moderation published it');

const removal = await call('POST', '/removal-requests', {
  body: { offerId: unverified.offerIds[0], name: 'Pizza Palace', email: 'hello@pizza-palace.test', reason: 'Please stop importing our offers', declaration: true },
  expect: 202,
});
assert.deepEqual(removal, { received: true });
await call('GET', `/offers/${unverified.offerIds[0]}`, { expect: 404 });
await call('GET', `/offers/${verified.offerIds[0]}`, { expect: 404 });
await call('GET', `/offers/${confirmed._id}`);
const optOuts = await call('GET', '/admin/scraper/opt-outs?unacknowledged=true', { token: admin });
assert.equal(optOuts[0]?.domain, 'pizza-palace.test');
const resubmit = await call('POST', '/admin/scraper/websites', { token: admin, body: { urls: ['http://pizza-palace.test/'] } });
assert.equal(resubmit[0].outcome, 'rejected');
log('A removal request unpublished the imported offers at once; the merchant-managed one stayed; resubmission is refused');

const stopped = await call('POST', '/admin/scraper/jobs/emergency-stop', { token: admin });
assert.equal(stopped.halted, true);
const resumed = await call('POST', '/admin/scraper/jobs/resume', { token: admin });
assert.equal(resumed.halted, false);
log('Emergency stop halted the queues and resume released them');

// One query per action: the log is shared with the rest of the admin panel, so a page of the newest entries
// no longer holds every scraper action.
const expected = ['website.submitted', 'settings.updated', 'candidate.approved', 'candidate.merchant_confirmation_requested', 'offer.merchant_confirmed', 'removal.requested', 'offer.removed', 'queue.emergency_stop', 'queue.resumed', 'offer.approved', 'business.owner_changed'];
for (const action of expected) {
  const entries = await call('GET', `/admin/scraper/audit-log?action=${action}`, { token: admin });
  assert.ok(entries.length > 0, `audit log is missing ${action}`);
}
log(`Audit log has all ${expected.length} expected kinds of entry`);

for (const [path, text] of [['/bot', 'TruOffersBot'], ['/removal-request', 'removal']]) {
  const res = await fetch(`${WEB}${path}`);
  assert.equal(res.status, 200, `${path} returned ${res.status}`);
  assert.match(await res.text(), new RegExp(text, 'i'));
}
log('The bot information and removal request pages are served');
