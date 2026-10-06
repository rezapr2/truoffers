export enum Role {
  CUSTOMER = 'customer',
  BUSINESS_OWNER = 'business_owner',
  BUSINESS_STAFF = 'business_staff',
  SUPPLIER = 'supplier',
  MODERATOR = 'moderator',
  ADMIN = 'admin',
  SUPER_ADMIN = 'super_admin',
  // Legacy staff roles from before the MVP spec. The migration turns support_admin into moderator and
  // sales_admin into admin; until then they keep the powers of the role they map to (see permissions.ts).
  SALES_ADMIN = 'sales_admin',
  SUPPORT_ADMIN = 'support_admin',
  FOODBELL_PARTNER = 'foodbell_partner',
}

// Everyone who works in the admin panel. Business owners and staff are never in here: their access is per business.
export const STAFF_ROLES: Role[] = [Role.MODERATOR, Role.ADMIN, Role.SUPER_ADMIN, Role.SALES_ADMIN, Role.SUPPORT_ADMIN];
export const ADMIN_ROLES = STAFF_ROLES;

export enum BusinessStatus {
  ACTIVE = 'active',
  // Added through "Add your business" and not verified yet: not public.
  PENDING = 'pending',
  SUSPENDED = 'suspended',
  CLOSED = 'closed',
  // Merged into another listing, or a rejected new business.
  ARCHIVED = 'archived',
}

/**
 * Spec "Takeaway verification": a takeaway shows exactly one status. 0 and 1 show "Not verified", 2 and 3 show
 * "✓ TruOffers verified". Only a moderator's approval reaches 2.
 */
export enum VerificationLevel {
  UNCLAIMED = 0,
  CLAIM_PENDING = 1,
  VERIFIED = 2,
  VERIFIED_PLUS = 3,
}

export const isVerifiedLevel = (level: number | undefined | null) => (level ?? 0) >= VerificationLevel.VERIFIED;

// Suppliers keep their own badge scheme (out of scope for the MVP).
export enum VerificationStatus {
  UNCLAIMED = 'unclaimed',
  CLAIMED = 'claimed',
  VERIFIED = 'verified',
  FOODBELL_VERIFIED = 'foodbell_verified',
  TRUSTED_PARTNER = 'trusted_partner',
  FRANCHISE_VERIFIED = 'franchise_verified',
}

export enum BusinessMemberRole {
  OWNER = 'owner',
  STAFF = 'staff',
}

export enum BusinessSource {
  OWNER = 'owner',
  ADMIN = 'admin',
  IMPORT = 'import',
}

// Kept for claims filed before the MVP verification flow.
export enum ClaimMethod {
  PHONE_OTP = 'phone_otp',
  EMAIL_DOMAIN = 'email_domain',
  GOOGLE_PROFILE_MATCH = 'google_profile_match',
  DOCUMENT_UPLOAD = 'document_upload',
  MANUAL_REVIEW = 'manual_review',
  FOODBELL_AUTO = 'foodbell_auto',
}

export enum ClaimKind {
  // Claim an existing listing
  EXISTING = 'existing',
  // "Add your business": the listing was created with the claim
  NEW = 'new',
  // Locked fields changed, or 12 months passed: the owner proves ownership again
  REVERIFICATION = 'reverification',
}

export enum ClaimStatus {
  // The owner is still proving the phone line and gathering evidence
  DRAFT = 'draft',
  // Submitted: waiting in the moderator queue
  PENDING = 'pending',
  INFO_REQUESTED = 'info_requested',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  // A second person passed the phone check on a listing that already has an owner
  DISPUTED = 'disputed',
  // No reply within 14 days of a request for more information
  EXPIRED = 'expired',
  WITHDRAWN = 'withdrawn',
}

export const OPEN_CLAIM_STATUSES: ClaimStatus[] = [
  ClaimStatus.DRAFT,
  ClaimStatus.PENDING,
  ClaimStatus.INFO_REQUESTED,
  ClaimStatus.DISPUTED,
];

export enum ClaimRejectReason {
  MISMATCH = 'mismatch',
  FAKE_DOCUMENT = 'fake_document',
  DUPLICATE = 'duplicate',
  NOT_A_TAKEAWAY = 'not_a_takeaway',
  OTHER = 'other',
}

export enum ClaimDocumentType {
  FOOD_REGISTRATION = 'food_registration',
  BUSINESS_RATES = 'business_rates',
  UTILITY_BILL = 'utility_bill',
  BANK_LETTER = 'bank_letter',
  SHOP_PHOTO = 'shop_photo',
  OTHER = 'other',
}

export enum OfferStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  // "Live" in the spec. Kept as `active` because the import robot and its tests use it.
  ACTIVE = 'active',
  // Approved, waiting for its start time
  SCHEDULED = 'scheduled',
  PAUSED = 'paused',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
  POSSIBLY_REMOVED = 'possibly_removed',
  EXPIRY_REVIEW = 'expiry_review',
  REVISION_PENDING = 'revision_pending',
  // Three reports from different people within the window: off the site until an admin decides
  HIDDEN_BY_REPORTS = 'hidden_by_reports',
  REMOVED = 'removed',
}

