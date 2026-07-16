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
