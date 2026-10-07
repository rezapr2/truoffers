import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Requests between TruOffers and Foodbell are signed with one shared secret, in both directions:
 *
 *   x-truoffers-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<METHOD>.<path and query>.<raw body>">
 *
 * Foodbell implements the same scheme (utils/truoffersSignature.js in its backend).
 */
export const SIGNATURE_HEADER = 'x-truoffers-signature';
export const TOLERANCE_SECONDS = 5 * 60;

const payload = (timestamp: number, method: string, path: string, body: string) => `${timestamp}.${method.toUpperCase()}.${path}.${body}`;

export function signRequest(secret: string, method: string, path: string, body = '', timestamp = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac('sha256', secret).update(payload(timestamp, method, path, body)).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

/** null when the signature is good, otherwise why not. */
export function verifyRequest(
  secret: string,
  header: string | undefined,
  method: string,
  path: string,
  body = '',
  now = Math.floor(Date.now() / 1000),
): string | null {
  if (!secret) return 'not_configured';
  if (!header) return 'missing_signature';
  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const i = part.indexOf('=');
      return [part.slice(0, i).trim(), part.slice(i + 1).trim()];
    }),
  );
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !/^[a-f0-9]{64}$/.test(parts.v1 ?? '')) return 'malformed_signature';
  if (Math.abs(now - timestamp) > TOLERANCE_SECONDS) return 'stale_signature';
  const expected = createHmac('sha256', secret).update(payload(timestamp, method, path, body)).digest();
  const given = Buffer.from(parts.v1, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected) ? null : 'bad_signature';
}
