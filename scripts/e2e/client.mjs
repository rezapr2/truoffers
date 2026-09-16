// HTTP helpers shared by the Docker E2E flows (phase1.mjs, phase2.mjs).
// They run inside the isolated compose network and talk to the API and web containers only.

export const API = process.env.API_URL ?? 'http://api:4000/api';
export const WEB = process.env.WEB_URL ?? 'http://web:3000';
const PASSWORD = 'Password123!';

let step = 0;
export const log = (message) => console.log(`    ${String(++step).padStart(2, '0')}. ${message}`);
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function call(method, path, { token, body, expect = [200, 201, 202] } = {}) {
  const allowed = Array.isArray(expect) ? expect : [expect];
  let res;
  // The flows poll, like the admin pages do; the API's 100 requests a minute per IP can apply to them too.
  for (let attempt = 1; ; attempt++) {
    res = await fetch(`${API}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status !== 429 || allowed.includes(429) || attempt === 5) break;
    await res.text();
    await sleep((Number(res.headers.get('retry-after')) || 10) * 1_000);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!allowed.includes(res.status)) {
    throw new Error(`${method} ${path} returned ${res.status} (expected ${allowed.join('/')}): ${text.slice(0, 500)}`);
  }
  return data;
}

export async function waitFor(description, check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await check();
      if (last) return last;
    } catch (err) {
      last = err.message;
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(last)}`);
}

export function waitForHealthyStack() {
  return waitFor('the API, Redis and a worker', async () => {
    const body = await call('GET', '/health');
    return body.status === 'ok' && body.redis === 'connected' && body.worker === 'running' && body;
  }, 120_000);
}

export async function login(email) {
  return (await call('POST', '/auth/login', { body: { email, password: PASSWORD } })).accessToken;
}

const FINISHED = ['completed', 'failed', 'dead_lettered', 'cancelled'];

// Waits for one queued job (fingerprint analysis, adapter test, network discovery) and fails on anything but success.
export async function waitForJob(token, jobId, description, timeoutMs = 180_000) {
  const job = await waitFor(description, async () => {
    const body = await call('GET', `/admin/scraper/jobs/${jobId}`, { token });
    return FINISHED.includes(body.status) && body;
  }, timeoutMs);
  if (job.status !== 'completed') throw new Error(`${description}: ${job.type} ${job.status} ${JSON.stringify(job.errorLog)}`);
  return job;
}

// Waits for every stage of a website import run, through deduplicate_offers.
export function waitForRun(token, runId, description, timeoutMs = 180_000) {
  return waitFor(description, async () => {
    const body = await call('GET', `/admin/scraper/jobs/runs/${runId}`, { token });
    const failed = body.stages.find((s) => ['failed', 'dead_lettered', 'cancelled'].includes(s.status));
    if (failed) throw new Error(`Stage ${failed.type} ${failed.status}: ${JSON.stringify(failed.errorLog)}`);
    return body.stages.some((s) => s.type === 'recheck_offer' && s.status === 'completed') && body;
  }, timeoutMs);
}
