import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { CLAIM_PITCH, invitationMessages } from '../../src/scraper/outreach/invitation-messages';

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');

// Anything that could deliver a message to a business by itself (spec §14: nothing is sent automatically).
const SENDERS = [
  /\bnodemailer\b/i,
  /\btwilio\b/i,
  /\bsendgrid\b/i,
  /\bmailgun\b/i,
  /\bpostmark\b/i,
  /\bresend\b/i,
  /\bwhatsapp[-.]?(?:api|business|cloud)\b/i,
  /\bsmtp\b/i,
  /\bsendMail\b/,
  /\bsendEmail\b/,
  /\bsendSms\b/,
  /\bsendMessage\b/,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('outreach only ever produces text for an admin to send (spec §14)', () => {
  it('has no way to send a message from anywhere in the API', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      // The scan itself lists the patterns it looks for.
      if (file.endsWith(path.join('test', 'unit', 'outreach-sends-nothing.spec.ts'))) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          for (const pattern of SENDERS) {
            if (pattern.test(line)) offenders.push(`${path.relative(SRC, file)}:${index + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it('depends on no email, SMS or messaging client', () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const installed = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    expect(installed.filter((name) => SENDERS.some((pattern) => pattern.test(name)))).toEqual([]);
  });

  it('puts the spec’s wording and the claim link in every channel', () => {
    const expiresAt = new Date('2026-10-31T12:00:00Z');
    const messages = invitationMessages({ businessName: 'Pizza Palace', claimUrl: 'https://truoffers.test/claim-your-business?invite=abc', offerTitle: '2 for 1 Tuesdays', expiresAt });
    for (const text of [messages.email.body, messages.whatsapp, messages.phone]) {
      expect(text).toContain(CLAIM_PITCH);
      expect(text).toContain('https://truoffers.test/claim-your-business?invite=abc');
      expect(text).toContain('31 October 2026');
      expect(text).toContain('Pizza Palace');
    }
    expect(messages.email.subject).toBe('Pizza Palace: your offer is listed on TruOffers');
    expect(messages.phone).toContain('2 for 1 Tuesdays');
    // Without a named offer the wording still reads properly.
    expect(invitationMessages({ businessName: 'Pizza Palace', claimUrl: 'x', expiresAt }).whatsapp).toContain(CLAIM_PITCH);
  });
});
