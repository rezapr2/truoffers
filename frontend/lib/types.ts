export interface Category {
  _id: string;
  name: string;
  slug: string;
  emoji?: string;
  businessCount: number;
  sortOrder?: number;
  seoText?: string;
  active?: boolean;
}

export interface ReviewsCache {
  provider: string;
  rating: number;
  count: number;
}

// Where an imported offer came from. Only the business's own dashboard and admins see it.
export interface ImportNotice {
  domain: string;
  lastCheckedAt?: string;
  verification?: 'unverified' | 'admin_verified' | 'merchant_verified';
  managedBy?: 'scraper_managed' | 'merchant_managed';
}

export interface OfferSource {
  url: string;
  pageTitle?: string;
  excerpt: string;
  checkedAt: string;
}

/** 0 unclaimed · 1 claim in review · 2 verified · 3 verified plus */
export type VerificationLevel = 0 | 1 | 2 | 3;
export type ClaimState = 'unclaimed' | 'in_review' | 'verified';
export type MemberRole = 'owner' | 'staff';

export interface BusinessMember {
  userId: string;
  role: MemberRole;
  addedAt?: string;
  primary?: boolean;
  name?: string;
  email?: string;
  lastLoginAt?: string;
}

export interface Business {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  verificationLevel: VerificationLevel;
  claimState?: ClaimState;
  verifiedAt?: string;
  trustScore: number;
  ownerId?: string;
  categories: Category[] | string[];
  address?: string;
  postcode: string;
  postcodeArea?: string;
  town?: string;
  phone?: string;
  email?: string;
  website?: string;
  orderUrl?: string;
  isFoodbellClient?: boolean;
  delivery?: boolean;
  collection?: boolean;
  openingHours?: Record<string, string>;
  socialLinks?: { facebook?: string; instagram?: string; tiktok?: string; x?: string };
  menuPdfUrl?: string;
  logoUrl?: string;
  coverUrl?: string;
  photos: string[];
  reviews: ReviewsCache;
  followerCount: number;
  activeOfferCount: number;
  featured: boolean;
  frozen?: boolean;
  fhrsRating?: string;
  distanceMiles?: number | null;
  location?: { type: string; coordinates: [number, number] }; // [lng, lat]
  myRole?: MemberRole;
  members?: BusinessMember[];
}

export type OfferStatus =
  | 'draft'
  | 'pending'
  | 'active'
  | 'scheduled'
  | 'paused'
  | 'rejected'
  | 'expired'
  | 'possibly_removed'
  | 'expiry_review'
  | 'revision_pending'
  | 'hidden_by_reports'
  | 'removed';

export interface Offer {
  _id: string;
  businessId: string | Business;
  business?: Partial<Business> & { distanceMiles?: number | null };
  slug?: string;
  title: string;
  description?: string;
  discountType: string;
  value: number;
  displayLabel: string;
  minOrder: number;
  redemptionType: string;
  code?: string;
  redemptionUrl?: string;
  terms?: string;
  imageUrl?: string;
  collection: boolean;
  delivery: boolean;
  newCustomersOnly?: boolean;
  startsAt?: string;
  endsAt?: string;
  eligibleWeekdays?: string[];
  dailyStartTime?: string;
  dailyEndTime?: string;
  maxRedemptions: number;
  redemptionCount: number;
  status: OfferStatus;
  moderationNote?: string;
  rejectReasonCode?: string;
  moderationFlags?: string[];
  submitWhenVerified?: boolean;
  publishedAt?: string;
  featured?: boolean;
  impressions: number;
  flips: number;
  detailViews: number;
  orderClicks: number;
  createdAt: string;
  updatedAt?: string;
  promoted?: boolean;
  origin?: 'merchant' | 'scraper';
  verification?: 'unverified' | 'admin_verified' | 'merchant_verified';
  managedBy?: 'scraper_managed' | 'merchant_managed';
  sourceChanged?: boolean;
  sources?: OfferSource[];
  lastCheckedAt?: string;
  imported?: ImportNotice | null;
}

// An imported offer hidden while a recheck confirms whether the takeaway still offers it.
export interface CheckingOffer {
  _id: string;
  availability: 'checking';
  business?: { _id: string; name: string; slug: string; town?: string };
}

