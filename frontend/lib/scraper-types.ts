// Shapes returned by the website import robot's admin API (/api/admin/scraper/*).

export type AuthorisationStatus = 'authorised' | 'pending_authorisation' | 'awaiting_provider_review' | 'opted_out';
export type CandidateStatus =
  | 'pending_review'
  | 'awaiting_merchant_confirmation'
  | 'approved'
  | 'rejected'
  | 'merged'
  | 'needs_reextraction'
  | 'failed_extraction';
export type ConfidenceBand = 'high' | 'review_recommended' | 'manual_investigation' | 'failed';
export type BranchMatchStatus = 'auto_matched' | 'needs_review' | 'new_business_proposed' | 'confirmed' | 'rejected';
export type JobStatus = 'queued' | 'running' | 'delayed' | 'completed' | 'failed' | 'cancelled' | 'dead_lettered';
export type PolicyStatus = 'allowed' | 'blocked' | 'unknown';

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}

export interface FieldEvidence {
  sourceUrl: string;
  text: string;
  method: string;
}

export interface SourceExcerpt {
  url: string;
  pageTitle?: string;
  excerpt: string;
  checkedAt: string;
}

export interface BusinessRef {
  _id: string;
  name: string;
  slug: string;
  postcode?: string;
  phone?: string;
  town?: string;
  verificationStatus?: string;
  ownerId?: string;
}

export interface MatchSuggestion {
  businessRef: BusinessRef | string | null;
  score: number;
  signals: string[];
}

export interface WebsiteBranch {
  branchPath: string;
  branchLabel?: string;
  businessRef?: BusinessRef | string | null;
  matchStatus: BranchMatchStatus;
  matchScore?: number;
  matchSignals: string[];
  suggestions: MatchSuggestion[];
  extracted?: {
    name?: string;
    telephone?: string;
    address?: string;
    postcode?: string;
    town?: string;
    website?: string;
    orderUrl?: string;
    sourceUrl?: string;
    evidence?: Record<string, FieldEvidence>;
  };
  decidedAt?: string;
}

export interface ProviderRef {
  _id: string;
  name: string;
  status: PolicyStatus;
  basis?: string;
  agreementReference?: string;
}

export interface ScrapedWebsite {
  _id: string;
  domain: string;
  seedUrl: string;
  authorisationStatus: AuthorisationStatus;
  authorisationSource: string;
  authorisationNote?: string;
  discoveredFrom?: string;
  providerRef?: ProviderRef | string | null;
  providerSignals: string[];
  adapterId?: string;
  adapterVersion?: string;
  robots?: { status?: string; crawlDelaySec?: number; fetchedAt?: string };
  businesses: WebsiteBranch[];
  lastSuccessfulCheckAt?: string;
  lastFailedCheckAt?: string;
  lastError?: string;
  failureCount: number;
  nextCheckAt?: string;
  updatedAt: string;
  createdAt: string;
}

export interface WebsiteListItem extends ScrapedWebsite {
  lastRun: { stage: string; status: JobStatus; stages: number; message?: string } | null;
  candidates: Partial<Record<CandidateStatus, number>>;
}

export interface ImportJob {
  _id: string;
  type: string;
  runId: string;
  domain?: string;
  normalisedUrl?: string;
  status: JobStatus;
  progress?: { current: number; total: number; message?: string };
  resultCounts?: Record<string, number>;
  logs?: { at: string; level: 'info' | 'warn' | 'error'; message: string; data?: Record<string, unknown> }[];
  errorLog?: { at: string; message: string; code?: string; attempt: number; retryable: boolean }[];
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  createdAt: string;
  submittedBy?: { name: string; email: string } | null;
  cancelReason?: string;
}

export interface WebsiteDetail {
  site: ScrapedWebsite;
  config: { rateLimitMs?: number; pageCap?: number; recheckIntervalHours?: number; paused?: boolean; pausedReason?: string; blockedPaths?: string[] } | null;
  candidates: Partial<Record<CandidateStatus, number>>;
  runs: { runId: string; stages: ImportJob[] }[];
}

export interface IntakeResult {
  input: string;
  domain?: string;
  outcome: 'queued' | 'already_running' | 'held' | 'rejected';
  message?: string;
  websiteId?: string;
  runId?: string;
}

export interface PendingBranch {
  websiteId: string;
  domain: string;
  branch: WebsiteBranch;
}

export const OFFER_FIELDS = [
  'title',
  'shortDescription',
  'terms',
  'offerType',
  'discountPercentage',
  'discountAmount',
  'originalPrice',
  'promotionalPrice',
  'promoCode',
  'minimumOrder',
  'requiredSpend',
  'freeItem',
  'collectionEligible',
  'deliveryEligible',
  'newCustomersOnly',
  'applicableProducts',
  'eligibleWeekdays',
  'dailyStartTime',
  'dailyEndTime',
  'startDate',
  'endDate',
] as const;
export type OfferField = (typeof OFFER_FIELDS)[number];

