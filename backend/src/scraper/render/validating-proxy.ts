import { Logger } from '@nestjs/common';
import http, { IncomingMessage, ServerResponse } from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { FetchDeniedError } from '../safety/errors';
import { HostResolver, pinnedLookup, resolveAndValidate } from '../safety/pinned-lookup';
import type { NetworkPolicy } from '../safety/ssrf-policy';

/**
 * What the proxy can see. Over HTTPS it only ever sees the host it is asked to tunnel to, so path-level rules
 * (robots.txt, blocked paths) are applied in the browser by the route handler, which sees every full URL.
 */
export type RequestKind = 'document' | 'subresource' | 'tunnel';

export interface ProxyChecks {
  policy: NetworkPolicy;
  resolver: HostResolver;
  /** Throws when the URL may not be requested at all (never-crawl, robots, opt-out, tracker, blocked path). */
  assertAllowed(url: URL, kind: RequestKind): Promise<void>;
}

export interface ProxyRecord {
  url: string;
  kind: RequestKind;
  allowed: boolean;
  reason?: string;
}

const PROXY_TIMEOUT_MS = 30_000;

// Marks the proxy's own refusals, so a page we blocked is never mistaken for the website blocking us.
export const PROXY_BLOCKED_HEADER = 'x-truoffersbot-blocked';

/**
 * Spec §3: every request Chromium makes, including sub-resources and each hop of a redirect chain, goes
 * through this proxy. It applies the same checks as SafeFetch — scheme, port, never-crawl, the crawl gate,
 * then DNS validation — and connects only to a validated address, so a name cannot be re-resolved to a
 * private one. A page.route handler cannot do this: Playwright only sees the first URL of a redirect chain.
 */
export class ValidatingProxy {
  private readonly logger = new Logger(ValidatingProxy.name);
  readonly records: ProxyRecord[] = [];
  private readonly sockets = new Set<Duplex>();

  private constructor(
    private readonly server: http.Server,
    private readonly checks: ProxyChecks,
    readonly port: number,
  ) {}

  static async start(checks: ProxyChecks): Promise<ValidatingProxy> {
    const server = http.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const proxy = new ValidatingProxy(server, checks, (server.address() as AddressInfo).port);
    server.on('request', (req, res) => void proxy.onRequest(req, res));
    server.on('connect', (req, socket, head) => void proxy.onConnect(req, socket, head));
    server.on('connection', (socket) => {
      proxy.sockets.add(socket);
      socket.on('close', () => proxy.sockets.delete(socket));
    });
    return proxy;
  }

  requestsTo(hostname: string): ProxyRecord[] {
    return this.records.filter((r) => {
      try {
        return new URL(r.url).hostname === hostname;
      } catch {
        return false;
      }
    });
  }

  private record(url: string, kind: RequestKind, allowed: boolean, reason?: string) {
    this.records.push({ url, kind, allowed, reason });
    if (!allowed) this.logger.debug?.(`Blocked ${url}: ${reason}`);
  }

  // A sub-resource is anything the page pulls in; the page itself arrives as a top-level navigation.
  private kindOf(req: IncomingMessage): RequestKind {
    const dest = String(req.headers['sec-fetch-dest'] ?? '');
    const mode = String(req.headers['sec-fetch-mode'] ?? '');
    return dest === 'document' || mode === 'navigate' ? 'document' : 'subresource';
  }

  private async validate(url: URL, kind: RequestKind) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchDeniedError('invalid_url', `${url.protocol} is not allowed`);
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    if (!this.checks.policy.isPortAllowed(port, url.hostname)) throw new FetchDeniedError('port_not_allowed', `port ${port} is not allowed`);
    await this.checks.assertAllowed(url, kind);
    return { port, resolved: await resolveAndValidate(url.hostname, this.checks.policy, this.checks.resolver) };
  }

  private async onRequest(req: IncomingMessage, res: ServerResponse) {
    let url: URL;
    try {
      // A proxied request carries the absolute URL; anything else is not ours to serve.
      url = new URL(req.url ?? '', 'http://invalid.invalid');
      if (url.hostname === 'invalid.invalid') throw new Error('not a proxy request');
    } catch {
      res.writeHead(400).end('proxy requests only');
      return;
    }
    const kind = this.kindOf(req);
    let target: Awaited<ReturnType<typeof this.validate>>;
    try {
      target = await this.validate(url, kind);
    } catch (err) {
      const reason = (err as Error).message;
      this.record(url.toString(), kind, false, reason);
      res.writeHead(403, { 'Content-Type': 'text/plain', [PROXY_BLOCKED_HEADER]: encodeURIComponent(reason) }).end('blocked by TruOffersBot');
      return;
    }
    this.record(url.toString(), kind, true);

    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    const upstream = http.request(
      {
        host: url.hostname,
        port: target.port,
        path: `${url.pathname}${url.search}`,
        method: req.method,
        headers,
        agent: false,
        lookup: pinnedLookup(target.resolved),
        timeout: PROXY_TIMEOUT_MS,
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('timeout', () => upstream.destroy(new Error('timed out')));
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  }

  // HTTPS: the browser asks for a tunnel, so the proxy validates the host and connects to the pinned address.
  // TLS still terminates in the browser against the real hostname, so certificates are checked as usual.
  private async onConnect(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const [hostname, rawPort] = String(req.url ?? '').split(':');
    const url = new URL(`https://${hostname}:${rawPort || 443}`);
    let target: Awaited<ReturnType<typeof this.validate>>;
    try {
      target = await this.validate(url, 'tunnel');
    } catch (err) {
      this.record(url.toString(), 'tunnel', false, (err as Error).message);
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    this.record(url.toString(), 'tunnel', true);

    const upstream = net.connect({ host: target.resolved.addresses[0].address, port: target.port }, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.setTimeout(PROXY_TIMEOUT_MS, () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