export interface PlanLimits {
  maxLiveOffers: number;
  maxPhotos: number;
  maxBranches: number;
}

export interface PlanFlags {
  scheduledOffers: boolean;
  couponCodes: boolean;
  analytics: 'views' | 'full' | 'full_report';
  aiOfferWriter: boolean;
  qrCodes: boolean;
  rankingBoost: number;
  prioritySupport: boolean;
  freeTopOfSearchWeeksPerMonth: number;
}

export interface Plan {
  _id: string;
  key: string;
  name: string;
  audience: string;
  monthlyPrice: number;
  annualPrice: number;
  vatRatePercent?: number;
  pricesIncludeVat?: boolean;
  trialDays?: number;
  bestFor?: string;
  limits: PlanLimits;
  flags: PlanFlags;
  features: string[];
  autoApprove?: boolean;
  isPublic?: boolean;
  archived?: boolean;
  badgeText?: string;
  sortOrder: number;
  subscribers?: number;
  stripe?: { productId?: string; monthlyPriceId?: string; annualPriceId?: string; syncedAt?: string };
}

export interface Subscription {
  _id: string;
  businessId?: string | { _id: string; name: string; slug?: string };
  planKey: string;
  interval: 'monthly' | 'annual';
  price: number;
  status: 'active' | 'trialing' | 'past_due' | 'cancelled' | 'incomplete';
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  pendingPlanKey?: string;
  comp?: boolean;
  compNote?: string;
  stripeSubscriptionId?: string;
  pastDueSince?: string;
  createdAt?: string;
}

export interface Payment {
  _id: string;
  businessId?: string | { _id: string; name: string; slug?: string };
  kind: 'subscription' | 'promotion';
  description: string;
  amount: number;
  vat: number;
  total: number;
  refundedAmount: number;
  status: 'paid' | 'open' | 'failed' | 'refunded' | 'partially_refunded';
  number?: string;
  pdfUrl?: string;
  hostedUrl?: string;
  mock?: boolean;
  paidAt?: string;
  periodStart?: string;
  periodEnd?: string;
  createdAt: string;
}

export interface Supplier {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  category: string;
  serviceArea: string;
  verificationStatus: string;
  phone?: string;
  email?: string;
  website?: string;
  featured: boolean;
  leadCount: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
  postcode?: string;
  emailVerified?: boolean;
  twoFactorEnabled?: boolean;
  capabilities?: string[];
  impersonatedBy?: string;
  offerAlerts?: boolean;
  marketingEmails?: boolean;
  marketingSms?: boolean;
  favouriteCuisines: string[];
  savedOffers: string[];
  followedBusinesses: string[];
}

export interface SearchResult {
  offers: Offer[];
  businesses: Business[];
  searchedArea: string | null;
  count: number;
}

export interface Notification {
  _id: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  readAt?: string;
  createdAt: string;
}

export interface PromotionPrice {
  unit: 'day' | 'week' | 'deal';
  price: number;
  hours: number;
}

export interface PromotionProduct {
  _id: string;
  key: 'top_of_search' | 'category_feature' | 'flash_deal' | 'homepage_spot';
  name: string;
  description?: string;
  prices: PromotionPrice[];
  scope: 'area' | 'category_city' | 'site';
  slots: number;
  maxActivePerBusiness: number;
  approvalRequired: boolean;
  minVerificationLevel: number;
  active: boolean;
  sortOrder: number;
}

export interface PromotionBooking {
  _id: string;
  businessId: string | { _id: string; name: string; slug?: string; town?: string };
  offerId?: { _id: string; title: string; displayLabel?: string; status?: string } | string;
  productKey: PromotionProduct['key'];
  scope: { area?: string; categoryId?: { _id: string; name: string } | string; city?: string };
  startsAt: string;
  endsAt: string;
  unit: string;
  quantity: number;
  price: number;
  status: 'pending_payment' | 'pending_approval' | 'scheduled' | 'active' | 'ended' | 'cancelled' | 'rejected';
  source: 'purchase' | 'admin_grant' | 'plan_credit';
  note?: string;
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}
