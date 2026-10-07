import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EmailLog, EmailLogDocument, EmailTemplate, EmailTemplateDocument } from '../schemas/email.schema';
import { EMAIL_TEMPLATES, renderTemplate, TEMPLATE_BY_KEY, textToHtml } from './email-templates';
import { SettingsService } from './settings.service';

export interface SendEmail {
  to: string;
  template: string;
  vars?: Record<string, unknown>;
}

export function siteUrl(path = ''): string {
  const base = (process.env.SITE_URL || process.env.FRONTEND_URL?.split(',')[0] || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}${path}`;
}

/**
 * Transactional email. With RESEND_API_KEY (or the key in admin settings) it sends through Resend's HTTP API;
 * without one every email is only written to the email log, which is what development and tests use.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @InjectModel(EmailTemplate.name) private readonly templates: Model<EmailTemplateDocument>,
    @InjectModel(EmailLog.name) private readonly log: Model<EmailLogDocument>,
    private readonly settings: SettingsService,
  ) {}

  async render(key: string, vars: Record<string, unknown> = {}) {
    const definition = TEMPLATE_BY_KEY.get(key);
    if (!definition) throw new NotFoundException(`Unknown email template ${key}`);
    const custom = await this.templates.findOne({ key }).lean();
    const settings = await this.settings.get();
    const allVars = { siteName: settings.siteName, ...vars };
    return {
      enabled: custom?.enabled ?? true,
      subject: renderTemplate(custom?.subject ?? definition.subject, allVars),
      body: renderTemplate(custom?.body ?? definition.body, allVars).replace(/\n{3,}/g, '\n\n').trim(),
      siteName: settings.siteName,
      from: settings.emailFrom || process.env.EMAIL_FROM || 'TruOffers <hello@truoffers.co.uk>',
    };
  }

  /** Never throws: an email that can't be sent is logged as failed, and the action that sent it carries on. */
  async send({ to, template, vars = {} }: SendEmail): Promise<{ status: string }> {
    try {
      const email = await this.render(template, vars);
      if (!email.enabled) {
        await this.log.create({ to, template, subject: email.subject, body: email.body, status: 'disabled' });
        return { status: 'disabled' };
      }
      return await this.deliver({ to, label: template, subject: email.subject, body: email.body, from: email.from, siteName: email.siteName });
    } catch (err) {
      return this.failed(to, template, err);
    }
  }

  /**
   * An email written by an admin (campaigns) rather than a template. Marketing emails carry an unsubscribe
   * link in the body and the List-Unsubscribe headers that mail providers show as a button.
   */
  async sendDirect(input: { to: string; label: string; subject: string; body: string; unsubscribeUrl?: string }): Promise<{ status: string }> {
    try {
      const settings = await this.settings.get();
      const body = input.unsubscribeUrl ? `${input.body.trim()}\n\n—\nYou are getting this because you asked for news and offers from ${settings.siteName}. Unsubscribe: ${input.unsubscribeUrl}` : input.body.trim();
      return await this.deliver({
        to: input.to,
        label: input.label,
        subject: input.subject,
        body,
        from: settings.emailFrom || process.env.EMAIL_FROM || 'TruOffers <hello@truoffers.co.uk>',
        siteName: settings.siteName,
        headers: input.unsubscribeUrl ? { 'List-Unsubscribe': `<${input.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined,
      });
    } catch (err) {
      return this.failed(input.to, input.label, err);
    }
  }

  private async deliver(email: { to: string; label: string; subject: string; body: string; from: string; siteName: string; headers?: Record<string, string> }) {
    const apiKey = process.env.NODE_ENV === 'test' ? undefined : await this.settings.secret('resendApiKey');
    if (!apiKey) {
      await this.log.create({ to: email.to, template: email.label, subject: email.subject, body: email.body, status: 'logged' });
      return { status: 'logged' };
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: email.from,
        to: [email.to],
        subject: email.subject,
        text: email.body,
        html: textToHtml(email.body, email.siteName),
        ...(email.headers ? { headers: email.headers } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) throw new Error(payload.message || `Resend responded ${res.status}`);
    await this.log.create({ to: email.to, template: email.label, subject: email.subject, body: email.body, status: 'sent', provider: 'resend', providerId: payload.id });
    return { status: 'sent' };
  }

  private async failed(to: string, label: string, err: unknown) {
    const message = (err as Error).message;
    this.logger.warn(`Email ${label} to ${to} failed: ${message}`);
    await this.log.create({ to, template: label, subject: label, body: '', status: 'failed', error: message }).catch(() => undefined);
    return { status: 'failed' };
  }

  // ---- Admin ----

  async listTemplates() {
    const custom = await this.templates.find().lean();
    const byKey = new Map(custom.map((t) => [t.key, t]));
    return EMAIL_TEMPLATES.map((definition) => {
      const edited = byKey.get(definition.key);
      return {
        ...definition,
        defaultSubject: definition.subject,
        defaultBody: definition.body,
        subject: edited?.subject ?? definition.subject,
        body: edited?.body ?? definition.body,
        enabled: edited?.enabled ?? true,
        customised: !!edited,
        updatedAt: (edited as { updatedAt?: Date } | undefined)?.updatedAt,
      };
    });
  }

  async saveTemplate(key: string, input: { subject: string; body: string; enabled?: boolean }, userId: string) {
    if (!TEMPLATE_BY_KEY.has(key)) throw new NotFoundException(`Unknown email template ${key}`);
    const before = await this.templates.findOne({ key }).lean();
    const saved = await this.templates.findOneAndUpdate(
      { key },
      { $set: { subject: input.subject, body: input.body, enabled: input.enabled ?? true, updatedBy: new Types.ObjectId(userId) } },
      { upsert: true, new: true },
    );
    return { before, after: saved };
  }

  async resetTemplate(key: string) {
    await this.templates.deleteOne({ key });
  }

  async preview(key: string) {
    const definition = TEMPLATE_BY_KEY.get(key);
    if (!definition) throw new NotFoundException(`Unknown email template ${key}`);
    const sample = Object.fromEntries(definition.variables.map((v) => [v, sampleValue(v)]));
    const email = await this.render(key, sample);
    return { subject: email.subject, body: email.body, html: textToHtml(email.body, email.siteName) };
  }

  recentLog(filter: { to?: string; template?: string; limit?: number }) {
    const query: Record<string, unknown> = {};
    if (filter.to) query.to = filter.to.toLowerCase();
    if (filter.template) query.template = filter.template;
    return this.log.find(query).sort({ createdAt: -1 }).limit(Math.min(200, filter.limit ?? 50)).lean();
  }
}

function sampleValue(name: string): string {
  const samples: Record<string, string> = {
    name: 'Marco',
    businessName: 'Bella Napoli',
    offerTitle: '20% off orders over £15',
    link: siteUrl('/dashboard'),
    reason: 'The document did not match the listing address',
    note: 'Please upload a utility bill showing the shop address.',
    message: 'Please upload a utility bill showing the shop address.',
    planName: 'Standard',
    amount: '£19.99',
    code: '482913',
    role: 'staff',
    inviterName: 'Marco Rossi',
    expiresOn: '20 October 2026',
    endsOn: 'Friday 9 October',
    renewsOn: '6 November 2026',
    deadline: 'Thursday 8 October, 6pm',
    attempt: '1',
    downgradeOn: '20 October 2026',
    productName: 'Top of search',
    month: 'September 2026',
    outcome: 'approved',
    fields: 'phone number',
    number: 'T-10234',
    subject: 'My listing shows the wrong phone number',
  };
  return samples[name] ?? name;
}
