import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SiteSettings, SiteSettingsDocument, SettingsSecrets } from '../schemas/site-settings.schema';
import { decryptSecret, encryptSecret } from './crypto';

export type SecretName = keyof SettingsSecrets;

// The environment variable each secret falls back to.
export const SECRET_ENV: Record<SecretName, string> = {
  stripeSecretKey: 'STRIPE_SECRET_KEY',
  stripeWebhookSecret: 'STRIPE_WEBHOOK_SECRET',
  twilioAccountSid: 'TWILIO_ACCOUNT_SID',
  twilioAuthToken: 'TWILIO_AUTH_TOKEN',
  twilioVerifyServiceSid: 'TWILIO_VERIFY_SERVICE_SID',
  resendApiKey: 'RESEND_API_KEY',
  recaptchaSecretKey: 'RECAPTCHA_SECRET_KEY',
};

export type SettingsView = Omit<SiteSettings, 'secrets'> & {
  secrets: Record<SecretName, { configured: boolean; source: 'settings' | 'environment' | null; hint?: string }>;
};

const CACHE_MS = 10_000;

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private cache: { value: SiteSettings; at: number } | null = null;

  constructor(@InjectModel(SiteSettings.name) private readonly model: Model<SiteSettingsDocument>) {}

  async get(): Promise<SiteSettings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const doc = await this.model
      .findOneAndUpdate({ key: 'site' }, { $setOnInsert: { key: 'site' } }, { upsert: true, new: true, setDefaultsOnInsert: true })
      .lean();
    // A document written outside this service (a migration, an older version) may lack newer fields:
    // hydrating it fills every missing one with the schema default.
    const value = new this.model(doc).toObject() as unknown as SiteSettings;
    this.cache = { value, at: Date.now() };
    return value;
  }

  invalidate() {
    this.cache = null;
  }

  /** A secret from settings (decrypted), or its environment variable. */
  async secret(name: SecretName): Promise<string | undefined> {
    const settings = await this.get();
    const stored = settings.secrets?.[name];
    if (stored) {
      const plain = decryptSecret(stored);
      if (plain) return plain;
      this.logger.warn(`Stored ${name} could not be decrypted (encryption key changed?); using the environment`);
    }
    return process.env[SECRET_ENV[name]] || undefined;
  }

  async view(): Promise<SettingsView> {
    const settings = await this.get();
    const secrets = {} as SettingsView['secrets'];
    for (const name of Object.keys(SECRET_ENV) as SecretName[]) {
      const fromSettings = decryptSecret(settings.secrets?.[name]);
      const fromEnv = process.env[SECRET_ENV[name]];
      const value = fromSettings || fromEnv;
      secrets[name] = {
        configured: !!value,
        source: fromSettings ? 'settings' : fromEnv ? 'environment' : null,
        hint: value ? `…${value.slice(-4)}` : undefined,
      };
    }
    const { secrets: _hidden, ...rest } = settings;
    return { ...rest, secrets };
  }

  async update(patch: Partial<Omit<SiteSettings, 'secrets' | 'key'>> & { secrets?: Partial<Record<SecretName, string | null>> }) {
    const { secrets, ...fields } = patch;
    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [inner, innerValue] of Object.entries(value)) {
          if (innerValue !== undefined) set[`${field}.${inner}`] = innerValue;
        }
      } else {
        set[field] = value;
      }
    }
    for (const [name, value] of Object.entries(secrets ?? {})) {
      if (value === undefined) continue;
      // An empty string or null clears the stored secret (the environment value applies again).
      if (!value) unset[`secrets.${name}`] = 1;
      else set[`secrets.${name}`] = encryptSecret(value);
    }
    await this.model.updateOne(
      { key: 'site' },
      { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      { upsert: true },
    );
    this.invalidate();
    return this.view();
  }

  async publicSettings() {
    const settings = await this.get();
    return {
      siteName: settings.siteName,
      contactEmail: settings.contactEmail,
      contactPhone: settings.contactPhone,
      maintenanceMode: settings.maintenanceMode,
      maintenanceMessage: settings.maintenanceMessage,
      recaptchaSiteKey: (await this.secret('recaptchaSecretKey')) ? settings.recaptchaSiteKey || process.env.RECAPTCHA_SITE_KEY : undefined,
      vatRatePercent: settings.vatRatePercent,
      pricesIncludeVat: settings.pricesIncludeVat,
    };
  }
}
