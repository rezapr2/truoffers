import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ScraperAdapterStatus, ScraperAdapterType } from '../../common/scraper.enums';
import { ScraperAdapter, ScraperAdapterDocument } from '../../schemas/scraper-adapter.schema';
import type { AdapterMatchResult, WebsiteContext } from './adapter.types';
import { BuiltinAdapter } from './adapters/builtin-adapter';
import { GenericHtmlAdapter } from './adapters/generic-html.adapter';
import { JsonLdAdapter } from './adapters/jsonld.adapter';

export class NoAdapterAvailableError extends Error {
  constructor() {
    super('No active adapter can handle this website');
    this.name = 'NoAdapterAvailableError';
  }
}

export interface AdapterSelection {
  adapter: BuiltinAdapter;
  match: AdapterMatchResult;
  considered: { id: string; version: string; priority: number; match: AdapterMatchResult }[];
}

const BUILTIN_TYPES: Record<string, ScraperAdapterType> = {
  'generic-jsonld': ScraperAdapterType.BUILTIN_JSONLD,
  'generic-html': ScraperAdapterType.BUILTIN_HTML,
};

/**
 * Spec §5 precedence: among adapters that can handle a site, the highest priority wins and ties go to
 * the best match score. Paused adapters are never selected.
 */
@Injectable()
export class AdapterRegistry implements OnModuleInit {
  private readonly adapters: BuiltinAdapter[] = [new JsonLdAdapter(), new GenericHtmlAdapter()];

  constructor(@InjectModel(ScraperAdapter.name) private readonly model: Model<ScraperAdapterDocument>) {}

  async onModuleInit() {
    await this.ensureRegistered();
  }

  // Built-in adapters get a database record so admins can pause them like any other adapter.
  async ensureRegistered(): Promise<void> {
    await Promise.all(
      this.adapters.map((adapter) =>
        this.model.updateOne(
          { key: adapter.id, version: adapter.version },
          {
            $setOnInsert: {
              key: adapter.id,
              version: adapter.version,
              name: adapter.name,
              type: BUILTIN_TYPES[adapter.id],
              priority: adapter.priority,
              status: ScraperAdapterStatus.ACTIVE,
            },
          },
          { upsert: true },
        ),
      ),
    );
  }

  byId(id: string): BuiltinAdapter | undefined {
    return this.adapters.find((a) => a.id === id);
  }

  list(): BuiltinAdapter[] {
    return [...this.adapters];
  }

  async select(ctx: WebsiteContext): Promise<AdapterSelection> {
    const paused = new Set<string>(await this.model.find({ status: ScraperAdapterStatus.PAUSED }).distinct('key'));
    const considered: { adapter: BuiltinAdapter; match: AdapterMatchResult }[] = [];
    for (const adapter of this.adapters) {
      if (paused.has(adapter.id)) continue;
      considered.push({ adapter, match: await adapter.canHandle(ctx) });
    }
    const eligible = considered
      .filter((c) => c.match.canHandle)
      .sort((a, b) => b.adapter.priority - a.adapter.priority || b.match.score - a.match.score);
    if (eligible.length === 0) throw new NoAdapterAvailableError();
    return {
      adapter: eligible[0].adapter,
      match: eligible[0].match,
      considered: considered.map((c) => ({ id: c.adapter.id, version: c.adapter.version, priority: c.adapter.priority, match: c.match })),
    };
  }
}