export interface Candidate extends Partial<Record<OfferField, unknown>> {
  _id: string;
  title: string;
  offerType: string;
  domain: string;
  branchPaths: string[];
  scrapedWebsiteRef: string;
  sources: SourceExcerpt[];
  evidence: Record<string, FieldEvidence>;
  extractionMethod: string;
  adapterId: string;
  adapterVersion: string;
  confidenceScore: number;
  confidenceBand: ConfidenceBand;
  confidenceSignals: { name: string; points: number }[];
  flags: string[];
  conflicts: string[];
  duplicate?: { kind: string; offerRef?: string; candidateRef?: string; diff?: Record<string, { previous: unknown; proposed: unknown }> };
  status: CandidateStatus;
  reviewNote?: string;
  reviewedAt?: string;
  edits: { field: string; before?: unknown; after?: unknown; editedAt: string }[];
  approvedOfferRefs: string[];
  lastCheckedAt: string;
  excerptsRedactedAt?: string;
  createdAt: string;
}

export interface CandidateList extends Paged<Candidate> {
  openByBand: Partial<Record<ConfidenceBand, number>>;
}

export interface AuditEntry {
  _id: string;
  actor: { kind: string; userId?: { name: string; email: string } | null; role?: string; component?: string; ip?: string };
  action: string;
  targetType: string;
  targetId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  note?: string;
  createdAt: string;
}

export interface CandidateDetail {
  candidate: Candidate;
  website: { _id: string; domain: string; seedUrl: string; authorisationStatus: AuthorisationStatus; adapterId?: string } | null;
  branches: WebsiteBranch[];
  canApprove: boolean;
  previous: {
    _id: string;
    title: string;
    displayLabel: string;
    discountType: string;
    value: number;
    code?: string;
    minOrder: number;
    terms?: string;
    startsAt?: string;
    endsAt?: string;
    status: string;
    verification?: string;
    managedBy?: string;
  } | null;
  approvedOffers: { _id: string; title: string; status: string; verification: string; managedBy: string; businessId: string }[];
  history: AuditEntry[];
}

export interface ProviderPolicy {
  _id: string;
  name: string;
  status: PolicyStatus;
  basis?: 'written_agreement' | 'terms_review';
  agreementReference?: string;
  basisNotes?: string;
  autoCreated?: boolean;
  detection: { hostSuffixes: string[]; cnameSuffixes: string[]; footerPatterns: string[]; generatorPatterns: string[]; assetHosts: string[] };
  reviewedAt?: string;
  websites: Partial<Record<AuthorisationStatus, number>>;
}

export interface OptOut {
  _id: string;
  domain: string;
  reason?: string;
  source: 'admin' | 'public_form';
  requestedBy?: { name?: string; email?: string };
  relatedListing?: { offerId?: string; businessId?: string };
  createdBy?: { name: string; email: string } | null;
  acknowledgedBy?: { name: string; email: string } | null;
  acknowledgedAt?: string;
  liftedBy?: { name: string; email: string } | null;
  liftedAt?: string;
  activeKey?: string;
  createdAt: string;
}

export interface QueueStatus {
  halted: boolean;
  paused: boolean;
  queues: Record<string, { waiting: number; active: number; delayed: number; failed: number; completed: number; paused: number }>;
  workers: { id: string; lastSeen: string | null }[];
  jobs: Partial<Record<JobStatus, number>>;
}

export interface ScraperOverview {
  candidatesAwaitingReview: number;
  openCandidatesByBand: Partial<Record<ConfidenceBand, number>>;
  domainsPendingAuthorisation: number;
  websitesAwaitingProviderReview: number;
  branchesAwaitingMatch: number;
  unacknowledgedRemovalRequests: number;
  importedOffers: Record<ImportedOfferState, number>;
  halted: boolean;
  workers: number;
}

export interface ScraperSettings {
  aiExtractionEnabled: boolean;
  aiAvailable: boolean;
  renderingEnabled?: boolean;
  renderWorkers: number;
  defaultRateLimitMs: number;
  defaultPageCap: number;
  extraNeverCrawlDomains: string[];
  updatedAt?: string;
}

export interface AdapterStats {
  _id: string;
  key: string;
  name: string;
  type: string;
  version: string;
  priority: number;
  status: 'active' | 'paused';
  pausedReason?: string;
  websites: number;
  candidates: Partial<Record<CandidateStatus, number>>;
  approvalRate: number | null;
}

// ---------- Phase 2: fingerprints, selector adapters, networks ----------

