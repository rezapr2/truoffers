import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CreateBusinessDto } from '../../businesses/businesses.dto';
import {
  CandidateStatus,
  ConfidenceBand,
  DomainAuthorisationStatus,
  FingerprintMatchCategory,
  ImportJobStatus,
  ImportJobType,
  MarkerCategory,
  OFFER_TYPES,
  OfferVerification,
  ProviderPolicyBasis,
  ProviderPolicyStatus,
  WEEKDAYS,
} from '../../common/scraper.enums';
import type { OfferType, Weekday } from '../../common/scraper.enums';
import { OfferRevisionStatus } from '../../common/scraper.enums';
import { INTAKE_LIMITS } from '../scraper.constants';

const toBoolean = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

export class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

// ---------- websites ----------

export class SubmitWebsitesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(INTAKE_LIMITS.maxUrlsPerRequest)
  @IsString({ each: true })
  @MaxLength(2048, { each: true })
  urls: string[];
}

export class ProviderClientListDto {
  @IsMongoId()
  providerPolicyId: string;
}

export class ListWebsitesQuery extends PageQuery {
  @IsOptional() @IsEnum(DomainAuthorisationStatus) status?: DomainAuthorisationStatus;
  @IsOptional() @IsMongoId() providerId?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class AuthoriseWebsiteDto {
  @IsIn(['approve', 'deny']) decision: 'approve' | 'deny';
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class PauseDto {
  @IsBoolean() paused: boolean;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class CrawlConfigDto {
  @IsOptional() @IsInt() @Min(250) @Max(60_000) rateLimitMs?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1000) pageCap?: number;
  // Hours between rechecks of this website's published offers; null goes back to the adapter or default.
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsInt() @Min(1) @Max(24 * 30) recheckIntervalHours?: number | null;
}

export class ReasonDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class BranchDecisionDto {
  @IsIn(['confirm', 'attach', 'create', 'reject']) action: 'confirm' | 'attach' | 'create' | 'reject';
  @IsOptional() @IsMongoId() businessId?: string;
  @IsOptional() @ValidateNested() @Type(() => CreateBusinessDto) business?: CreateBusinessDto;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

// ---------- candidates ----------

export class ListCandidatesQuery extends PageQuery {
  @IsOptional() @IsEnum(CandidateStatus) status?: CandidateStatus;
  @IsOptional() @IsEnum(ConfidenceBand) band?: ConfidenceBand;
  @IsOptional() @Transform(toBoolean) @IsBoolean() duplicate?: boolean;
  @IsOptional() @IsMongoId() websiteId?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class EditCandidateDto {
  @IsOptional() @IsString() @MinLength(4) @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(600) shortDescription?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) terms?: string | null;
  @IsOptional() @IsIn(OFFER_TYPES) offerType?: OfferType;
  @IsOptional() @IsNumber() @Min(0.1) @Max(100) discountPercentage?: number | null;
  @IsOptional() @IsNumber() @Min(0.01) @Max(500) discountAmount?: number | null;
  @IsOptional() @IsNumber() @Min(0.01) @Max(500) originalPrice?: number | null;
  @IsOptional() @IsNumber() @Min(0.01) @Max(500) promotionalPrice?: number | null;
  @IsOptional() @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{2,19}$/, { message: 'Promo codes are 3–20 capital letters, digits, - or _' }) promoCode?: string | null;
  @IsOptional() @IsNumber() @Min(0.01) @Max(1000) minimumOrder?: number | null;
  @IsOptional() @IsNumber() @Min(0.01) @Max(1000) requiredSpend?: number | null;
  @IsOptional() @IsString() @MaxLength(80) freeItem?: string | null;
  @IsOptional() @IsBoolean() collectionEligible?: boolean | null;
  @IsOptional() @IsBoolean() deliveryEligible?: boolean | null;
  @IsOptional() @IsBoolean() newCustomersOnly?: boolean | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) applicableProducts?: string[] | null;
  @IsOptional() @IsArray() @IsIn(WEEKDAYS, { each: true }) eligibleWeekdays?: Weekday[] | null;
  @IsOptional() @Matches(TIME) dailyStartTime?: string | null;
  @IsOptional() @Matches(TIME) dailyEndTime?: string | null;
  @IsOptional() @Matches(DATE) startDate?: string | null;
  @IsOptional() @Matches(DATE) endDate?: string | null;
  @IsOptional() @IsArray() @ArrayMinSize(1) @IsString({ each: true }) branchPaths?: string[];
}

export class ApproveCandidateDto {
  @IsIn([OfferVerification.UNVERIFIED, OfferVerification.ADMIN_VERIFIED])
  verification: OfferVerification.UNVERIFIED | OfferVerification.ADMIN_VERIFIED;

