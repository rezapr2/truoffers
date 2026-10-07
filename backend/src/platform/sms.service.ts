import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmailLog, EmailLogDocument } from '../schemas/email.schema';
import { SettingsService } from './settings.service';

/**
 * Text messages for campaigns through Twilio Programmable Messaging (a Messaging Service with a UK sender).
 * Without the Messaging Service SID, messages are only written to the message log, like emails without a key.
 * The claim phone check uses Twilio Verify instead (phone-verification.service.ts).
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly settings: SettingsService,
    @InjectModel(EmailLog.name) private readonly log: Model<EmailLogDocument>,
  ) {}

  async configured(): Promise<boolean> {
    return (await this.credentials()) !== null;
  }

  private async credentials() {
    const [accountSid, authToken, messagingServiceSid] = await Promise.all([
      this.settings.secret('twilioAccountSid'),
      this.settings.secret('twilioAuthToken'),
      this.settings.secret('twilioMessagingServiceSid'),
    ]);
    return accountSid && authToken && messagingServiceSid ? { accountSid, authToken, messagingServiceSid } : null;
  }

  /** Never throws. `to` is an E.164 number. */
  async send(to: string, body: string, label: string): Promise<{ status: string }> {
    const creds = process.env.NODE_ENV === 'test' ? null : await this.credentials();
    try {
      if (!creds) {
        await this.log.create({ to, template: label, subject: 'SMS', body, status: 'logged', provider: 'sms' });
        return { status: 'logged' };
      }
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, MessagingServiceSid: creds.messagingServiceSid, Body: body }).toString(),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
      if (!res.ok) throw new Error(payload.message || `Twilio responded ${res.status}`);
      await this.log.create({ to, template: label, subject: 'SMS', body, status: 'sent', provider: 'twilio_sms', providerId: payload.sid });
      return { status: 'sent' };
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`SMS ${label} to ${to} failed: ${message}`);
      await this.log.create({ to, template: label, subject: 'SMS', body, status: 'failed', provider: 'sms', error: message }).catch(() => undefined);
      return { status: 'failed' };
    }
  }
}
