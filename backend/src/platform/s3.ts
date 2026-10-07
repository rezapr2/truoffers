import { createHash, createHmac } from 'node:crypto';

/**
 * A minimal S3 client (PUT, GET, DELETE of one object) for AWS S3 and S3-compatible storage such as
 * Cloudflare R2, Backblaze B2 or MinIO. Requests are signed with AWS Signature Version 4, so no SDK is needed.
 */
export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  // e.g. https://<account>.r2.cloudflarestorage.com; defaults to AWS
  endpoint?: string;
  // Path-style URLs (endpoint/bucket/key). The default when an endpoint is given.
  forcePathStyle?: boolean;
}

export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config | null {
  if ((env.STORAGE_DRIVER ?? '').toLowerCase() !== 's3') return null;
  const { S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = env;
  if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    throw new Error('STORAGE_DRIVER=s3 needs S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
  }
  return {
    bucket: S3_BUCKET,
    region: env.S3_REGION || (env.S3_ENDPOINT ? 'auto' : 'eu-west-2'),
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE ? env.S3_FORCE_PATH_STYLE === 'true' : !!env.S3_ENDPOINT,
  };
}

const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

// RFC 3986 encoding of each path segment, as SigV4 requires for S3.
function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

/** Signs one request. Exported for the unit test against AWS's published example. */
export function signV4(input: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  date: Date;
}): Record<string, string> {
  const amzDate = input.date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v.trim()])),
    host: input.url.host,
    'x-amz-content-sha256': input.payloadHash,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const query = [...input.url.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalRequest = [input.method, encodePath(decodeURIComponent(input.url.pathname)), query, canonicalHeaders, signedHeaders, input.payloadHash].join('\n');
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export class S3Client {
  constructor(private readonly config: S3Config) {}

  private url(key: string): URL {
    const { bucket, region, endpoint, forcePathStyle } = this.config;
    const base = endpoint ? new URL(endpoint) : new URL(`https://s3.${region}.amazonaws.com`);
    if (forcePathStyle) return new URL(`${base.origin}/${bucket}/${key}`);
    return new URL(`${base.protocol}//${bucket}.${base.host}/${key}`);
  }

  private async request(method: 'GET' | 'PUT' | 'DELETE', key: string, body?: Buffer, contentType?: string) {
    const url = this.url(key);
    const headers = signV4({
      method,
      url,
      headers: contentType ? { 'content-type': contentType } : {},
      payloadHash: sha256Hex(body ?? ''),
      region: this.config.region,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      date: new Date(),
    });
    delete headers.host;
    return fetch(url, { method, headers, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(30_000) });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const res = await this.request('PUT', key, body, contentType);
    if (!res.ok) throw new Error(`Storage upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }

  /** null when the object doesn't exist. */
  async get(key: string): Promise<Buffer | null> {
    const res = await this.request('GET', key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Storage read failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const res = await this.request('DELETE', key);
    if (!res.ok && res.status !== 404) throw new Error(`Storage delete failed (${res.status})`);
  }
}
