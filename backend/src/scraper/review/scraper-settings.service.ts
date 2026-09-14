import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  SCRAPER_SETTINGS_KEY,
  ScraperSettings,
  ScraperSettingsDocument,
} from '../../schemas/scraper-settings.schema';

const CACHE_MS = 5_000;

@Injectable()
export class ScraperSettingsService {
  private cached?: { at: number; value: ScraperSettings };

  constructor(@InjectModel(ScraperSettings.name) private readonly model: Model<ScraperSettingsDocument>) {}

  async get(): Promise<ScraperSettings> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.value;
    const value = await this.model
      .findOneAndUpdate(
        { key: SCRAPER_SETTINGS_KEY },
        { $setOnInsert: { key: SCRAPER_SETTINGS_KEY } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean<ScraperSettings>();
    this.cached = { at: Date.now(), value };
    return value;
  }

  async update(patch: Partial<Omit<ScraperSettings, 'key'>>): Promise<{ before: ScraperSettings; after: ScraperSettings }> {
    const before = await this.get();
    const after = await this.model
      .findOneAndUpdate({ key: SCRAPER_SETTINGS_KEY }, { $set: patch }, { new: true, upsert: true, runValidators: true })
      .lean<ScraperSettings>();
    this.cached = { at: Date.now(), value: after };
    return { before, after };
  }

  invalidate() {
    this.cached = undefined;
  }
}
