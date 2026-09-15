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
  config: { rateLimitMs?: number; pageCap?: number; paused?: boolean; pausedReason?: string; blockedPaths?: string[] } | null;
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
  halted: boolean;
  workers: number;
}

export interface ScraperSettings {
  aiExtractionEnabled: boolean;
  aiAvailable: boolean;
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
