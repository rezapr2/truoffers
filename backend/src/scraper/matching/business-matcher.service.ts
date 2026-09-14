import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  canonicalUkPostcode,
  normaliseBusinessName,
  normaliseUkPhone,
  normaliseWebsiteHost,
} from '../../common/business-identity';
import { outwardCode } from '../../common/postcode.util';
import { BranchMatchStatus } from '../../common/scraper.enums';
import { Business, BusinessDocument } from '../../schemas/business.schema';
import type { ExtractedBusiness } from '../extraction/adapter.types';
import { MATCH_THRESHOLDS } from '../scraper.constants';
import { trigramSimilarity } from './trigram';

export interface MatchSuggestionResult {
  businessId: Types.ObjectId;
  score: number;
  signals: string[];
}

export interface MatchDecision {
  status: BranchMatchStatus.AUTO_MATCHED | BranchMatchStatus.NEEDS_REVIEW | BranchMatchStatus.NEW_BUSINESS_PROPOSED;
  businessId?: Types.ObjectId;
  score: number;
  signals: string[];
  suggestions: MatchSuggestionResult[];
}

type CandidateBusiness = Pick<
  Business,
  'name' | 'phoneE164' | 'postcodeCanonical' | 'nameNormalized' | 'websiteHost' | 'address' | 'town'
> & { _id: Types.ObjectId };

const PROJECTION = { name: 1, phoneE164: 1, postcodeCanonical: 1, nameNormalized: 1, websiteHost: 1, address: 1, town: 1 };
const MAX_SUGGESTIONS = 5;

interface Signals {
  host: boolean;
  phone: boolean;
  postcode: boolean;
  nameSimilarity: number;
  addressSimilarity: number;
}

function score(s: Signals): number {
  return Math.min(100, Math.round((s.host ? 25 : 0) + (s.phone ? 30 : 0) + (s.postcode ? 25 : 0) + s.nameSimilarity * 20));
}

function describe(s: Signals): string[] {
  const out: string[] = [];
  if (s.host) out.push('website domain');
  if (s.phone) out.push('telephone');
  if (s.postcode) out.push('postcode');
  if (s.nameSimilarity > 0) out.push(`name ${s.nameSimilarity.toFixed(2)}`);
  if (s.addressSimilarity >= 0.6) out.push(`address ${s.addressSimilarity.toFixed(2)}`);
  return out;
}

// Spec §8: telephone + (postcode or name), postcode + name, or domain + postcode, for exactly one business.
function isStrong(s: Signals): boolean {
  const name = s.nameSimilarity >= MATCH_THRESHOLDS.nameSimilarity;
  return (s.phone && (s.postcode || name)) || (s.postcode && name) || (s.host && s.postcode);
}

function isWorthSuggesting(s: Signals): boolean {
  return s.host || s.phone || s.postcode || s.nameSimilarity >= MATCH_THRESHOLDS.suggestionFloor;
}

/**
 * Matches an extracted branch to existing listings using indexed lookups only (domain, phone, postcode,
 * text search on name within the area), then scores candidates in memory. New businesses are never
 * created here: that needs an admin.
 */
@Injectable()
export class BusinessMatcherService {
  constructor(@InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>) {}

  async match(extracted: ExtractedBusiness, siteDomain: string): Promise<MatchDecision> {
    const phone = normaliseUkPhone(extracted.telephone);
    const postcode = canonicalUkPostcode(extracted.postcode);
    const name = normaliseBusinessName(extracted.name);
    const host = normaliseWebsiteHost(siteDomain);

    const lookups: Promise<CandidateBusiness[]>[] = [];
    const find = (filter: Record<string, unknown>, limit = 25) =>
      this.businesses.find(filter, PROJECTION).limit(limit).lean<CandidateBusiness[]>().exec();
    if (host) lookups.push(find({ websiteHost: host }));
    if (phone) lookups.push(find({ phoneE164: phone }));
    if (postcode) lookups.push(find({ postcodeCanonical: postcode }));
    if (name) {
      const area = postcode ? { postcodeArea: outwardCode(postcode) } : extracted.town ? { town: new RegExp(`^${escapeRegex(extracted.town)}$`, 'i') } : null;
      if (area) lookups.push(find({ $text: { $search: name }, ...area }, 20));
    }

    const candidates = new Map<string, CandidateBusiness>();
    for (const found of await Promise.all(lookups)) for (const c of found) candidates.set(String(c._id), c);

    const scored = [...candidates.values()].map((c) => {
      const signals: Signals = {
        host: !!host && c.websiteHost === host,
        phone: !!phone && c.phoneE164 === phone,
        postcode: !!postcode && c.postcodeCanonical === postcode,
        nameSimilarity: name && c.nameNormalized ? trigramSimilarity(name, c.nameNormalized) : 0,
        addressSimilarity: extracted.address && c.address ? trigramSimilarity(extracted.address, c.address) : 0,
      };
      return { business: c, signals, score: score(signals) };
    });

    const strong = scored.filter((c) => isStrong(c.signals));
    const suggestions = scored
      .filter((c) => isWorthSuggesting(c.signals))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SUGGESTIONS)
      .map((c) => ({ businessId: c.business._id, score: c.score, signals: describe(c.signals) }));

    if (strong.length === 1) {
      const [best] = strong;
      return {
        status: BranchMatchStatus.AUTO_MATCHED,
        businessId: best.business._id,
        score: best.score,
        signals: describe(best.signals),
        suggestions,
      };
    }
    if (suggestions.length > 0) {
      return {
        status: BranchMatchStatus.NEEDS_REVIEW,
        score: suggestions[0].score,
        signals: strong.length > 1 ? ['several listings match equally well'] : suggestions[0].signals,
        suggestions,
      };
    }
    return { status: BranchMatchStatus.NEW_BUSINESS_PROPOSED, score: 0, signals: [], suggestions: [] };
  }
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
