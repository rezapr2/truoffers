import { Inject, Injectable, Optional } from '@nestjs/common';
import http, { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { botUserAgent, FETCH_LIMITS, ROBOTS_LIMITS, SITEMAP_LIMITS } from '../scraper.constants';
import { FETCH_LIMITS_OVERRIDE, HOST_RESOLVER, NETWORK_POLICY } from '../scraper.tokens';
import { FetchAbortedError, FetchDeniedError, FetchFailedError } from './errors';
import { neverCrawlReason } from './never-crawl';
import { HostResolver, pinnedLookup, resolveAndValidate, ResolvedHost } from './pinned-lookup';
import type { NetworkPolicy } from './ssrf-policy';
import { parseCrawlUrl, UrlRejectedError } from './url';

export type FetchPurpose = 'page' | 'robots' | 'sitemap';

export type FetchLimits = { -readonly [K in keyof typeof FETCH_LIMITS]: number };

export interface SafeFetchOptions {
  purpose: FetchPurpose;
  signal?: AbortSignal;
  // Runs before every hop, including each redirect. Throw to refuse the request.
  beforeRequest?: (url: URL, hop: number) => Promise<void>;
  extraNeverCrawlDomains?: readonly string[];
}

export interface SafeFetchResult {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  headers: IncomingHttpHeaders;
  contentType?: string;
  body: string;
  bytes: number;
  compressedBytes: number;
  truncated: boolean;
  redirects: string[];
  lastModified?: Date;
  retryAfterMs?: number;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const ACCEPT: Record<FetchPurpose, string> = {
  page: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
  robots: 'text/plain,*/*;q=0.1',
  sitemap: 'application/xml,text/xml;q=0.9,*/*;q=0.1',
};

const MAX_BYTES: Record<FetchPurpose, number> = {
  page: FETCH_LIMITS.maxResponseBytes,
  robots: ROBOTS_LIMITS.maxBytes,
  sitemap: SITEMAP_LIMITS.maxBytes,
};

function parseRetryAfter(value: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function charsetOf(contentType: string | undefined, head: Buffer): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  if (fromHeader) return fromHeader;
  const sniff = head.subarray(0, 2048).toString('latin1');
  return (
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(sniff)?.[1] ??
    /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(sniff)?.[1] ??
    'utf-8'
  );
}

function decodeText(buffer: Buffer, contentType: string | undefined): string {
  try {
    return new TextDecoder(charsetOf(contentType, buffer)).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

function looksLikeHtml(contentType: string | undefined, body: Buffer): boolean {
  if (contentType) return /text\/html|application\/xhtml\+xml/i.test(contentType);
  return /^\s*</.test(body.subarray(0, 512).toString('latin1'));
}

/**
 * The only way the crawler reaches the network. Resolves and validates every host, pins the
 * connection to the validated addresses, follows redirects manually (re-validating each hop),
 * and enforces time, size and decompression-ratio limits while the body streams.
 */
@Injectable()
export class SafeFetchService {
  private readonly limits: FetchLimits;

  constructor(
    @Inject(NETWORK_POLICY) private readonly policy: NetworkPolicy,
    @Inject(HOST_RESOLVER) private readonly resolver: HostResolver,
    @Optional() @Inject(FETCH_LIMITS_OVERRIDE) limits?: Partial<FetchLimits>,
  ) {
    this.limits = { ...FETCH_LIMITS, ...(limits ?? {}) };
  }

  async fetch(input: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
    let url: URL;
    try {
      url = parseCrawlUrl(input);
    } catch (err) {
      throw new FetchDeniedError('invalid_url', (err as UrlRejectedError).message);
    }
    const redirects: string[] = [];

    for (let hop = 0; ; hop++) {
      this.throwIfAborted(options.signal);
      const blocked = neverCrawlReason(url.hostname, options.extraNeverCrawlDomains);
      if (blocked) throw new FetchDeniedError('never_crawl', blocked);
      const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
      if (!this.policy.isPortAllowed(port, url.hostname)) {
        throw new FetchDeniedError('port_not_allowed', `Port ${port} is not allowed`);
      }
      if (options.beforeRequest) await options.beforeRequest(url, hop);

      const resolved = await resolveAndValidate(url.hostname, this.policy, this.resolver);
      const outcome = await this.request(url, resolved, options);

      if (outcome.redirectTo) {
        if (redirects.length >= this.limits.maxRedirects) {
          throw new FetchDeniedError('too_many_redirects', `More than ${this.limits.maxRedirects} redirects from ${input}`);
        }
        try {
          url = parseCrawlUrl(outcome.redirectTo, url);
        } catch (err) {
          throw new FetchDeniedError('invalid_url', `Redirect rejected: ${(err as UrlRejectedError).message}`);
        }
        redirects.push(url.toString());
        continue;
      }
      return { ...outcome.result!, requestedUrl: input, redirects };
    }
  }

  private throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new FetchAbortedError();
  }

  private request(
    url: URL,
    resolved: ResolvedHost,
    options: SafeFetchOptions,
  ): Promise<{ redirectTo?: string; result?: Omit<SafeFetchResult, 'requestedUrl' | 'redirects'> }> {
    const timeout = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
    const client = url.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
      let settled = false;
      const responseTimer = setTimeout(() => timeout.abort(), this.limits.responseTimeoutMs);
      const connectTimer = setTimeout(() => timeout.abort(), this.limits.connectTimeoutMs);
      let connected = false;

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(responseTimer);
        clearTimeout(connectTimer);
        req.destroy();
        reject(err);
      };
      const succeed = (value: Parameters<typeof resolve>[0]) => {
        if (settled) return;
        settled = true;
        clearTimeout(responseTimer);
        clearTimeout(connectTimer);
        resolve(value);
      };
      const abortError = () =>
        options.signal?.aborted
          ? new FetchAbortedError()
          : new FetchFailedError(
              'timeout',
              !connected
                ? `Connecting to ${url.hostname} took longer than ${this.limits.connectTimeoutMs}ms`
                : `${url.toString()} took longer than ${this.limits.responseTimeoutMs}ms`,
              true,
            );

      const req = client.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          agent: false,
          lookup: pinnedLookup(resolved),
          signal,
          headers: {
            'User-Agent': botUserAgent(),
            Accept: ACCEPT[options.purpose],
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'en-GB,en;q=0.8',
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (REDIRECT_STATUSES.has(status) && res.headers.location) {
            res.resume();
            return succeed({ redirectTo: res.headers.location });
          }
          const contentType = res.headers['content-type'];
          const base = {
            finalUrl: url.toString(),
            status,
            headers: res.headers,
            contentType,
            lastModified: res.headers['last-modified'] ? new Date(res.headers['last-modified']) : undefined,
            retryAfterMs: parseRetryAfter(res.headers['retry-after']),
          };
          if (status < 200 || status >= 300) {
            res.resume();
            return succeed({ result: { ...base, body: '', bytes: 0, compressedBytes: 0, truncated: false } });
          }
          const declared = Number(res.headers['content-length']);
          const maxBytes = MAX_BYTES[options.purpose];
          const truncate = options.purpose === 'robots';
          if (!truncate && !res.headers['content-encoding'] && Number.isFinite(declared) && declared > maxBytes) {
            return fail(new FetchFailedError('too_large', `${url.toString()} declares ${declared} bytes`, false));
          }
          this.readBody(res, maxBytes, truncate)
            .then(({ buffer, bytes, compressedBytes, truncated }) => {
              let body = buffer;
              if (options.purpose === 'sitemap' && body[0] === 0x1f && body[1] === 0x8b) {
                body = this.gunzipWithLimits(body, maxBytes);
              }
              if (options.purpose === 'page' && !looksLikeHtml(contentType, body)) {
                throw new FetchFailedError('content_type', `${url.toString()} is not HTML (${contentType})`, false);
              }
              succeed({
                result: { ...base, body: decodeText(body, contentType), bytes, compressedBytes, truncated },
              });
            })
            .catch((err: Error) => fail(signal.aborted ? abortError() : err));
        },
      );

      req.on('socket', (socket) => {
        socket.once('connect', () => {
          connected = true;
          clearTimeout(connectTimer);
        });
      });
      req.on('error', (err) => {
        if (signal.aborted) return fail(abortError());
        fail(new FetchFailedError('connection', `Request to ${url.hostname} failed: ${err.message}`, true));
      });
      req.end();
    });
  }

  private readBody(
    res: IncomingMessage,
    maxBytes: number,
    truncate: boolean,
  ): Promise<{ buffer: Buffer; bytes: number; compressedBytes: number; truncated: boolean }> {
    const encoding = String(res.headers['content-encoding'] ?? '').trim().toLowerCase();
    const kind =
      !encoding || encoding === 'identity'
        ? 'none'
        : encoding === 'gzip' || encoding === 'x-gzip'
          ? 'gzip'
          : encoding === 'deflate'
            ? 'deflate'
            : encoding === 'br'
              ? 'br'
              : null;

    return new Promise((resolve, reject) => {
      if (!kind) {
        res.destroy();
        return reject(new FetchFailedError('unsupported_encoding', `Unsupported Content-Encoding "${encoding}"`, false));
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      let compressed = 0;
      let done = false;
      let decoder: zlib.Gunzip | zlib.Inflate | zlib.InflateRaw | zlib.BrotliDecompress | null = null;

      const finish = (err?: Error, truncated = false) => {
        if (done) return;
        done = true;
        decoder?.destroy();
        res.destroy();
        if (err) reject(err);
        else resolve({ buffer: Buffer.concat(chunks), bytes, compressedBytes: compressed, truncated });
      };

      const accept = (chunk: Buffer) => {
        if (done) return;
        if (bytes + chunk.length > maxBytes) {
          if (truncate) {
            chunks.push(chunk.subarray(0, maxBytes - bytes));
            bytes = maxBytes;
            return finish(undefined, true);
          }
          return finish(new FetchFailedError('too_large', `Response exceeds ${maxBytes} bytes`, false));
        }
        chunks.push(chunk);
        bytes += chunk.length;
        if (
          kind !== 'none' &&
          bytes > this.limits.ratioCheckFloorBytes &&
          bytes / Math.max(compressed, 1) > this.limits.maxDecompressionRatio
        ) {
          finish(
            new FetchFailedError(
              'decompression_ratio',
              `Decompressed size exceeds ${this.limits.maxDecompressionRatio}:1 of the compressed size`,
              false,
            ),
          );
        }
      };

      const createDecoder = (first: Buffer) => {
        if (kind === 'gzip') return zlib.createGunzip();
        if (kind === 'br') return zlib.createBrotliDecompress();
        // "deflate" is meant to be zlib-wrapped, but some servers send raw deflate.
        const zlibWrapped = first.length >= 2 && (first[0] & 0x0f) === 8 && ((first[0] << 8) | first[1]) % 31 === 0;
        return zlibWrapped ? zlib.createInflate() : zlib.createInflateRaw();
      };

      res.on('data', (chunk: Buffer) => {
        if (done) return;
        compressed += chunk.length;
        if (kind === 'none') return accept(chunk);
        if (!decoder) {
          decoder = createDecoder(chunk);
          decoder.on('data', accept);
          decoder.on('error', (err) =>
            finish(new FetchFailedError('bad_encoding', `Could not decompress response: ${err.message}`, false)),
          );
          decoder.on('end', () => finish());
        }
        decoder.write(chunk);
      });
      res.on('end', () => {
        if (kind === 'none' || !decoder) return finish();
        decoder.end();
      });
      res.on('error', (err) => finish(err));
    });
  }

  private gunzipWithLimits(buffer: Buffer, maxBytes: number): Buffer {
    let out: Buffer;
    try {
      out = zlib.gunzipSync(buffer, { maxOutputLength: maxBytes });
    } catch (err) {
      if (err instanceof RangeError) throw new FetchFailedError('too_large', `Sitemap exceeds ${maxBytes} bytes`, false);
      throw new FetchFailedError('bad_encoding', `Could not decompress sitemap: ${(err as Error).message}`, false);
    }
    if (out.length > this.limits.ratioCheckFloorBytes && out.length / buffer.length > this.limits.maxDecompressionRatio) {
      throw new FetchFailedError('decompression_ratio', 'Sitemap decompression ratio exceeded', false);
    }
    return out;
  }
}
