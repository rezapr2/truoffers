import { loadFixtureHosts, networkPolicyFromEnv } from '../../../../src/scraper/safety/fixture-hosts';
import { neverCrawlReason } from '../../../../src/scraper/safety/never-crawl';
import {
  classifyAddress,
  fixtureNetworkPolicy,
  STRICT_NETWORK_POLICY,
} from '../../../../src/scraper/safety/ssrf-policy';

describe('SSRF address policy', () => {
  it.each([
    '127.0.0.1',
    '127.8.8.8',
    '10.0.0.1',
    '172.16.5.4',
    '192.168.0.10',
    '169.254.169.254',
    '169.254.1.1',
    '100.100.100.200',
    '100.64.0.1',
    '192.0.0.192',
    '198.18.0.1',
    '0.0.0.0',
    '255.255.255.255',
    '224.0.0.251',
    '240.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    'fd00:ec2::254',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    '64:ff9b::a9fe:a9fe',
    '2002:7f00:1::',
    '2001::1',
    'ff02::1',
    'not-an-ip',
  ])('blocks %s', (address) => {
    expect(classifyAddress(address).allowed).toBe(false);
    expect(STRICT_NETWORK_POLICY.isAddressAllowed(address, 'pizza-palace.test')).toBe(false);
  });

  it.each(['93.184.216.34', '8.8.8.8', '151.101.1.1', '2001:4860:4860::8888', '::ffff:93.184.216.34'])(
    'allows public address %s',
    (address) => {
      expect(classifyAddress(address).allowed).toBe(true);
    },
  );

  it('only allows the default web ports in production', () => {
    expect(STRICT_NETWORK_POLICY.isPortAllowed(80, 'a.test')).toBe(true);
    expect(STRICT_NETWORK_POLICY.isPortAllowed(443, 'a.test')).toBe(true);
    expect(STRICT_NETWORK_POLICY.isPortAllowed(8080, 'a.test')).toBe(false);
    expect(STRICT_NETWORK_POLICY.isPortAllowed(6379, 'a.test')).toBe(false);
  });

  it('lets named fixture hosts reach loopback without loosening anything else', () => {
    const policy = fixtureNetworkPolicy(new Set(['pizza-palace.test']));
    expect(policy.isAddressAllowed('127.0.0.1', 'pizza-palace.test')).toBe(true);
    expect(policy.isPortAllowed(54321, 'pizza-palace.test')).toBe(true);
    expect(policy.isAddressAllowed('127.0.0.1', 'other.test')).toBe(false);
    expect(policy.isAddressAllowed('169.254.169.254', 'evil.example.com')).toBe(false);
    expect(policy.isPortAllowed(54321, 'other.test')).toBe(false);
  });
});

describe('fixture host configuration', () => {
  it('is empty by default, which selects the strict policy', () => {
    expect(loadFixtureHosts({})).toEqual(new Set());
    expect(networkPolicyFromEnv({})).toBe(STRICT_NETWORK_POLICY);
  });

  it('refuses to load in production', () => {
    expect(() =>
      loadFixtureHosts({ NODE_ENV: 'production', SCRAPER_FIXTURE_HOSTS: 'pizza-palace.test' }),
    ).toThrow(/must not be set when NODE_ENV=production/);
  });

  it.each(['metadata.google.internal', 'localhost', 'pizza-palace.test.evil.com', 'test', '*.test'])(
    'rejects non-.test hostname %s',
    (host) => {
      expect(() => loadFixtureHosts({ NODE_ENV: 'test', SCRAPER_FIXTURE_HOSTS: host })).toThrow(/only contain \.test/);
    },
  );

  it('accepts .test names', () => {
    expect(
      loadFixtureHosts({ NODE_ENV: 'development', SCRAPER_FIXTURE_HOSTS: 'Pizza-Palace.test, www.curry-house.test' }),
    ).toEqual(new Set(['pizza-palace.test', 'www.curry-house.test']));
    expect(networkPolicyFromEnv({ SCRAPER_FIXTURE_HOSTS: 'a.test' }).name).toBe('fixture');
  });
});

describe('never-crawl list', () => {
  it.each([
    'www.google.com',
    'maps.google.co.uk',
    'www.just-eat.co.uk',
    'deliveroo.co.uk',
    'www.ubereats.com',
    'www.facebook.com',
    'foodhub.co.uk',
    'www.foodhub.co.uk',
  ])('never crawls %s', (host) => {
    expect(neverCrawlReason(host)).not.toBeNull();
  });

  it('does not block independent sites or provider-hosted client subdomains', () => {
    expect(neverCrawlReason('bellanapoli.co.uk')).toBeNull();
    expect(neverCrawlReason('client.foodhub.co.uk')).toBeNull();
    expect(neverCrawlReason('notgoogle.com')).toBeNull();
  });

  it('honours admin additions', () => {
    expect(neverCrawlReason('www.example-aggregator.co.uk', ['example-aggregator.co.uk'])).not.toBeNull();
  });
});
