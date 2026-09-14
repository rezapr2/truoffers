import { randomBytes } from 'node:crypto';
import zlib from 'node:zlib';
import { botUserAgent, ROBOTS_LIMITS } from '../../../src/scraper/scraper.constants';
import { FetchAbortedError, FetchDeniedError, FetchFailedError } from '../../../src/scraper/safety/errors';
import { SafeFetchService } from '../../../src/scraper/safety/safe-fetch.service';
import { fixtureNetworkPolicy, STRICT_NETWORK_POLICY } from '../../../src/scraper/safety/ssrf-policy';
import { FixtureServer, startFixtureServer, testResolver } from '../../helpers/fixture-server';

const HOST = 'fetch-lab.test';

function textOfSize(bytes: number): string {
  // Base64 of random bytes: realistic-ish text that compresses poorly (well under 20:1).
  return randomBytes(Math.ceil((bytes * 3) / 4)).toString('base64').slice(0, bytes);
}

describe('SafeFetchService', () => {
  let server: FixtureServer;
  let fetcher: SafeFetchService;
  const html = (body: string) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;

  beforeAll(async () => {
    server = await startFixtureServer();
  });
  afterAll(() => server.close());
  beforeEach(() => {
    server.reset();
    fetcher = new SafeFetchService(fixtureNetworkPolicy(new Set([HOST, 'other-site.test'])), testResolver({ 'private.example.com': ['10.0.0.8'] }), {
      responseTimeoutMs: 1_000,
      connectTimeoutMs: 500,
    });
  });

  it('fetches a page with the bot user agent and nothing browser-like', async () => {
    server.route(HOST, '/', (_req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end(html('hello')));
    const result = await fetcher.fetch(server.url(HOST), { purpose: 'page' });
    expect(result.status).toBe(200);
    expect(result.body).toContain('hello');
    expect(server.requests[0].userAgent).toBe(botUserAgent());
    expect(server.requests[0].userAgent).not.toMatch(/Mozilla|Chrome|Safari/);
  });

  it('refuses loopback under the production policy, even for .test names', async () => {
    const strict = new SafeFetchService(STRICT_NETWORK_POLICY, testResolver());
    await expect(strict.fetch(`http://${HOST}/`, { purpose: 'page' })).rejects.toMatchObject({
      name: 'FetchDeniedError',
      code: 'blocked_address',
    });
    expect(server.requests).toHaveLength(0);
  });

  it('refuses non-web ports under the production policy before resolving', async () => {
    const resolver = testResolver();
    const strict = new SafeFetchService(STRICT_NETWORK_POLICY, resolver);
    await expect(strict.fetch('http://public.example.com:6379/', { purpose: 'page' })).rejects.toMatchObject({
      code: 'port_not_allowed',
    });
    expect(resolver.calls).toHaveLength(0);
  });

  describe('redirects', () => {
    beforeEach(() => {
      for (let i = 1; i <= 6; i++) {
        server.route(HOST, `/r${i}`, (_req, res) => res.writeHead(302, { Location: `/r${i - 1}` }).end());
      }
      server.route(HOST, '/r0', (_req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end(html('landed')));
    });

    it('follows up to five redirects', async () => {
      const result = await fetcher.fetch(server.url(HOST, '/r5'), { purpose: 'page' });
      expect(result.body).toContain('landed');
      expect(result.redirects).toHaveLength(5);
      expect(result.finalUrl).toBe(server.url(HOST, '/r0'));
    });

    it('stops at the sixth redirect', async () => {
      await expect(fetcher.fetch(server.url(HOST, '/r6'), { purpose: 'page' })).rejects.toMatchObject({
        code: 'too_many_redirects',
      });
    });

    it('re-validates the resolved address on every hop', async () => {
      server.route(HOST, '/to-private', (_req, res) =>
        res.writeHead(301, { Location: 'http://private.example.com/admin' }).end(),
      );
      await expect(fetcher.fetch(server.url(HOST, '/to-private'), { purpose: 'page' })).rejects.toMatchObject({
        name: 'FetchDeniedError',
        code: 'blocked_address',
      });
    });

    it('re-runs the never-crawl check on every hop', async () => {
      server.route(HOST, '/to-google', (_req, res) => res.writeHead(302, { Location: 'https://www.google.com/maps' }).end());
      await expect(fetcher.fetch(server.url(HOST, '/to-google'), { purpose: 'page' })).rejects.toMatchObject({
        code: 'never_crawl',
      });
    });

    it('asks the gate before every hop, so an unauthorised redirect target is never requested', async () => {
      server.route(HOST, '/to-other', (_req, res) =>
        res.writeHead(302, { Location: server.url('other-site.test', '/') }).end(),
      );
      const hops: string[] = [];
      const gate = async (url: URL) => {
        hops.push(url.hostname);
        if (url.hostname !== HOST) throw new FetchDeniedError('gate', `${url.hostname} is not authorised`);
      };
      await expect(
        fetcher.fetch(server.url(HOST, '/to-other'), { purpose: 'page', beforeRequest: gate }),
      ).rejects.toThrow(/other-site.test is not authorised/);
      expect(hops).toEqual([HOST, 'other-site.test']);
      expect(server.requestsFor('other-site.test')).toHaveLength(0);
    });

    it('rejects redirects to non-http protocols', async () => {
      server.route(HOST, '/to-file', (_req, res) => res.writeHead(302, { Location: 'file:///etc/passwd' }).end());
      await expect(fetcher.fetch(server.url(HOST, '/to-file'), { purpose: 'page' })).rejects.toMatchObject({
        code: 'invalid_url',
      });
    });
  });

  describe('limits', () => {
    it('times out a response that never arrives', async () => {
      server.route(HOST, '/hang', () => undefined);
      const started = Date.now();
      const error = await fetcher.fetch(server.url(HOST, '/hang'), { purpose: 'page' }).catch((e) => e);
      expect(error).toBeInstanceOf(FetchFailedError);
      expect(error.code).toBe('timeout');
      expect(error.retryable).toBe(true);
      expect(Date.now() - started).toBeLessThan(3_000);
    });

    it('times out a body that trickles in too slowly', async () => {
      server.route(HOST, '/trickle', (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        const timer = setInterval(() => res.write('<p>x</p>'), 100);
        res.on('close', () => clearInterval(timer));
      });
      await expect(fetcher.fetch(server.url(HOST, '/trickle'), { purpose: 'page' })).rejects.toMatchObject({
        code: 'timeout',
      });
    });

    it('rejects bodies over 2 MB while streaming', async () => {
      server.route(HOST, '/big', (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html(textOfSize(3 * 1024 * 1024)));
      });
      await expect(fetcher.fetch(server.url(HOST, '/big'), { purpose: 'page' })).rejects.toMatchObject({
        code: 'too_large',
      });
    });

    it('rejects a declared Content-Length over 2 MB without reading it', async () => {
      server.route(HOST, '/declared', (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': String(5 * 1024 * 1024) });
        res.write('<html>');
      });
      await expect(fetcher.fetch(server.url(HOST, '/declared'), { purpose: 'page' })).rejects.toMatchObject({
        code: 'too_large',
      });
    });

    it('enforces the 2 MB limit on the decompressed size', async () => {
      const payload = zlib.gzipSync(html(textOfSize(3 * 1024 * 1024)));
      server.route(HOST, '/big-gzip', (_req, res) =>
        res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' }).end(payload),
      );
      expect(payload.length).toBeLessThan(2 * 1024 * 1024 * 1.4);
      await expect(fetcher.fetch(server.url(HOST, '/big-gzip'), { purpose: 'page' })).rejects.toMatchObject({
        code: 'too_large',
      });
    });

    it('stops a decompression bomb at the 20:1 ratio', async () => {
      const bomb = zlib.gzipSync(Buffer.alloc(50 * 1024 * 1024, ' '));
      server.route(HOST, '/bomb', (_req, res) =>
        res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' }).end(bomb),
      );
      await expect(fetcher.fetch(server.url(HOST, '/bomb'), { purpose: 'page' })).rejects.toMatchObject({
        code: 'decompression_ratio',
      });
    });

    it.each([
      ['gzip', (b: Buffer) => zlib.gzipSync(b)],
      ['br', (b: Buffer) => zlib.brotliCompressSync(b)],
      ['deflate', (b: Buffer) => zlib.deflateSync(b)],
      ['deflate', (b: Buffer) => zlib.deflateRawSync(b)],
    ])('decodes %s bodies', async (encoding, compress) => {
      const body = html('<p>20% off orders over £15</p>');
      server.route(HOST, '/enc', (_req, res) =>
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': encoding }).end(compress(Buffer.from(body))),
      );
      const result = await fetcher.fetch(server.url(HOST, '/enc'), { purpose: 'page' });
      expect(result.body).toBe(body);
    });

    it('rejects unsupported encodings', async () => {
      server.route(HOST, '/zstd', (_req, res) =>
        res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'zstd' }).end('x'),
      );
      await expect(fetcher.fetch(server.url(HOST, '/zstd'), { purpose: 'page' })).rejects.toMatchObject({
        code: 'unsupported_encoding',
      });
    });
  });

  describe('content handling', () => {
    it('only accepts HTML for pages', async () => {
      server.route(HOST, '/api.json', (_req, res) =>
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"offers":[]}'),
      );
      await expect(fetcher.fetch(server.url(HOST, '/api.json'), { purpose: 'page' })).rejects.toMatchObject({
        code: 'content_type',
      });
    });

    it('decodes legacy charsets declared in a meta tag', async () => {
      const body = Buffer.from('<html><head><meta charset="windows-1252"></head><body>Caf\xe9 \xa315 off</body></html>', 'latin1');
      server.route(HOST, '/latin', (_req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end(body));
      const result = await fetcher.fetch(server.url(HOST, '/latin'), { purpose: 'page' });
      expect(result.body).toContain('Café £15 off');
    });

    it('returns non-2xx statuses to the caller with Retry-After', async () => {
      server.route(HOST, '/busy', (_req, res) => res.writeHead(503, { 'Retry-After': '120' }).end('busy'));
      const result = await fetcher.fetch(server.url(HOST, '/busy'), { purpose: 'page' });
      expect(result.status).toBe(503);
      expect(result.retryAfterMs).toBe(120_000);
      expect(result.body).toBe('');
    });

    it('truncates robots.txt at 500 KiB instead of failing', async () => {
      server.route(HOST, '/robots.txt', (_req, res) =>
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end(`User-agent: *\n${'# comment\n'.repeat(70_000)}`),
      );
      const result = await fetcher.fetch(server.url(HOST, '/robots.txt'), { purpose: 'robots' });
      expect(result.truncated).toBe(true);
      expect(result.bytes).toBe(ROBOTS_LIMITS.maxBytes);
    });

    it('unpacks gzipped sitemap files served without Content-Encoding', async () => {
      const xml = '<?xml version="1.0"?><urlset><url><loc>https://fetch-lab.test/offers</loc></url></urlset>';
      server.route(HOST, '/sitemap.xml.gz', (_req, res) =>
        res.writeHead(200, { 'Content-Type': 'application/x-gzip' }).end(zlib.gzipSync(xml)),
      );
      const result = await fetcher.fetch(server.url(HOST, '/sitemap.xml.gz'), { purpose: 'sitemap' });
      expect(result.body).toBe(xml);
    });
  });

  it('aborts promptly when the caller cancels', async () => {
    server.route(HOST, '/slow', () => undefined);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const started = Date.now();
    await expect(
      fetcher.fetch(server.url(HOST, '/slow'), { purpose: 'page', signal: controller.signal }),
    ).rejects.toBeInstanceOf(FetchAbortedError);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
