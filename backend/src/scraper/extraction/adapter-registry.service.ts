import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ScraperAdapterStatus, ScraperAdapterType } from '../../common/scraper.enums';
import { ScraperAdapter, ScraperAdapterDocument } from '../../schemas/scraper-adapter.schema';
import { WebsiteFingerprint, WebsiteFingerprintDocument } from '../../schemas/website-fingerprint.schema';
import type { AdapterMatchResult, WebsiteContext } from './adapter.types';
import { BuiltinAdapter } from './adapters/builtin-adapter';
import { GenericHtmlAdapter } from './adapters/generic-html.adapter';
import { JsonLdAdapter } from './adapters/jsonld.adapter';
import { OrderNestAdapter } from './adapters/ordernest.adapter';
import { SelectorAdapter } from './adapters/selector-adapter';
import { parseSelectorConfig } from './selector-config';

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

type AdapterLean = ScraperAdapter & { _id: Types.ObjectId };
type FingerprintLean = WebsiteFingerprint & { _id: Types.ObjectId };

const CODE_ADAPTER_TYPES: Record<string, { type: ScraperAdapterType; provider?: string }> = {
  'provider-ordernest': { type: ScraperAdapterType.PROVIDER, provider: 'OrderNest' },
  'generic-jsonld': { type: ScraperAdapterType.BUILTIN_JSONLD },
  'generic-html': { type: ScraperAdapterType.BUILTIN_HTML },
};

const SELECTOR_CACHE_MS = 15_000;

/**
 * Spec §5 precedence: among adapters that can handle a site, the highest priority wins (provider 400 >
 * selector 300 > JSON-LD 200 > HTML 100) and ties go to the best match score. Paused adapters are never
 * selected; selector adapters are the current approved (or testing) version of each key.
 */
@Injectable()
export class AdapterRegistry implements OnModuleInit {
  private readonly logger = new Logger(AdapterRegistry.name);
  private readonly codeAdapters: BuiltinAdapter[] = [new OrderNestAdapter(), new JsonLdAdapter(), new GenericHtmlAdapter()];
  private selectorCache?: { at: number; adapters: SelectorAdapter[] };

  constructor(
    @InjectModel(ScraperAdapter.name) private readonly model: Model<ScraperAdapterDocument>,
    @InjectModel(WebsiteFingerprint.name) private readonly fingerprints: Model<WebsiteFingerprintDocument>,
  ) {}

  async onModuleInit() {
    await this.ensureRegistered();
  }

  // Code adapters get a database record so admins can see and pause them like any other adapter.
  async ensureRegistered(): Promise<void> {
    await Promise.all(
      this.codeAdapters.map((adapter) =>
        this.model.updateOne(
          { key: adapter.id, version: adapter.version },
          {
            $setOnInsert: { key: adapter.id, version: adapter.version, status: ScraperAdapterStatus.ACTIVE },
            $set: { name: adapter.name, priority: adapter.priority, isCurrent: true, ...CODE_ADAPTER_TYPES[adapter.id] },
          },
          { upsert: true },
        ),
      ),
    );
  }

  byId(id: string): BuiltinAdapter | undefined {
    return this.codeAdapters.find((a) => a.id === id);
  }

  list(): BuiltinAdapter[] {
    return [...this.codeAdapters];
  }

  invalidate(): void {
    this.selectorCache = undefined;
  }

  // Builds a runnable adapter from a stored selector adapter version, whatever its status (used by test runs).
  async fromRecord(record: AdapterLean): Promise<SelectorAdapter> {
    const { config, errors } = parseSelectorConfig(record.configuration);
    if (!config) throw new Error(`Adapter ${record.key}@${record.version} has an invalid configuration: ${errors.join('; ')}`);
    const fingerprint = record.fingerprintRef ? await this.fingerprints.findById(record.fingerprintRef).lean<FingerprintLean>() : null;
    return new SelectorAdapter({
      key: record.key,
      name: record.name,
      version: record.version,
      status: record.status,
      exampleDomains: record.exampleDomains ?? [],
      config,
      fingerprint: fingerprint
        ? { id: String(fingerprint._id), name: fingerprint.name, markers: fingerprint.markers, categoryWeights: fingerprint.categoryWeights, thresholds: fingerprint.thresholds }
        : undefined,
    });
  }

  async selectorAdapters(): Promise<SelectorAdapter[]> {
    if (this.selectorCache && Date.now() - this.selectorCache.at < SELECTOR_CACHE_MS) return this.selectorCache.adapters;
    const records = await this.model
      .find({ type: ScraperAdapterType.SELECTOR, isCurrent: true, status: { $in: [ScraperAdapterStatus.APPROVED, ScraperAdapterStatus.TESTING] } })
      .lean<AdapterLean[]>();
    const adapters: SelectorAdapter[] = [];
    for (const record of records) {
      try {
        const adapter = await this.fromRecord(record);
        if (adapter.definition.fingerprint) adapters.push(adapter);
      } catch (err) {
        this.logger.warn((err as Error).message);
      }
    }
    this.selectorCache = { at: Date.now(), adapters };
    return adapters;
  }

  // The adapter a run selected, by id and version: later stages must use exactly the same one.
  async resolve(id: string, version?: string): Promise<BuiltinAdapter | undefined> {
    const code = this.byId(id);
    if (code) return code;
    const record = await this.model
      .findOne({ key: id, type: ScraperAdapterType.SELECTOR, ...(version ? { version } : { isCurrent: true }) })
      .lean<AdapterLean>();
    if (!record || record.status === ScraperAdapterStatus.WITHDRAWN || record.status === ScraperAdapterStatus.DRAFT) return undefined;
    return this.fromRecord(record);
  }

  async select(ctx: WebsiteContext): Promise<AdapterSelection> {
    const paused = new Set<string>(await this.model.find({ status: ScraperAdapterStatus.PAUSED, isCurrent: { $ne: false } }).distinct('key'));
    const candidates = [...(await this.selectorAdapters()), ...this.codeAdapters].filter((adapter) => !paused.has(adapter.id));
    const considered: { adapter: BuiltinAdapter; match: AdapterMatchResult }[] = [];
    for (const adapter of candidates) {
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
