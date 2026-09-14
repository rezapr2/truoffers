import { z } from 'zod';
import { OFFER_TYPES, WEEKDAYS } from '../../../common/scraper.enums';

// Every field is required-but-nullable: structured outputs need all properties present.
const quote = z.string().nullable().describe('Exact text copied from the page that supports this field, or null');

export const AiOfferSchema = z.object({
  title: z.string().describe('Short title using the wording on the page'),
  offerType: z.enum(OFFER_TYPES),
  shortDescription: z.string().nullable(),
  terms: z.string().nullable(),
  discountPercentage: z.number().nullable(),
  discountAmount: z.number().nullable(),
  originalPrice: z.number().nullable(),
  promotionalPrice: z.number().nullable(),
  promoCode: z.string().nullable(),
  minimumOrder: z.number().nullable(),
  freeItem: z.string().nullable(),
  collectionEligible: z.boolean().nullable(),
  deliveryEligible: z.boolean().nullable(),
  newCustomersOnly: z.boolean().nullable(),
  eligibleWeekdays: z.array(z.enum(WEEKDAYS)).nullable(),
  dailyStartTime: z.string().nullable().describe('HH:mm, 24-hour, Europe/London'),
  dailyEndTime: z.string().nullable().describe('HH:mm, 24-hour, Europe/London'),
  startDate: z.string().nullable().describe('YYYY-MM-DD'),
  endDate: z.string().nullable().describe('YYYY-MM-DD'),
  evidence: z.object({
    title: z.string().describe('Exact text copied from the page that states the offer'),
    offerType: z.string(),
    shortDescription: quote,
    terms: quote,
    discountPercentage: quote,
    discountAmount: quote,
    originalPrice: quote,
    promotionalPrice: quote,
    promoCode: quote,
    minimumOrder: quote,
    freeItem: quote,
    collectionEligible: quote,
    deliveryEligible: quote,
    newCustomersOnly: quote,
    eligibleWeekdays: quote,
    dailyStartTime: quote,
    dailyEndTime: quote,
    startDate: quote,
    endDate: quote,
  }),
});

export const AiExtractionSchema = z.object({
  offers: z.array(AiOfferSchema),
});

export type AiOffer = z.infer<typeof AiOfferSchema>;
export type AiExtraction = z.infer<typeof AiExtractionSchema>;
