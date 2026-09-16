export enum OfferOrigin {
  MERCHANT = 'merchant',
  SCRAPER = 'scraper',
}

export enum OfferVerification {
  UNVERIFIED = 'unverified',
  ADMIN_VERIFIED = 'admin_verified',
  MERCHANT_VERIFIED = 'merchant_verified',
}

export enum OfferManagedBy {
  SCRAPER = 'scraper_managed',
  MERCHANT = 'merchant_managed',
}

export const OFFER_TYPES = [
  'percentage_discount',
  'fixed_discount',
  'buy_one_get_one_free',
  'multi_buy',
  'free_item',
  'free_delivery',
  'meal_deal',
  'collection_discount',
  'delivery_discount',
  'custom',
] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export enum ImportJobType {
  ANALYSE_SEED_WEBSITE = 'analyse_seed_website',
  DISCOVER_OFFER_PAGES = 'discover_offer_pages',
  EXTRACT_BUSINESS = 'extract_business',
  EXTRACT_OFFERS = 'extract_offers',
  MATCH_BUSINESS = 'match_business',
  DEDUPLICATE_OFFERS = 'deduplicate_offers',
  // Phase 2
  DISCOVER_AUTHORISED_DOMAINS = 'discover_authorised_domains',
  CREATE_FINGERPRINT = 'create_fingerprint',
  MATCH_FINGERPRINT = 'match_fingerprint',
  TEST_ADAPTER = 'test_adapter',
  // Phase 3
  // Last stage of every import run: applies the check to offers already published from the website.
  RECHECK_OFFER = 'recheck_offer',
  // Scheduled: expires imported offers whose end date has passed.
  REVIEW_STALE_OFFER = 'review_stale_offer',
}

// The stages of a website import run, in order. Every completed run is a check of the website.
export const IMPORT_RUN_STAGES = [
  ImportJobType.ANALYSE_SEED_WEBSITE,
  ImportJobType.DISCOVER_OFFER_PAGES,
  ImportJobType.EXTRACT_BUSINESS,
  ImportJobType.EXTRACT_OFFERS,
  ImportJobType.MATCH_BUSINESS,
  ImportJobType.DEDUPLICATE_OFFERS,
  ImportJobType.RECHECK_OFFER,
];

export enum ImportJobStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  DELAYED = 'delayed',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  DEAD_LETTERED = 'dead_lettered',
}

export const ACTIVE_IMPORT_JOB_STATUSES = [
  ImportJobStatus.QUEUED,
  ImportJobStatus.RUNNING,
  ImportJobStatus.DELAYED,
];

export enum CandidateStatus {
  PENDING_REVIEW = 'pending_review',
  AWAITING_MERCHANT_CONFIRMATION = 'awaiting_merchant_confirmation',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  MERGED = 'merged',
  NEEDS_REEXTRACTION = 'needs_reextraction',
  FAILED_EXTRACTION = 'failed_extraction',
}

// Candidates in these statuses still hold their dedupe slot.
export const OPEN_CANDIDATE_STATUSES = [
  CandidateStatus.PENDING_REVIEW,
  CandidateStatus.AWAITING_MERCHANT_CONFIRMATION,
  CandidateStatus.NEEDS_REEXTRACTION,
];

export enum ConfidenceBand {
  HIGH = 'high',
  REVIEW_RECOMMENDED = 'review_recommended',
  MANUAL_INVESTIGATION = 'manual_investigation',
  FAILED = 'failed',
}

export enum DuplicateKind {
  EXACT = 'exact',
  CHANGED_TERMS = 'changed_terms',
  REAPPEARED = 'reappeared',
  CONFLICT = 'conflict',
}

// Spec §9/§12: a change to a published imported offer found by a recheck, kept as revision history.
export enum OfferRevisionStatus {
  PENDING = 'pending',
  APPLIED = 'applied',
  DISCARDED = 'discarded',
  // Closed without a decision: the website went back to the published terms, or the offer expired or was removed.
  SUPERSEDED = 'superseded',
}

