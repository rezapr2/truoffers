import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = path.join(__dirname, '..', '..', 'src');

// The only files allowed to write offer verification or management state (plan invariant 1).
const ALLOWED = new Set(
  [
    'scraper/lifecycle/offer-lifecycle.service.ts',
    'scraper/lifecycle/merchant-management.ts',
    'schemas/offer.schema.ts',
    'schemas/offer-lifecycle.guard.ts',
  ].map((file) => path.join(SRC, file)),
);

const WRITE_PATTERNS: { name: string; pattern: RegExp }[] = [
  {
    name: 'elevated verification or merchant management in an object literal or assignment',
    pattern:
      /\b(?:verification|managedBy)\s*[:=]\s*(?:OfferVerification\.(?:ADMIN|MERCHANT)_VERIFIED|OfferManagedBy\.MERCHANT|['"`](?:admin_verified|merchant_verified|merchant_managed)['"`])(?!\s*\|)/,
  },
  { name: 'direct property assignment', pattern: /\.(?:verification|managedBy)\s*=(?!=)/ },
  { name: 'document.set on the field', pattern: /\.set\(\s*['"`](?:verification|managedBy)['"`]/ },
  { name: 'quoted update key', pattern: /['"`](?:verification|managedBy)['"`]\s*:/ },
  { name: 'dynamic verification value', pattern: /\bverification\s*:\s*(?:options|dto|input|body|patch|req)\b/ },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('static scan: offer verification and management are written only by the lifecycle service', () => {
  it('finds no writes outside the allowed files', () => {
    const violations: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (ALLOWED.has(file)) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (/^\s*(\/\/|\*)/.test(line)) return;
          for (const { name, pattern } of WRITE_PATTERNS) {
            if (pattern.test(line)) violations.push(`${path.relative(SRC, file)}:${index + 1} (${name}): ${line.trim()}`);
          }
        });
    }
    expect(violations).toEqual([]);
  });

  it('would catch a write if one were added', () => {
    const offending = [
      "await this.offers.updateOne({ _id }, { $set: { verification: OfferVerification.ADMIN_VERIFIED } });",
      'offer.managedBy = OfferManagedBy.MERCHANT;',
      "offer.set('verification', 'merchant_verified');",
      "await model.updateMany({}, { 'managedBy': 'merchant_managed' });",
      'await this.offers.create({ ...fields, verification: options.verification });',
    ];
    for (const line of offending) {
      expect(WRITE_PATTERNS.some(({ pattern }) => pattern.test(line))).toBe(true);
    }
    const harmless = [
      'verification: OfferVerification.UNVERIFIED | OfferVerification.ADMIN_VERIFIED;',
      'if (offer.managedBy === OfferManagedBy.MERCHANT) return;',
      "@IsIn([OfferVerification.UNVERIFIED, OfferVerification.ADMIN_VERIFIED])",
    ];
    for (const line of harmless) {
      expect(WRITE_PATTERNS.some(({ pattern }) => pattern.test(line))).toBe(false);
    }
  });
});