export type MarkerCategory =
  | 'generator'
  | 'footer_attribution'
  | 'framework'
  | 'script'
  | 'stylesheet'
  | 'asset_host'
  | 'css_class'
  | 'element_id'
  | 'dom_skeleton'
  | 'jsonld_shape'
  | 'route_pattern'
  | 'api_endpoint';

export type MatchCategory = 'exact_match' | 'high_confidence_match' | 'possible_match' | 'no_match';

export interface FingerprintMarker {
  category: MarkerCategory;
  value: string;
  weight: number;
  required: boolean;
  negative: boolean;
}

export interface Thresholds {
  exact: number;
  high: number;
  possible: number;
}

export interface FieldSelectorConfig {
  selector: string;
  source?: 'text' | 'attribute';
  attribute?: string;
  parser?: string;
}

export interface SelectorConfig {
  pages?: { offers?: string[]; business?: string[] };
  business?: { container?: string } & Partial<Record<'name' | 'telephone' | 'address' | 'postcode' | 'orderUrl', FieldSelectorConfig>>;
  offers: {
    container: string;
    fields: { title: FieldSelectorConfig } & Partial<Record<'description' | 'terms' | 'promoCode' | 'minimumOrder' | 'expiry' | 'orderUrl', FieldSelectorConfig>>;
  };
}

export interface Fingerprint {
  _id: string;
  name: string;
  key: string;
  version: number;
  active: boolean;
  providerRef?: { _id: string; name: string; status: PolicyStatus } | string | null;
  exampleDomains: string[];
  markers: FingerprintMarker[];
  categoryWeights: Partial<Record<MarkerCategory, number>>;
  thresholds: Thresholds;
  examples: { domain: string; pages: string[]; markers: number; offersFound: { title: string; excerpt: string; pageUrl: string }[]; error?: string }[];
  suggestedConfig?: { config: SelectorConfig | null; notes: string[] };
  analysedAt?: string;
  excerptsRedactedAt?: string;
  lastJobRef?: string;
  updatedAt: string;
  markerCount?: number;
  matches?: Partial<Record<MatchCategory, number>>;
  adapters?: { key: string; name: string; version: string; status: string }[];
}

export interface FingerprintDetail {
  fingerprint: Fingerprint;
  defaults: { categoryWeights: Record<MarkerCategory, number>; thresholds: Thresholds };
  matchedSites: { _id: string; domain: string; authorisationStatus: AuthorisationStatus; matchScore?: number; matchCategory?: MatchCategory; adapterId?: string; adapterVersion?: string }[];
  adapters: { _id: string; key: string; name: string; version: string; status: string; isCurrent: boolean }[];
}

export interface AdapterTestOffer {
  title: string;
  offerType: string;
  promoCode?: string;
  minimumOrder?: number;
  endDate?: string;
  pageUrl?: string;
  excerpt: string;
  fields: Record<string, { text: string; method: string }>;
  valid: boolean;
  errors: string[];
  flags: string[];
}

export interface AdapterTestResults {
  ranAt: string;
  jobId: string;
  summary: { domains: number; handled: number; offers: number };
  // Set once retention has removed page text from every domain below.
  redactedAt?: string;
  domains: {
    domain: string;
    canHandle: boolean;
    templateScore?: number;
    reasons: string[];
    pages?: string[];
    offers: AdapterTestOffer[];
    businesses: { branchPath: string; name?: string; telephone?: string; address?: string; postcode?: string }[];
    errors: string[];
    // The website opted out, or retention ended: excerpts, field text and branch details were removed.
    excerptsRedacted?: boolean;
  }[];
}

export interface AdapterVersion {
  _id: string;
  key: string;
  name: string;
  type: string;
  version: string;
  recheckIntervalHours?: number;
  status: 'active' | 'draft' | 'testing' | 'approved' | 'paused' | 'withdrawn';
  isCurrent: boolean;
  priority: number;
  fingerprintRef?: { _id: string; name: string; key: string } | string | null;
  exampleDomains: string[];
  configuration: SelectorConfig | Record<string, never>;
  testResults?: AdapterTestResults;
  testedAt?: string;
  lastTestJobRef?: string;
  basedOnVersion?: string;
  approvedAt?: string;
  approvedBy?: { name: string } | null;
  withdrawnAt?: string;
  withdrawnReason?: string;
  pausedReason?: string;
  createdAt: string;
  candidates?: Partial<Record<CandidateStatus, number>>;
  approvalRate?: number | null;
}

export interface AdapterListItem extends AdapterVersion {
  versions: number;
  latestVersion: string;
  websites: number;
}

export interface AdapterDetail {
  key: string;
  versions: AdapterVersion[];
  affectedWebsites: { _id: string; domain: string; adapterVersion?: string; authorisationStatus: AuthorisationStatus; lastSuccessfulCheckAt?: string; matchCategory?: MatchCategory; matchScore?: number }[];
}