// Statuses a member of the public may see. A revision_pending offer stays visible as published until an
// admin applies or discards the revision (spec §9).
export const PUBLIC_OFFER_STATUSES: OfferStatus[] = [OfferStatus.ACTIVE, OfferStatus.REVISION_PENDING];

// Statuses in which an offer still occupies its dedupe slot (business + content fingerprint).
export const LIVE_OFFER_STATUSES: OfferStatus[] = [
  OfferStatus.DRAFT,
  OfferStatus.PENDING,
  OfferStatus.ACTIVE,
  OfferStatus.SCHEDULED,
  OfferStatus.PAUSED,
  OfferStatus.POSSIBLY_REMOVED,
  OfferStatus.EXPIRY_REVIEW,
  OfferStatus.REVISION_PENDING,
  OfferStatus.HIDDEN_BY_REPORTS,
];

// Offers that use up a plan's "live offers" allowance: published, about to be, or waiting for a moderator.
export const PLAN_COUNTED_OFFER_STATUSES: OfferStatus[] = [
  OfferStatus.ACTIVE,
  OfferStatus.SCHEDULED,
  OfferStatus.PENDING,
  OfferStatus.REVISION_PENDING,
  OfferStatus.HIDDEN_BY_REPORTS,
];

export enum OfferRejectReason {
  MISLEADING = 'misleading',
  BANNED_CONTENT = 'banned_content',
  LINK_MISMATCH = 'link_mismatch',
  DISCOUNT_TOO_HIGH = 'discount_too_high',
  DUPLICATE = 'duplicate',
  OTHER = 'other',
}

export enum DiscountType {
  PERCENT = 'percent',
  FIXED = 'fixed',
  FREE_DELIVERY = 'free_delivery',
  BOGOF = 'bogof',
  MEAL_DEAL = 'meal_deal',
  MULTI_BUY = 'multi_buy',
  FREE_ITEM = 'free_item',
  COLLECTION_DISCOUNT = 'collection_discount',
  DELIVERY_DISCOUNT = 'delivery_discount',
  CUSTOM = 'custom',
}

export enum RedemptionType {
  CODE = 'code',
  SHOW_IN_STORE = 'show_in_store',
  DIRECT_LINK = 'direct_link',
  PHONE = 'phone',
}

// Well-known plan keys. Plans are edited in /admin/plans, so any other key is valid too.
export enum PlanKey {
  FREE = 'free',
  STARTER = 'starter',
  STANDARD = 'standard',
  PROFESSIONAL = 'professional',
  PREMIUM = 'premium',
  ENTERPRISE = 'enterprise',
  SUPPLIER_FREE = 'supplier_free',
  SUPPLIER_PRO = 'supplier_pro',
  SUPPLIER_ELITE = 'supplier_elite',
}

export enum SubscriptionStatus {
  ACTIVE = 'active',
  TRIALING = 'trialing',
  PAST_DUE = 'past_due',
  CANCELLED = 'cancelled',
  // Checkout started on Stripe but not paid yet
  INCOMPLETE = 'incomplete',
}

// Subscriptions that still give the business its plan.
export const PLAN_GRANTING_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.PAST_DUE,
];

export enum PaymentStatus {
  PAID = 'paid',
  OPEN = 'open',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  PARTIALLY_REFUNDED = 'partially_refunded',
}

export enum PromotionPlacement {
  TOP_OF_SEARCH = 'top_of_search',
  CATEGORY_FEATURE = 'category_feature',
  FLASH_DEAL = 'flash_deal',
  HOMEPAGE_SPOT = 'homepage_spot',
}

export enum PromotionStatus {
  PENDING_PAYMENT = 'pending_payment',
  PENDING_APPROVAL = 'pending_approval',
  SCHEDULED = 'scheduled',
  ACTIVE = 'active',
  ENDED = 'ended',
  CANCELLED = 'cancelled',
  REJECTED = 'rejected',
  // Wallet-funded daily promotions from before the MVP; ended by the migration.
  PAUSED = 'paused',
}

// Bookings that hold a slot.
export const SLOT_HOLDING_PROMOTION_STATUSES: PromotionStatus[] = [
  PromotionStatus.PENDING_APPROVAL,
  PromotionStatus.SCHEDULED,
  PromotionStatus.ACTIVE,
];

export enum ReportReason {
  NOT_HONOURED = 'not_honoured',
  ENDED = 'ended',
  WRONG_TERMS = 'wrong_terms',
  CLOSED_OR_FAKE = 'closed_or_fake',
  MISLEADING = 'misleading',
  OTHER = 'other',
}

export enum ReportStatus {
  OPEN = 'open',
  INFO_REQUESTED = 'info_requested',
  UPHELD = 'upheld',
  REJECTED = 'rejected',
}

export enum LeadStatus {
  NEW = 'new',
  CONTACTED = 'contacted',
  QUALIFIED = 'qualified',
  WON = 'won',
  LOST = 'lost',
}
