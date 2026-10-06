import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomDigits, sha256 } from './crypto';
import { SettingsService } from './settings.service';

export type OtpChannel = 'sms' | 'call';

export interface OtpStart {
  mode: 'twilio' | 'mock';
  // Mock mode only: the hash to store, and (outside production) the code itself so the flow can be tested
  codeHash?: string;
  devCode?: string;
}

/**
 * Spec T2.3: a 6-digit code by SMS or automated call to the listing's phone number, through Twilio Verify.
 * Twilio generates, sends and checks the code. Without Twilio credentials the service runs in mock mode
 * (a code we generate and hash), which is refused in production so a misconfiguration can't verify anyone.
 */
@Injectable()
export class PhoneVerificationService {
  private readonly logger = new Logger(PhoneVerificationService.name);

  constructor(private readonly settings: SettingsService) {}

  private async credentials() {
    const [accountSid, authToken, serviceSid] = await Promise.all([
      this.settings.secret('twilioAccountSid'),
      this.settings.secret('twilioAuthToken'),
      this.settings.secret('twilioVerifyServiceSid'),
    ]);
    return accountSid && authToken && serviceSid ? { accountSid, authToken, serviceSid } : null;
  }

  async configured(): Promise<boolean> {
    return (await this.credentials()) !== null;
  }

  async start(phoneE164: string, channel: OtpChannel): Promise<OtpStart> {
    const creds = process.env.NODE_ENV === 'test' ? null : await this.credentials();
    if (!creds) {
      if (process.env.NODE_ENV === 'production') {
        throw new ServiceUnavailableException('Phone verification is not configured yet. Please try again later.');
      }
      const code = randomDigits(6);
      this.logger.log(`Mock ${channel} code for ${phoneE164}: ${code}`);
      return { mode: 'mock', codeHash: sha256(`${phoneE164}:${code}`), devCode: code };
    }
    await this.twilio(creds, 'Verifications', { To: phoneE164, Channel: channel });
    return { mode: 'twilio' };
  }

  async check(phoneE164: string, code: string, mockHash?: string): Promise<boolean> {
    if (!/^\d{4,8}$/.test(code)) return false;
    if (mockHash) return sha256(`${phoneE164}:${code}`) === mockHash;
    const creds = await this.credentials();
    if (!creds) throw new ServiceUnavailableException('Phone verification is not configured');
    try {
      const result = (await this.twilio(creds, 'VerificationCheck', { To: phoneE164, Code: code })) as { status?: string };
      return result.status === 'approved';
    } catch (err) {
      // Twilio answers 404 once a verification has expired or been used up.
      if (err instanceof BadRequestException) return false;
      throw err;
    }
  }

  private async twilio(creds: { accountSid: string; authToken: string; serviceSid: string }, resource: string, form: Record<string, string>) {
    const res = await fetch(`https://verify.twilio.com/v2/Services/${creds.serviceSid}/${resource}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await res.json().catch(() => ({}))) as { message?: string; status?: string };
    if (res.status === 404) throw new BadRequestException('The code has expired. Send a new one.');
    if (!res.ok) {
      this.logger.warn(`Twilio ${resource} failed (${res.status}): ${payload.message ?? ''}`);
      if (res.status === 429) throw new BadRequestException('Too many attempts. Please wait a few minutes.');
      throw new ServiceUnavailableException('We could not reach the phone verification service. Please try again.');
    }
    return payload;
  }
}
