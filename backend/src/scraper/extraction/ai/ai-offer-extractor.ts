import type { OfferExtraction } from '../adapter.types';

export interface AiExtractionInput {
  pageUrl: string;
  pageTitle?: string;
  // Offer-relevant text blocks from the page, not the whole page.
  blocks: string[];
  checkedAt: Date;
  adapterId: string;
  adapterVersion: string;
}

export interface AiExtractionResult {
  mode: 'ai' | 'disabled';
  extractions: OfferExtraction[];
  droppedFields: string[];
  refused?: boolean;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number; cacheReadInputTokens: number };
}

export interface AiOfferExtractor {
  readonly available: boolean;
  extract(input: AiExtractionInput, signal?: AbortSignal): Promise<AiExtractionResult>;
}

// Bound when ANTHROPIC_API_KEY is not set: AI-assisted extraction is disabled.
export class NullAiOfferExtractor implements AiOfferExtractor {
  readonly available = false;

  async extract(): Promise<AiExtractionResult> {
    return { mode: 'disabled', extractions: [], droppedFields: [] };
  }
}
