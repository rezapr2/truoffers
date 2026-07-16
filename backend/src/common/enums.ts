export enum Role {
  CUSTOMER = 'customer',
  BUSINESS_OWNER = 'business_owner',
  BUSINESS_STAFF = 'business_staff',
  SUPPLIER = 'supplier',
  SALES_ADMIN = 'sales_admin',
  SUPPORT_ADMIN = 'support_admin',
  SUPER_ADMIN = 'super_admin',
  FOODBELL_PARTNER = 'foodbell_partner',
}

export enum BusinessStatus {
  ACTIVE = 'active',
  PENDING = 'pending',
  SUSPENDED = 'suspended',
  CLOSED = 'closed',
}

export enum VerificationStatus {
  UNCLAIMED = 'unclaimed',
  CLAIMED = 'claimed',
  VERIFIED = 'verified',
  FOODBELL_VERIFIED = 'foodbell_verified',
  TRUSTED_PARTNER = 'trusted_partner',
  FRANCHISE_VERIFIED = 'franchise_verified',
}

export enum ClaimMethod {
  PHONE_OTP = 'phone_otp',
  EMAIL_DOMAIN = 'email_domain',
  GOOGLE_PROFILE_MATCH = 'google_profile_match',
  DOCUMENT_UPLOAD = 'document_upload',
  MANUAL_REVIEW = 'manual_review',
  FOODBELL_AUTO = 'foodbell_auto',
}

export enum ClaimStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum OfferStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  ACTIVE = 'active',
  PAUSED = 'paused',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
}

export enum DiscountType {
  PERCENT = 'percent',
  FIXED = 'fixed',
  FREE_DELIVERY = 'free_delivery',
  BOGOF = 'bogof',
  MEAL_DEAL = 'meal_deal',
}

export enum RedemptionType {
  CODE = 'code',
  SHOW_IN_STORE = 'show_in_store',
  DIRECT_LINK = 'direct_link',
  PHONE = 'phone',
}

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
  PAST_DUE = 'past_due',
  CANCELLED = 'cancelled',
  TRIALING = 'trialing',
}

export enum LeadStatus {
  NEW = 'new',
  CONTACTED = 'contacted',
  QUALIFIED = 'qualified',
  WON = 'won',
  LOST = 'lost',
}

export const ADMIN_ROLES = [Role.SALES_ADMIN, Role.SUPPORT_ADMIN, Role.SUPER_ADMIN];
