import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { canonicalUkPostcode, normaliseBusinessName } from '../common/business-identity';

export interface FhrsEstablishment {
  fhrsId: string;
  name: string;
  address: string;
  postcode?: string;
  rating?: string;
  ratingDate?: string;
  authority?: string;
}

interface ApiEstablishment {
  FHRSID: number;
  BusinessName: string;
  AddressLine1?: string;
  AddressLine2?: string;
  AddressLine3?: string;
  AddressLine4?: string;
  PostCode?: string;
  RatingValue?: string;
  RatingDate?: string;
  LocalAuthorityName?: string;
}

const API = 'https://api.ratings.food.gov.uk';

function toEstablishment(e: ApiEstablishment): FhrsEstablishment {
  return {
    fhrsId: String(e.FHRSID),
    name: e.BusinessName,
    address: [e.AddressLine1, e.AddressLine2, e.AddressLine3, e.AddressLine4].filter(Boolean).join(', '),
    postcode: e.PostCode,
    rating: e.RatingValue,
    ratingDate: e.RatingDate,
    authority: e.LocalAuthorityName,
  };
}

/**
 * The Food Standards Agency's public ratings API (no key needed). Spec evidence 4: the owner picks their
 * Food Hygiene Rating listing, and its name and postcode must match the takeaway's.
 */
@Injectable()
export class FhrsService {
  private readonly logger = new Logger(FhrsService.name);

  private async get<T>(path: string): Promise<T> {
    try {
      const res = await fetch(`${API}${path}`, {
        headers: { 'x-api-version': '2', accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`FHRS responded ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      this.logger.warn(`FHRS lookup failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('The Food Hygiene Rating service is not answering. Try again later, or use another kind of evidence.');
    }
  }

  async search(name: string, postcode?: string): Promise<FhrsEstablishment[]> {
    const params = new URLSearchParams({ name, pageSize: '15', pageNumber: '1' });
    if (postcode) params.set('address', postcode);
    const data = await this.get<{ establishments?: ApiEstablishment[] }>(`/Establishments?${params.toString()}`);
    return (data.establishments ?? []).map(toEstablishment);
  }

  async byId(fhrsId: string): Promise<FhrsEstablishment | null> {
    if (!/^\d{1,12}$/.test(fhrsId)) return null;
    const data = await this.get<ApiEstablishment>(`/Establishments/${fhrsId}`);
    return data?.FHRSID ? toEstablishment(data) : null;
  }
}

/** Names match when they share most of their words once legal suffixes and punctuation are gone. */
export function namesMatch(a: string | undefined, b: string | undefined): boolean {
  const left = normaliseBusinessName(a)?.split(' ').filter((w) => w.length > 1) ?? [];
  const right = normaliseBusinessName(b)?.split(' ').filter((w) => w.length > 1) ?? [];
  if (!left.length || !right.length) return false;
  if (left.join(' ') === right.join(' ')) return true;
  const shared = left.filter((w) => right.includes(w)).length;
  return shared / Math.min(left.length, right.length) >= 0.6;
}

export function postcodesMatch(a: string | undefined, b: string | undefined): boolean {
  const left = canonicalUkPostcode(a);
  return !!left && left === canonicalUkPostcode(b);
}
