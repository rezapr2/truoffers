'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { track } from '@/lib/analytics';
import type { Category, SearchResult, Offer } from '@/lib/types';
import OfferFlipCard from '@/components/OfferFlipCard';
import BusinessCard from '@/components/BusinessCard';

function OffersPageInner() {
  const router = useRouter();
  const params = useSearchParams();

  const [postcode, setPostcode] = useState(params.get('postcode') || '');
  const [categories, setCategories] = useState<Category[]>([]);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [allOffers, setAllOffers] = useState<Offer[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeCategory = params.get('category') || '';
  const delivery = params.get('delivery') === 'true';
  const collection = params.get('collection') === 'true';
  const verifiedOnly = params.get('verifiedOnly') === 'true';
  const lat = params.get('lat');
  const lng = params.get('lng');
  const searchedPostcode = params.get('postcode');

  useEffect(() => {
    void api<Category[]>('/categories').then(setCategories).catch(() => {});
  }, []);

  const runSearch = useCallback(async () => {
    setError(null);
    // No location at all → show latest offers nationwide
    if (!searchedPostcode && !lat) {
      const offers = await api<Offer[]>('/offers?limit=40').catch(() => []);
      setAllOffers(offers);
      setResult(null);
      return;
    }
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (searchedPostcode) q.set('postcode', searchedPostcode);
      if (lat && lng) {
        q.set('lat', lat);
        q.set('lng', lng);
      }
      if (activeCategory) q.set('category', activeCategory);
      if (delivery) q.set('delivery', 'true');
      if (collection) q.set('collection', 'true');
      if (verifiedOnly) q.set('verifiedOnly', 'true');
      q.set('radiusKm', '30');
      const res = await api<SearchResult>(`/search/offers?${q.toString()}`);
      setResult(res);
      setAllOffers(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [searchedPostcode, lat, lng, activeCategory, delivery, collection, verifiedOnly]);

  useEffect(() => {
    void runSearch();
  }, [runSearch]);

  function updateParam(key: string, value: string | null) {
    const q = new URLSearchParams(params.toString());
    if (value) q.set(key, value);
    else q.delete(key);
    track('filter_apply', { metadata: { [key]: value } });
    router.push(`/offers?${q.toString()}`);
  }

  function submitPostcode(e: React.FormEvent) {
    e.preventDefault();
    if (!postcode.trim()) return;
    const q = new URLSearchParams(params.toString());
    q.set('postcode', postcode.trim());
    q.delete('lat');
    q.delete('lng');
    track('postcode_search', { postcodeArea: postcode.trim().split(' ')[0].toUpperCase() });
    router.push(`/offers?${q.toString()}`);
  }

  const offers = result ? result.offers : allOffers || [];
  const toggles: Array<[string, string, boolean]> = [
    ['delivery', 'Delivery', delivery],
    ['collection', 'Collection', collection],
    ['verifiedOnly', 'Verified only', verifiedOnly],
  ];

  return (
    <div className="mx-auto max-w-7xl px-5 md:px-10 py-8">
      <h1 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight mb-6">
        {result?.searchedArea
          ? `Offers near ${result.searchedArea}`
          : lat
            ? 'Offers near you'
            : 'All live offers'}
      </h1>

      {/* Search bar */}
      <form
        onSubmit={submitPostcode}
        className="flex gap-2 bg-card border border-line rounded-full p-1.5 pl-6 max-w-xl items-center mb-5"
      >
        <span className="w-2.5 h-2.5 border-[2.5px] border-primary rounded-full flex-none" />
        <input
          value={postcode}
          onChange={(e) => setPostcode(e.target.value)}
          placeholder="Your postcode — e.g. M14 5TQ"
          className="flex-1 min-w-0 border-none outline-none text-base font-bold text-ink bg-transparent"
        />
        <button
          type="submit"
          className="bg-ink text-cream text-[15px] font-bold px-6 py-3 rounded-full cursor-pointer hover:bg-primary transition-colors"
        >
          Search
        </button>
      </form>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap mb-8">
        <button
          onClick={() => updateParam('category', null)}
          className={`text-sm font-bold px-4 py-2.5 rounded-full transition-colors cursor-pointer ${
            !activeCategory ? 'bg-ink text-surface' : 'bg-card border border-line hover:border-primary'
          }`}
        >
          All cuisines
        </button>
        {categories.map((cat) => (
          <button
            key={cat._id}
            onClick={() => updateParam('category', activeCategory === cat.slug ? null : cat.slug)}
            className={`text-sm font-bold px-4 py-2.5 rounded-full transition-colors cursor-pointer ${
              activeCategory === cat.slug
                ? 'bg-ink text-surface'
                : 'bg-card border border-line hover:border-primary'
            }`}
          >
            {cat.name}
          </button>
        ))}
        <span className="w-px bg-line mx-1 hidden md:block" />
        {toggles.map(([key, label, active]) => (
          <button
            key={key}
            onClick={() => updateParam(key, active ? null : 'true')}
            className={`text-sm font-bold px-4 py-2.5 rounded-full transition-colors cursor-pointer ${
              active ? 'bg-primary text-cream' : 'bg-card border border-line hover:border-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-peach-2/40 border border-primary/30 text-primary-dark font-bold rounded-2xl px-6 py-4 mb-6">
          {error}
        </div>
      )}
      {loading && <div className="text-muted font-bold py-10 text-center">Searching…</div>}

      {/* Offer cards */}
      {!loading && (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {offers.map((offer) => (
              <OfferFlipCard key={offer._id} offer={offer} />
            ))}
          </div>
          {offers.length === 0 && !error && (
            <div className="bg-card rounded-2xl p-10 text-center text-muted font-semibold">
              No offers found{result?.searchedArea ? ` near ${result.searchedArea}` : ''}. Try a wider
              search or different filters.
            </div>
          )}
        </>
      )}

      {/* Nearby businesses */}
      {result && result.businesses.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-2xl font-extrabold tracking-tight mb-5">
            Takeaways in this area
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {result.businesses.map((b) => (
              <BusinessCard key={b._id} business={b} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default function OffersPage() {
  return (
    <Suspense>
      <OffersPageInner />
    </Suspense>
  );
}
