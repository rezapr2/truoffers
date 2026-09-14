import type { LookupAddress } from 'node:dns';
import { FetchDeniedError, FetchFailedError } from '../../../../src/scraper/safety/errors';
import { pinnedLookup, resolveAndValidate } from '../../../../src/scraper/safety/pinned-lookup';
import { STRICT_NETWORK_POLICY } from '../../../../src/scraper/safety/ssrf-policy';

const resolverReturning =
  (...answers: LookupAddress[][]) =>
  async () => {
    const next = answers.shift();
    if (!next) throw new Error('resolver called too many times');
    return next;
  };

describe('DNS resolution and pinning', () => {
  it('rejects a host if any resolved address is private', async () => {
    const resolver = resolverReturning([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);
    await expect(resolveAndValidate('mixed.example.com', STRICT_NETWORK_POLICY, resolver)).rejects.toThrow(
      FetchDeniedError,
    );
  });

  it('rejects metadata endpoints reached through DNS', async () => {
    const resolver = resolverReturning([{ address: '169.254.169.254', family: 4 }]);
    await expect(resolveAndValidate('metadata.example.com', STRICT_NETWORK_POLICY, resolver)).rejects.toThrow(
      /169\.254\.169\.254/,
    );
  });

  it('treats resolution failures as retryable', async () => {
    const resolver = async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    };
    const error = await resolveAndValidate('gone.example.com', STRICT_NETWORK_POLICY, resolver).catch((e) => e);
    expect(error).toBeInstanceOf(FetchFailedError);
    expect(error.retryable).toBe(true);
  });

  it('pins the connection to the validated addresses and never re-resolves', async () => {
    // A rebinding attacker would answer differently the second time.
    const resolver = jest.fn(
      resolverReturning([{ address: '93.184.216.34', family: 4 }], [{ address: '127.0.0.1', family: 4 }]),
    );
    const resolved = await resolveAndValidate('rebind.example.com', STRICT_NETWORK_POLICY, resolver);
    const lookup = pinnedLookup(resolved);

    const single = await new Promise<{ address: unknown; family: unknown }>((resolve, reject) =>
      lookup('rebind.example.com', {}, (err, address, family) => (err ? reject(err) : resolve({ address, family }))),
    );
    const all = await new Promise<unknown>((resolve, reject) =>
      lookup('rebind.example.com', { all: true }, (err, addresses) => (err ? reject(err) : resolve(addresses))),
    );

    expect(single).toEqual({ address: '93.184.216.34', family: 4 });
    expect(all).toEqual([{ address: '93.184.216.34', family: 4 }]);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('refuses lookups for any other hostname', async () => {
    const resolved = await resolveAndValidate(
      'a.example.com',
      STRICT_NETWORK_POLICY,
      resolverReturning([{ address: '93.184.216.34', family: 4 }]),
    );
    const error = await new Promise((resolve) =>
      pinnedLookup(resolved)('b.example.com', {}, (err) => resolve(err)),
    );
    expect(error).toBeInstanceOf(Error);
  });

  it('respects a requested address family', async () => {
    const resolved = await resolveAndValidate(
      'dual.example.com',
      STRICT_NETWORK_POLICY,
      resolverReturning([
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
      ]),
    );
    const v6 = await new Promise((resolve, reject) =>
      pinnedLookup(resolved)('dual.example.com', { family: 6 }, (err, address) => (err ? reject(err) : resolve(address))),
    );
    expect(v6).toBe('2606:2800:220:1:248:1893:25c8:1946');
  });
});
