import { NullAiOfferExtractor } from '../../../../src/scraper/extraction/ai/ai-offer-extractor';
import { AnthropicAiOfferExtractor } from '../../../../src/scraper/extraction/ai/anthropic-offer-extractor';
import type { AiOffer } from '../../../../src/scraper/extraction/ai/ai-offer.schema';

const CHECKED_AT = new Date('2026-09-14T10:00:00Z');
const PAGE_BLOCKS = [
  'Sushi Sunday: 25% off all platters every Sunday. Use code SUSHI25. Ends 31st October.',
  'Minimum order £20. Collection only.',
  'Open Monday to Sunday 12pm - 10pm.',
];

const nullEvidence = {
  shortDescription: null,
  terms: null,
  discountPercentage: null,
  discountAmount: null,
  originalPrice: null,
  promotionalPrice: null,
  promoCode: null,
  minimumOrder: null,
  freeItem: null,
  collectionEligible: null,
  deliveryEligible: null,
  newCustomersOnly: null,
  eligibleWeekdays: null,
  dailyStartTime: null,
  dailyEndTime: null,
  startDate: null,
  endDate: null,
};

function aiOffer(overrides: Partial<AiOffer> = {}, evidence: Partial<AiOffer['evidence']> = {}): AiOffer {
  return {
    title: 'Sushi Sunday: 25% off all platters',
    offerType: 'percentage_discount',
    shortDescription: null,
    terms: null,
    discountPercentage: 25,
    discountAmount: null,
    originalPrice: null,
    promotionalPrice: null,
    promoCode: 'SUSHI25',
    minimumOrder: 20,
    freeItem: null,
    collectionEligible: true,
    deliveryEligible: null,
    newCustomersOnly: null,
    eligibleWeekdays: ['sun'],
    dailyStartTime: null,
    dailyEndTime: null,
    startDate: null,
    endDate: '2026-10-31',
    ...overrides,
    evidence: {
      ...nullEvidence,
      title: 'Sushi Sunday: 25% off all platters every Sunday',
      offerType: '25% off all platters',
      discountPercentage: '25% off all platters',
      promoCode: 'Use code SUSHI25',
      minimumOrder: 'Minimum order £20',
      collectionEligible: 'Collection only',
      eligibleWeekdays: 'every Sunday',
      endDate: 'Ends 31st October',
      ...evidence,
    },
  };
}

function stubClient(response: Record<string, unknown>) {
  const parse = jest.fn().mockResolvedValue({
    stop_reason: 'end_turn',
    usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 900 },
    ...response,
  });
  return { client: { beta: { messages: { parse } } } as any, parse };
}

const input = {
  pageUrl: 'https://spa-only.test/',
  pageTitle: 'Sushi Stop',
  blocks: PAGE_BLOCKS,
  checkedAt: CHECKED_AT,
  adapterId: 'generic-html',
  adapterVersion: '1.0.0',
};

