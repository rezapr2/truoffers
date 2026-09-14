import { promises as dns, LookupAddress, LookupOptions } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { FetchDeniedError, FetchFailedError } from './errors';
import type { NetworkPolicy } from './ssrf-policy';
import { classifyAddress } from './ssrf-policy';

export type HostResolver = (hostname: string) => Promise<LookupAddress[]>;

export const systemResolver: HostResolver = (hostname) => dns.lookup(hostname, { all: true });

export interface ResolvedHost {
  hostname: string;
  addresses: { address: string; family: 4 | 6 }[];
}

// Resolves once and validates every address. One bad address rejects the host: a name that
// sometimes resolves privately is exactly what DNS rebinding looks like.
export async function resolveAndValidate(
  hostname: string,
  policy: NetworkPolicy,
  resolver: HostResolver,
): Promise<ResolvedHost> {
  const host = hostname.toLowerCase();
  let addresses: LookupAddress[];
  try {
    addresses = await resolver(host);
  } catch (err) {
    throw new FetchFailedError('dns', `Could not resolve ${host}: ${(err as Error).message}`, true);
  }
  if (addresses.length === 0) throw new FetchFailedError('dns', `No addresses for ${host}`, true);
  for (const { address } of addresses) {
    if (!policy.isAddressAllowed(address, host)) {
      const verdict = classifyAddress(address);
      const reason = verdict.allowed ? 'not permitted' : verdict.reason;
      throw new FetchDeniedError('blocked_address', `${host} resolves to ${address} (${reason})`);
    }
  }
  return {
    hostname: host,
    addresses: addresses.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 })),
  };
}

function requestedFamily(options: LookupOptions | number | undefined): 0 | 4 | 6 {
  const family = typeof options === 'number' ? options : options?.family;
  if (family === 4 || family === 'IPv4') return 4;
  if (family === 6 || family === 'IPv6') return 6;
  return 0;
}

// The connection can only ever reach the addresses validated above; it never re-resolves.
export function pinnedLookup(resolved: ResolvedHost): LookupFunction {
  return (hostname, options, callback) => {
    if (hostname.toLowerCase() !== resolved.hostname) {
      callback(Object.assign(new Error(`Unexpected lookup for ${hostname}`), { code: 'ENOTFOUND' }), '', 0);
      return;
    }
    const family = requestedFamily(options);
    const candidates = resolved.addresses.filter((a) => family === 0 || a.family === family);
    if (candidates.length === 0) {
      callback(Object.assign(new Error(`No IPv${family} address for ${hostname}`), { code: 'ENOTFOUND' }), '', 0);
      return;
    }
    // Node 20+ asks for every address when autoSelectFamily (happy eyeballs) is enabled.
    if (typeof options === 'object' && options?.all) {
      callback(null, candidates.map((a) => ({ address: a.address, family: a.family })));
      return;
    }
    callback(null, candidates[0].address, candidates[0].family);
  };
}