export interface AuthorisedNetwork {
  _id: string;
  name: string;
  sitemapUrls: string[];
  basis: 'written_agreement' | 'terms_review';
  agreementReference?: string;
  basisNotes?: string;
  providerRef?: { _id: string; name: string; status: PolicyStatus } | null;
  active: boolean;
  lastDiscoveredAt?: string;
  domainsRegistered: number;
  websites: Partial<Record<AuthorisationStatus, number>>;
}

export interface NetworkWebsite {
  _id: string;
  domain: string;
  authorisationStatus: AuthorisationStatus;
  authorisationSource: string;
  providerRef?: { _id: string; name: string; status: PolicyStatus } | null;
  networkRef?: { _id: string; name: string } | null;
  fingerprintRef?: { _id: string; name: string; key: string } | null;
  matchScore?: number;
  matchCategory?: MatchCategory;
  fingerprintMatchedAt?: string;
  adapterId?: string;
  adapterVersion?: string;
  lastSuccessfulCheckAt?: string;
  lastError?: string;
  failureCount: number;
  paused: boolean;
}

export interface NetworkView extends Paged<NetworkWebsite> {
  groups: { key: string | null; count: number }[];
}

// ---------- rechecks, revisions and expiry (Phase 3) ----------

export type ImportedOfferState = 'possibly_removed' | 'expiry_review' | 'revision_pending' | 'stale' | 'source_changed';
export type RevisionStatus = 'pending' | 'applied' | 'discarded' | 'superseded';
export type RevisionValue = string | number | boolean | string[] | null;

export interface PendingRevisionSummary {
  _id: string;
  offerRef: string;
  changedFields: string[];
  lastDetectedAt: string;
  detectionCount: number;
}

export interface ImportedOfferRow {
  _id: string;
  title: string;
  displayLabel: string;
  status: string;
  sourceDomain?: string;
  lastCheckedAt?: string;
  lastSeenAt?: string;
  absentChecks: number;
  recheckStateAt?: string;
  endsAt?: string;
  verification: string;
  managedBy?: string;
  sourceChanged?: boolean;
  businessId?: { _id: string; name: string; slug: string; town?: string } | string;
  revision: PendingRevisionSummary | null;
}

export interface OfferRevision {
  _id: string;
  offerRef: string | { _id: string; title: string; status: string; sourceDomain?: string; verification?: string; managedBy?: string; endsAt?: string };
  businessRef?: { _id: string; name: string; slug: string } | string;
  domain?: string;
  status: RevisionStatus;
  previous: Record<string, RevisionValue>;
  proposedValues: Record<string, RevisionValue>;
  changedFields: string[];
  sources: SourceExcerpt[];
  evidence: Record<string, FieldEvidence>;
  firstDetectedAt: string;
  lastDetectedAt: string;
  detectionCount: number;
  reviewedBy?: { name?: string; email?: string } | string;
  reviewedAt?: string;
  reviewNote?: string;
  appliedVerification?: string;
  closedReason?: string;
  createdAt: string;
}

export interface ImportedOfferDetail {
  offer: ImportedOfferRow & {
    sources?: SourceExcerpt[];
    evidence?: Record<string, FieldEvidence>;
    value: number;
    minOrder: number;
    code?: string;
    terms?: string;
    adapterId?: string;
    adapterVersion?: string;
    confidenceScore?: number;
    scrapedWebsiteRef?: string;
  };
  business: { _id: string; name: string; slug: string; town?: string; ownerId?: string; verificationStatus?: string } | null;
  website: {
    _id: string;
    domain: string;
    authorisationStatus: string;
    adapterId?: string;
    adapterVersion?: string;
    nextCheckAt?: string;
    lastSuccessfulCheckAt?: string;
    lastFailedCheckAt?: string;
    lastError?: string;
    failureCount?: number;
  } | null;
  revisions: OfferRevision[];
}

// ---------- claim invitations and outreach (Phase 3) ----------

export interface ClaimInvitation {
  _id: string;
  businessRef: string;
  domain?: string;
  tokenHint: string;
  generatedBy?: { name?: string; email?: string } | string;
  expiresAt: string;
  claimedAt?: string;
  revokedAt?: string;
  contacts: { channel: string; at: string; note?: string }[];
  createdAt: string;
}

export interface OutreachCandidate {
  business: { _id: string; name: string; slug: string; town?: string; postcode?: string; phone?: string; website?: string };
  offers: number;
  offerTitles: string[];
  domain?: string;
  lastCheckedAt?: string;
  invitation: ClaimInvitation | null;
  invitationCount: number;
}

export interface InvitationPack {
  invitation: ClaimInvitation;
  claimUrl: string;
  qrCode: string;
  messages: { email: { subject: string; body: string }; whatsapp: string; phone: string };
}
