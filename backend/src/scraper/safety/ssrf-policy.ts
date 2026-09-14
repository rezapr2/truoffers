import ipaddr from 'ipaddr.js';

export interface NetworkPolicy {
  readonly name: string;
  isAddressAllowed(address: string, hostname: string): boolean;
  isPortAllowed(port: number, hostname: string): boolean;
}

// Defence in depth on top of "unicast only": cloud metadata endpoints and special-purpose ranges.
const DENIED_CIDRS = [
  '0.0.0.0/8',
  '100.64.0.0/10',
  '169.254.169.254/32',
  '100.100.100.200/32',
  '192.0.0.0/24',
  '198.18.0.0/15',
  '255.255.255.255/32',
  'fd00:ec2::254/128',
  '64:ff9b::/96',
  '64:ff9b:1::/48',
  '2001:db8::/32',
].map((cidr) => ipaddr.parseCIDR(cidr));

export type AddressVerdict = { allowed: true } | { allowed: false; reason: string };

export function classifyAddress(address: string): AddressVerdict {
  if (!ipaddr.isValid(address)) return { allowed: false, reason: 'invalid address' };
  let parsed: ipaddr.IPv4 | ipaddr.IPv6 = ipaddr.parse(address);
  if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    parsed = (parsed as ipaddr.IPv6).toIPv4Address();
  }
  const range = parsed.range();
  if (range !== 'unicast') return { allowed: false, reason: `${range} address` };
  for (const [network, bits] of DENIED_CIDRS) {
    if (network.kind() === parsed.kind() && parsed.match(network, bits)) {
      return { allowed: false, reason: `denied range ${network.toString()}/${bits}` };
    }
  }
  return { allowed: true };
}

// SECURITY: the only policy production may use. Public unicast addresses on the default web ports.
export const STRICT_NETWORK_POLICY: NetworkPolicy = {
  name: 'strict',
  isAddressAllowed: (address) => classifyAddress(address).allowed,
  isPortAllowed: (port) => port === 80 || port === 443,
};

// Tests and local Docker E2E: named `.test` fixture hosts may resolve to loopback/private addresses on any port.
// Every other hostname is still held to the strict rules.
export function fixtureNetworkPolicy(fixtureHosts: ReadonlySet<string>): NetworkPolicy {
  return {
    name: 'fixture',
    isAddressAllowed: (address, hostname) =>
      STRICT_NETWORK_POLICY.isAddressAllowed(address, hostname) || fixtureHosts.has(hostname.toLowerCase()),
    isPortAllowed: (port, hostname) =>
      STRICT_NETWORK_POLICY.isPortAllowed(port, hostname) || fixtureHosts.has(hostname.toLowerCase()),
  };
}