  @IsOptional() @IsArray() @IsString({ each: true }) branchPaths?: string[];
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class MergeCandidateDto {
  @IsOptional() @IsMongoId() candidateId?: string;
  @IsOptional() @IsIn([OfferVerification.UNVERIFIED, OfferVerification.ADMIN_VERIFIED])
  verification?: OfferVerification.UNVERIFIED | OfferVerification.ADMIN_VERIFIED;
}

export class AttachBusinessDto {
  @IsString() @MaxLength(300) branchPath: string;
  @IsMongoId() businessId: string;
}

export class BlockSourceDto {
  @IsIn(['url', 'domain']) scope: 'url' | 'domain';
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

// ---------- policies and opt-outs ----------

export class DetectionDto {
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) hostSuffixes?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) cnameSuffixes?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(120, { each: true }) footerPatterns?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(120, { each: true }) generatorPatterns?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) assetHosts?: string[];
}

export class ProviderPolicyDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsEnum(ProviderPolicyStatus) status?: ProviderPolicyStatus;
  @IsOptional() @IsEnum(ProviderPolicyBasis) basis?: ProviderPolicyBasis | null;
  @IsOptional() @IsString() @MaxLength(200) agreementReference?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) basisNotes?: string | null;
  @IsOptional() @ValidateNested() @Type(() => DetectionDto) detection?: DetectionDto;
}

export class CreateOptOutDto {
  @IsString() @MinLength(3) @MaxLength(253) domain: string;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class ListOptOutsQuery {
  @IsOptional() @Transform(toBoolean) @IsBoolean() active?: boolean;
  @IsOptional() @Transform(toBoolean) @IsBoolean() unacknowledged?: boolean;
}

// ---------- jobs, settings, adapters ----------

export class ListJobsQuery extends PageQuery {
  @IsOptional() @IsEnum(ImportJobStatus) status?: ImportJobStatus;
  @IsOptional() @IsEnum(ImportJobType) type?: ImportJobType;
  @IsOptional() @IsString() @MaxLength(253) domain?: string;
}

export class UpdateSettingsDto {
  @IsOptional() @IsBoolean() aiExtractionEnabled?: boolean;
  @IsOptional() @IsInt() @Min(250) @Max(60_000) defaultRateLimitMs?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1000) defaultPageCap?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) extraNeverCrawlDomains?: string[];
}

// ---------- public and merchant ----------

export class RemovalRequestDto {
  @IsOptional() @IsMongoId() offerId?: string;
  @IsOptional() @IsString() @MaxLength(200) businessSlug?: string;
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(5) @MaxLength(1000) reason: string;
  @Equals(true, { message: 'Please confirm you are the business owner or authorised to act for it' }) declaration: boolean;
  // Honeypot: real people never fill this in.
  @IsOptional() @IsString() @MaxLength(200) website?: string;
}

export class MerchantRejectDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

// ---------- Phase 2: fingerprints, adapters, networks ----------

export class FingerprintMarkerDto {
  @IsEnum(MarkerCategory) category: MarkerCategory;
  @IsString() @MinLength(1) @MaxLength(120) value: string;
  @IsOptional() @IsNumber() @Min(0) @Max(10) weight?: number;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsBoolean() negative?: boolean;
}

export class ThresholdsDto {
  @IsInt() @Min(1) @Max(100) exact: number;
  @IsInt() @Min(1) @Max(100) high: number;
  @IsInt() @Min(1) @Max(100) possible: number;
}