export enum DomainAuthorisationStatus {
  AUTHORISED = 'authorised',
  PENDING_AUTHORISATION = 'pending_authorisation',
  AWAITING_PROVIDER_REVIEW = 'awaiting_provider_review',
  OPTED_OUT = 'opted_out',
}

export enum AuthorisationSource {
  ADMIN_MANUAL = 'admin_manual',
  ADMIN_CSV = 'admin_csv',
  PROVIDER_CLIENT_LIST = 'provider_client_list',
  DISCOVERED_LINK = 'discovered_link',
  DISCOVERED_APPROVED = 'discovered_approved',
  // Listed in the sitemap of an authorised network (e.g. a provider's client directory).
  NETWORK_SITEMAP = 'network_sitemap',
}

export enum ProviderPolicyStatus {
  ALLOWED = 'allowed',
  BLOCKED = 'blocked',
  UNKNOWN = 'unknown',
}

export enum ProviderPolicyBasis {
  WRITTEN_AGREEMENT = 'written_agreement',
  TERMS_REVIEW = 'terms_review',
}

export enum OptOutSource {
  ADMIN = 'admin',
  PUBLIC_FORM = 'public_form',
}

export enum RobotsStatus {
  OK = 'ok',
  UNAVAILABLE = 'unavailable',
  UNREACHABLE = 'unreachable',
}

export enum BranchMatchStatus {
  AUTO_MATCHED = 'auto_matched',
  NEEDS_REVIEW = 'needs_review',
  NEW_BUSINESS_PROPOSED = 'new_business_proposed',
  CONFIRMED = 'confirmed',
  REJECTED = 'rejected',
}

// Branches whose business link is settled and can receive approved offers.
export const RESOLVED_BRANCH_STATUSES = [BranchMatchStatus.AUTO_MATCHED, BranchMatchStatus.CONFIRMED];

export enum ScraperAdapterType {
  BUILTIN_JSONLD = 'builtin_jsonld',
  BUILTIN_HTML = 'builtin_html',
  // Admin-built CSS selector configuration tied to a website fingerprint.
  SELECTOR = 'selector',
  // Code adapter written for one ordering provider's templates.
  PROVIDER = 'provider',
}

export enum ScraperAdapterStatus {
  // Code adapters (built-in, provider) run while active.
  ACTIVE = 'active',
  // Selector adapter lifecycle: draft -> testing -> approved; any runnable adapter can be paused;
  // a rolled-back version is withdrawn and never runs again.
  DRAFT = 'draft',
  TESTING = 'testing',
  APPROVED = 'approved',
  PAUSED = 'paused',
  WITHDRAWN = 'withdrawn',
}

export const RUNNABLE_ADAPTER_STATUSES = [ScraperAdapterStatus.ACTIVE, ScraperAdapterStatus.APPROVED, ScraperAdapterStatus.TESTING];

export enum MarkerCategory {
  GENERATOR = 'generator',
  FOOTER_ATTRIBUTION = 'footer_attribution',
  FRAMEWORK = 'framework',
  SCRIPT = 'script',
  STYLESHEET = 'stylesheet',
  ASSET_HOST = 'asset_host',
  CSS_CLASS = 'css_class',
  ELEMENT_ID = 'element_id',
  DOM_SKELETON = 'dom_skeleton',
  JSONLD_SHAPE = 'jsonld_shape',
  ROUTE_PATTERN = 'route_pattern',
  API_ENDPOINT = 'api_endpoint',
}

export enum FingerprintMatchCategory {
  EXACT = 'exact_match',
  HIGH_CONFIDENCE = 'high_confidence_match',
  POSSIBLE = 'possible_match',
  NONE = 'no_match',
}

export enum ActorKind {
  ADMIN = 'admin',
  MERCHANT = 'merchant',
  SYSTEM = 'system',
  PUBLIC = 'public',
}

