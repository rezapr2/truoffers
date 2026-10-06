import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from './settings.service';

/** Google reCAPTCHA for guest forms. Without a secret key configured the check is skipped. */
@Injectable()
export class RecaptchaService {
  private readonly logger = new Logger(RecaptchaService.name);

  constructor(private readonly settings: SettingsService) {}

  async enabled(): Promise<boolean> {
    return process.env.NODE_ENV !== 'test' && !!(await this.settings.secret('recaptchaSecretKey'));
  }

  async verify(token: string | undefined, ip?: string): Promise<boolean> {
    if (!(await this.enabled())) return true;
    if (!token) return false;
    const secret = (await this.settings.secret('recaptchaSecretKey'))!;
    try {
      const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }).toString(),
        signal: AbortSignal.timeout(8_000),
      });
      const result = (await res.json()) as { success?: boolean; score?: number };
      // v3 tokens carry a score; v2 checkbox tokens only success.
      return !!result.success && (result.score === undefined || result.score >= 0.5);
    } catch (err) {
      this.logger.warn(`reCAPTCHA check failed: ${(err as Error).message}`);
      return false;
    }
  }
}