describe('AI-assisted extraction', () => {
  it('is disabled without an API key', async () => {
    const extractor = new NullAiOfferExtractor();
    expect(extractor.available).toBe(false);
    await expect(extractor.extract()).resolves.toEqual({ mode: 'disabled', extractions: [], droppedFields: [] });
  });

  it('sends page text as data with a cached system prompt, refusal fallbacks and structured output', async () => {
    const { client, parse } = stubClient({ parsed_output: { offers: [] } });
    await new AnthropicAiOfferExtractor(client).extract(input);
    const [params] = parse.mock.calls[0];
    expect(params).toMatchObject({
      model: 'claude-opus-5',
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
    });
    expect(params.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(params.system[0].text).not.toContain('SUSHI25');
    expect(params.messages[0].content).toContain('<block id="1">');
    expect(params.messages[0].content).toContain('Check date (Europe/London): 2026-09-14 (mon)');
    expect(params.output_config.format).toBeDefined();
  });

  it('keeps fields whose quotes appear on the page and re-derive to the same value', async () => {
    const { client } = stubClient({ parsed_output: { offers: [aiOffer()] } });
    const result = await new AnthropicAiOfferExtractor(client).extract(input);
    expect(result.extractions).toHaveLength(1);
    const { offer, signals } = result.extractions[0];
    expect(offer).toMatchObject({
      offerType: 'percentage_discount',
      discountPercentage: 25,
      promoCode: 'SUSHI25',
      minimumOrder: 20,
      collectionEligible: true,
      eligibleWeekdays: ['sun'],
      endDate: '2026-10-31',
      extractionMethod: 'ai_assisted',
      currency: 'GBP',
    });
    expect(offer.evidence.promoCode).toEqual({ sourceUrl: 'https://spa-only.test/', text: 'Use code SUSHI25', method: 'ai:claude-opus-5' });
    expect(signals.aiOnly).toBe(true);
    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 300, cacheReadInputTokens: 900 });
  });

  it.each([
    ['a promo code the page never mentions', { promoCode: 'FREE50' }, { promoCode: 'Use code FREE50' }, 'promoCode'],
    ['a date the quote does not state', { endDate: '2026-11-30' }, {}, 'endDate'],
    ['a price missing from its quote', { minimumOrder: 15 }, {}, 'minimumOrder'],
    ['a percentage missing from its quote', { discountPercentage: 50 }, {}, 'discountPercentage'],
    ['a weekday the quote does not name', { eligibleWeekdays: ['sat', 'sun'] as AiOffer['eligibleWeekdays'] }, {}, 'eligibleWeekdays'],
    ['a value with no quote at all', { dailyStartTime: '12:00' }, {}, 'dailyStartTime'],
  ])('drops %s', async (_, overrides, evidence, field) => {
    const { client } = stubClient({ parsed_output: { offers: [aiOffer(overrides, evidence)] } });
    const result = await new AnthropicAiOfferExtractor(client).extract(input);
    expect(result.extractions).toHaveLength(1);
    expect((result.extractions[0].offer as any)[field]).toBeUndefined();
    expect(result.extractions[0].offer.evidence[field]).toBeUndefined();
    expect(result.droppedFields).toContain(field);
  });

  it('discards offers whose headline is not on the page', async () => {
    const hallucinated = aiOffer({ title: '50% off everything' }, { title: '50% off everything today', offerType: '50% off everything' });
    const { client } = stubClient({ parsed_output: { offers: [hallucinated] } });
    const result = await new AnthropicAiOfferExtractor(client).extract(input);
    expect(result.extractions).toHaveLength(0);
  });

  it('discards "offers" whose quote carries no benefit', async () => {
    const hours = aiOffer({ offerType: 'custom' }, { title: 'Open Monday to Sunday 12pm - 10pm', offerType: 'Open Monday to Sunday' });
    const { client } = stubClient({ parsed_output: { offers: [hours] } });
    expect((await new AnthropicAiOfferExtractor(client).extract(input)).extractions).toHaveLength(0);
  });

  it('returns nothing when the model declines', async () => {
    const { client } = stubClient({ stop_reason: 'refusal', parsed_output: null });
    await expect(new AnthropicAiOfferExtractor(client).extract(input)).resolves.toMatchObject({ refused: true, extractions: [] });
  });

  it('returns nothing when the response does not match the schema', async () => {
    const { client } = stubClient({ parsed_output: { offers: [{ title: 'x' }] } });
    await expect(new AnthropicAiOfferExtractor(client).extract(input)).resolves.toMatchObject({
      extractions: [],
      droppedFields: ['response'],
    });
  });

  it('uses the configured model', async () => {
    const { client, parse } = stubClient({ parsed_output: { offers: [] } });
    await new AnthropicAiOfferExtractor(client, 'claude-sonnet-5').extract(input);
    expect(parse.mock.calls[0][0].model).toBe('claude-sonnet-5');
  });
});