export enum AuditAction {
  CANDIDATE_APPROVED = 'candidate.approved',
  CANDIDATE_REJECTED = 'candidate.rejected',
  CANDIDATE_EDITED = 'candidate.edited',
  CANDIDATE_MERGED = 'candidate.merged',
  CANDIDATE_BUSINESS_ATTACHED = 'candidate.business_attached',
  CANDIDATE_MERCHANT_CONFIRMATION_REQUESTED = 'candidate.merchant_confirmation_requested',
  CANDIDATE_REEXTRACTION_REQUESTED = 'candidate.reextraction_requested',
  CANDIDATE_SOURCE_BLOCKED = 'candidate.source_blocked',
  BRANCH_MATCH_DECIDED = 'branch.match_decided',
  BUSINESS_CREATED_FROM_IMPORT = 'business.created_from_import',
  WEBSITE_SUBMITTED = 'website.submitted',
  WEBSITE_AUTHORISED = 'website.authorised',
  WEBSITE_AUTHORISATION_DENIED = 'website.authorisation_denied',
  WEBSITE_PAUSED = 'website.paused',
  WEBSITE_RESUMED = 'website.resumed',
  PROVIDER_POLICY_CREATED = 'provider_policy.created',
  PROVIDER_POLICY_UPDATED = 'provider_policy.updated',
  PROVIDER_POLICY_DELETED = 'provider_policy.deleted',
  OPT_OUT_ADDED = 'opt_out.added',
  OPT_OUT_ACKNOWLEDGED = 'opt_out.acknowledged',
  OPT_OUT_LIFTED = 'opt_out.lifted',
  REMOVAL_REQUESTED = 'removal.requested',
  ADAPTER_PAUSED = 'adapter.paused',
  ADAPTER_RESUMED = 'adapter.resumed',
  EMERGENCY_STOP = 'queue.emergency_stop',
  QUEUE_RESUMED = 'queue.resumed',
  JOB_RETRIED = 'job.retried',
  JOB_CANCELLED = 'job.cancelled',
  RUN_CANCELLED = 'run.cancelled',
  SETTINGS_UPDATED = 'settings.updated',
  OFFER_MERCHANT_CONFIRMED = 'offer.merchant_confirmed',
  OFFER_REMOVED = 'offer.removed',
  // Phase 2
  FINGERPRINT_CREATED = 'fingerprint.created',
  FINGERPRINT_UPDATED = 'fingerprint.updated',
  FINGERPRINT_MATCH_REQUESTED = 'fingerprint.match_requested',
  ADAPTER_CREATED = 'adapter.created',
  ADAPTER_VERSION_CREATED = 'adapter.version_created',
  ADAPTER_UPDATED = 'adapter.updated',
  ADAPTER_TEST_REQUESTED = 'adapter.test_requested',
  ADAPTER_APPROVED = 'adapter.approved',
  ADAPTER_ROLLED_BACK = 'adapter.rolled_back',
  ADAPTER_RERUN_REQUESTED = 'adapter.rerun_requested',
  NETWORK_CREATED = 'network.created',
  NETWORK_UPDATED = 'network.updated',
  NETWORK_DISCOVERY_REQUESTED = 'network.discovery_requested',
  WEBSITES_BULK_ACTION = 'websites.bulk_action',
  // Phase 3
  REVISION_APPLIED = 'revision.applied',
  REVISION_DISCARDED = 'revision.discarded',
  OFFER_EXPIRY_DECIDED = 'offer.expiry_decided',
  WEBSITE_RECHECK_UPDATED = 'website.recheck_updated',
  CLAIM_INVITATION_CREATED = 'claim_invitation.created',
  CLAIM_INVITATION_REVOKED = 'claim_invitation.revoked',
  OUTREACH_CONTACT_RECORDED = 'outreach.contact_recorded',
}
