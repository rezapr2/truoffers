import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = path.join(__dirname, '..', '..', 'src');

// The robots.txt exception, on a website or on a provider's policy, is recorded in one place each (a super admin's
// request), read by the crawl gate, and taken away when a website opts out or is denied, or when the provider's
// agreement changes. Nothing else may touch it.
const ALLOWED = new Set(
  [
    'schemas/scraped-website.schema.ts',
    'schemas/provider-policy.schema.ts',
    'scraper/review/websites.service.ts',
    'scraper/review/provider-policies.service.ts',
    'scraper/review/opt-outs.service.ts',
    'scraper/safety/crawl-gate.service.ts',
    'scraper/safety/provider-permission.ts',
  ].map((file) => path.join(SRC, file)),
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('static scan: the robots.txt exception', () => {
  it('is mentioned only by the files that record, apply or clear it', () => {
    const violations: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (ALLOWED.has(file)) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (/robotsOverride/.test(line) && !/^\s*(\/\/|\*)/.test(line)) violations.push(`${path.relative(SRC, file)}:${index + 1}: ${line.trim()}`);
        });
    }
    expect(violations).toEqual([]);
  });

  it('is only ever recorded by the super-admin service methods, never by an import, a CSV, discovery or a network', () => {
    // A recorded exception carries who agreed (`recordedBy`); only these two service methods build one.
    const recorders = sourceFiles(SRC)
      .filter((file) => {
        const text = readFileSync(file, 'utf8');
        return /robotsOverride/.test(text) && /recordedBy/.test(text);
      })
      .map((file) => path.relative(SRC, file));
    expect(recorders.sort()).toEqual(['scraper/review/provider-policies.service.ts', 'scraper/review/websites.service.ts']);
  });
});
