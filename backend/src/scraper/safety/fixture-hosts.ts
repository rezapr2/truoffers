import { fixtureNetworkPolicy, NetworkPolicy, STRICT_NETWORK_POLICY } from './ssrf-policy';

const TEST_HOSTNAME = /^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+test$/;

// SCRAPER_FIXTURE_HOSTS lets local E2E runs crawl fictional sites on a private network.
// Refuses to load in production and accepts only RFC 6761 `.test` names, which never exist publicly.
export function loadFixtureHosts(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.SCRAPER_FIXTURE_HOSTS?.trim();
  if (!raw) return new Set();
  if (env.NODE_ENV === 'production') {
    throw new Error('SCRAPER_FIXTURE_HOSTS must not be set when NODE_ENV=production');
  }
  const hosts = raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  for (const host of hosts) {
    if (!TEST_HOSTNAME.test(host)) {
      throw new Error(`SCRAPER_FIXTURE_HOSTS may only contain .test hostnames (got "${host}")`);
    }
  }
  return new Set(hosts);
}

export function networkPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): NetworkPolicy {
  const hosts = loadFixtureHosts(env);
  return hosts.size > 0 ? fixtureNetworkPolicy(hosts) : STRICT_NETWORK_POLICY;
}
