export interface Category {
  _id: string;
  name: string;
  slug: string;
  emoji?: string;
  businessCount: number;
}

export interface ReviewsCache {
  provider: string;
  rating: number;
  count: number;
}

// Where an imported offer or listing came from. Public pages show it with a removal link.
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

export interface Business {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  verificationStatus: string;
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
  openingHours?: Record<string, string>;
  logoUrl?: string;
  coverUrl?: string;
  photos: string[];
  reviews: ReviewsCache;
  followerCount: number;
  activeOfferCount: number;
  featured: boolean;
  distanceMiles?: number | null;
  sponsored?: boolean;
  location?: { type: string; coordinates: [number, number] }; // [lng, lat]
  imported?: ImportNotice | null;
}

export interface Offer {
  _id: string;
  businessId: string | Business;
  business?: Partial<Business> & { distanceMiles?: number | null };
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
  collection: boolean;
  delivery: boolean;
  startsAt?: string;
  endsAt?: string;
  maxRedemptions: number;
  redemptionCount: number;
  status: string;
  moderationNote?: string;
  impressions: number;
  flips: number;
  detailViews: number;
  orderClicks: number;
  createdAt: string;
  sponsored?: boolean;
  origin?: 'merchant' | 'scraper';
  verification?: 'unverified' | 'admin_verified' | 'merchant_verified';
  managedBy?: 'scraper_managed' | 'merchant_managed';
  sourceChanged?: boolean;
  sources?: OfferSource[];
  lastCheckedAt?: string;
  imported?: ImportNotice | null;
}

export interface Wallet {
  _id: string;
  businessId: string;
  balance: number;
  totalToppedUp: number;
  totalSpent: number;
}

export interface WalletTransaction {
  _id: string;
  type: 'topup' | 'spend' | 'refund';
  amount: number;
  note?: string;
  createdAt: string;
}

export interface Promotion {
  _id: string;
  businessId: string;
  offerId?: { _id: string; title: string; displayLabel: string } | string | null;
  dailyRate: number;
  status: 'active' | 'paused' | 'ended';
  startedAt: string;
  endedAt?: string;
  totalSpent: number;
}

export interface OfferCopy {
  title: string;
  description: string;
  terms: string;
  displayLabel: string;
}

export interface LocationStats {
  business: Business;
  stats: {
    impressions: number;
    flips: number;
    detailViews: number;
    orderClicks: number;
    redemptions: number;
    offerCount: number;
  };
}

export interface FranchiseStats {
  locations: LocationStats[];
  totals: {
    impressions: number;
    flips: number;
    detailViews: number;
    orderClicks: number;
    redemptions: number;
    offerCount: number;
    activeOffers: number;
    followers: number;
    locations: number;
  } | null;
}

export interface Plan {
  _id: string;
  key: string;
  name: string;
  audience: string;
  monthlyPrice: number;
  annualPrice: number;
  bestFor?: string;
  limits: Record<string, unknown>;
  features: string[];
  sortOrder: number;
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