export class CreateFingerprintDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(10) @IsMongoId({ each: true }) exampleWebsiteIds: string[];
  @IsOptional() @IsMongoId() providerId?: string;
}

export class UpdateFingerprintDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsMongoId() providerId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(400) @ValidateNested({ each: true }) @Type(() => FingerprintMarkerDto) markers?: FingerprintMarkerDto[];
  @IsOptional() @IsObject() categoryWeights?: Partial<Record<MarkerCategory, number>>;
  @IsOptional() @ValidateNested() @Type(() => ThresholdsDto) thresholds?: ThresholdsDto;
}

export class MatchFingerprintsDto {
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsMongoId({ each: true }) websiteIds?: string[];
  @IsOptional() @IsBoolean() allAuthorised?: boolean;
  @IsOptional() @IsBoolean() refetch?: boolean;
}

export class CreateAdapterDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsMongoId() fingerprintId: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsString({ each: true }) exampleDomains: string[];
  @IsObject() configuration: Record<string, unknown>;
}

export class UpdateAdapterVersionDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsString({ each: true }) exampleDomains?: string[];
  @IsOptional() @IsObject() configuration?: Record<string, unknown>;
}

export class RerunAdapterDto {
  @IsOptional() @IsString() @MaxLength(20) version?: string;
}

export class NetworkDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(2048, { each: true }) sitemapUrls?: string[];
  @IsOptional() @IsEnum(ProviderPolicyBasis) basis?: ProviderPolicyBasis;
  @IsOptional() @IsString() @MaxLength(200) agreementReference?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) basisNotes?: string | null;
  @IsOptional() @IsMongoId() providerId?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class NetworkWebsitesQuery extends PageQuery {
  @IsOptional() @IsMongoId() providerId?: string;
  @IsOptional() @IsString() @MaxLength(80) adapterKey?: string;
  @IsOptional() @IsMongoId() fingerprintId?: string;
  @IsOptional() @IsMongoId() networkId?: string;
  @IsOptional() @IsEnum(FingerprintMatchCategory) matchCategory?: FingerprintMatchCategory;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) minScore?: number;
  @IsOptional() @IsEnum(DomainAuthorisationStatus) status?: DomainAuthorisationStatus;
  @IsOptional() @IsDateString() checkedBefore?: string;
  @IsOptional() @Transform(toBoolean) @IsBoolean() hasErrors?: boolean;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['fingerprint', 'provider', 'adapter']) groupBy?: 'fingerprint' | 'provider' | 'adapter';
}

export class BulkWebsitesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsMongoId({ each: true }) websiteIds: string[];
  @IsIn(['authorise', 'run', 'pause', 'resume', 'opt_out', 'match_fingerprint']) action: 'authorise' | 'run' | 'pause' | 'resume' | 'opt_out' | 'match_fingerprint';
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

// ---------- imported offers and revisions (Phase 3) ----------

const IMPORTED_OFFER_STATES = ['possibly_removed', 'expiry_review', 'revision_pending', 'stale', 'source_changed'] as const;

export class ImportedOffersQuery extends PageQuery {
  @IsIn(IMPORTED_OFFER_STATES) state: (typeof IMPORTED_OFFER_STATES)[number];
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class ExpiryDecisionDto {
  @IsIn(['expire', 'restore']) decision: 'expire' | 'restore';
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ApplyRevisionDto {
  @IsIn([OfferVerification.UNVERIFIED, OfferVerification.ADMIN_VERIFIED])
  verification: OfferVerification.UNVERIFIED | OfferVerification.ADMIN_VERIFIED;

  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ListRevisionsQuery extends PageQuery {
  @IsOptional() @IsEnum(OfferRevisionStatus) status?: OfferRevisionStatus;
  @IsOptional() @IsMongoId() offerId?: string;
}

export class AdapterRecheckDto {
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsInt() @Min(1) @Max(24 * 30) recheckIntervalHours?: number | null;
}

export class OutreachQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class OutreachContactDto {
  @IsIn(['email', 'whatsapp', 'phone', 'post', 'in_person', 'other']) channel: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
