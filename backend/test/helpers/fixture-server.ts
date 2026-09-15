import { existsSync, readFileSync, statSync } from 'node:fs';
import http, { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { LookupAddress } from 'node:dns';
import type { HostResolver } from '../../src/scraper/safety/pinned-lookup';

export const FIXTURE_SITES_DIR = path.join(__dirname, '..', 'fixtures', 'sites');

export interface RecordedRequest {
  host: string;
  path: string;
  userAgent?: string;
  acceptEncoding?: string;
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

export interface FixtureServer {
  port: number;
  requests: RecordedRequest[];
  url(host: string, pathname?: string): string;
  route(host: string, pathname: string, handler: Handler): void;
  requestsFor(host: string): RecordedRequest[];
  reset(): void;
  close(): Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.json': 'application/json',
  '.js': 'application/javascript',
  '.css': 'text/css',
};

function staticFile(host: string, pathname: string): string | null {
  const siteDir = path.join(FIXTURE_SITES_DIR, host);
  const clean = decodeURIComponent(pathname).replace(/\/+$/, '') || '/index';
  const candidates = [path.join(siteDir, clean), path.join(siteDir, `${clean}.html`), path.join(siteDir, clean, 'index.html')];
  for (const file of candidates) {
    if (!file.startsWith(siteDir)) return null;
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}

// Serves test/fixtures/sites/<host>/ by Host header, plus per-test custom routes. Binds to loopback only.
export async function startFixtureServer(): Promise<FixtureServer> {
  const routes = new Map<string, Handler>();
  const requests: RecordedRequest[] = [];

  const server = http.createServer((req, res) => {
    const host = String(req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
    const pathname = new URL(req.url ?? '/', 'http://fixture').pathname;
    requests.push({
      host,
      path: req.url ?? '/',
      userAgent: req.headers['user-agent'],
      acceptEncoding: req.headers['accept-encoding'] as string | undefined,
    });
    const custom = routes.get(`${host}${pathname}`);
    if (custom) return custom(req, res);
    const file = staticFile(host, pathname);
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
      return;
    }
    const extension = path.extname(file);
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream' });
    // Fixture files write same-site absolute URLs as {{origin}}, and other fixture hosts as http://host:{{port}}.
    const body = ['.html', '.xml', '.txt', '.json'].includes(extension)
      ? readFileSync(file, 'utf8').replaceAll('{{origin}}', `http://${host}:${port}`).replaceAll(':{{port}}', `:${port}`)
      : readFileSync(file);
    res.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    port,
    requests,
    url: (host, pathname = '/') => `http://${host}:${port}${pathname}`,
    route: (host, pathname, handler) => routes.set(`${host}${pathname}`, handler),
    requestsFor: (host) => requests.filter((r) => r.host === host),
    reset: () => {
      requests.length = 0;
      routes.clear();
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

// Resolves every `.test` name to loopback (or an explicit override); anything else fails like NXDOMAIN.
export function testResolver(overrides: Record<string, string[]> = {}): HostResolver & { calls: string[] } {
  const calls: string[] = [];
  const resolver = async (hostname: string): Promise<LookupAddress[]> => {
    calls.push(hostname);
    const override = overrides[hostname];
    if (override) return override.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    if (hostname.endsWith('.test')) return [{ address: '127.0.0.1', family: 4 }];
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
  };
  return Object.assign(resolver, { calls });
}
