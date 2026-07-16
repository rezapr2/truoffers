'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { track } from '@/lib/analytics';
import type { Business, Offer } from '@/lib/types';
import VerifiedBadge from '@/components/VerifiedBadge';
import FollowButton from '@/components/FollowButton';
import OfferFlipCard from '@/components/OfferFlipCard';
import BusinessJsonLd from '@/components/BusinessJsonLd';
import ClaimBanner from './ClaimBanner';

interface MenuItem {
  _id: string;
  name: string;
  description?: string;
  price: number;
  section: string;
}

interface ProfileData {
  business: Business;
  offers: Offer[];
  menu: MenuItem[];
}

const TABS = ['Offers', 'Menu', 'Reviews', 'Info'] as const;

export default function BusinessProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [data, setData] = useState<ProfileData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Offers');

  useEffect(() => {
    api<ProfileData>(`/businesses/${slug}`)
      .then((d) => {
        setData(d);
        track('business_profile_view', { businessId: d.business._id });
      })
      .catch(() => setNotFound(true));
  }, [slug]);

  if (notFound) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-20 text-center">
        <h1 className="font-display text-3xl font-extrabold mb-3">Business not found</h1>
        <Link href="/takeaways" className="text-primary font-bold">Browse the directory →</Link>
      </div>
    );
  }
  if (!data) return <div className="py-24 text-center text-muted font-bold">Loading…</div>;

  const { business, offers, menu } = data;
  const cats = Array.isArray(business.categories)
    ? (business.categories as { name?: string }[]).map((c) => c?.name).filter(Boolean).join(' · ')
    : '';
  const sections = [...new Set(menu.map((m) => m.section))];
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${business.name} ${business.address ?? ''} ${business.postcode}`,
  )}`;

  return (
    <div className="mx-auto max-w-5xl px-5 md:px-10 py-8">
      <BusinessJsonLd business={business} offers={offers} />
      {/* Header */}
      <div className="bg-card rounded-3xl p-7 md:p-10 mb-5">
        <div className="flex flex-col md:flex-row gap-6 md:items-center">
          <div className="w-20 h-20 md:w-24 md:h-24 flex-none rounded-full bg-page flex items-center justify-center font-display font-extrabold text-3xl text-primary">
            {business.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="font-display text-2xl md:text-3xl font-extrabold tracking-tight">
                {business.name}
              </h1>
              <FollowButton businessId={business._id} />
            </div>
            <div className="text-sm font-semibold text-muted mt-1">
              {cats}
              {business.town ? ` · ${business.town} ${business.postcode}` : ''}
            </div>
            <div className="flex gap-3 mt-2 text-sm font-bold flex-wrap">
              {business.reviews?.rating > 0 && (
                <span className="text-star">
                  ★ {business.reviews.rating.toFixed(1)}
                  <span className="text-muted font-semibold"> ({business.reviews.count})</span>
                </span>
              )}
              <VerifiedBadge status={business.verificationStatus} />
              {business.followerCount > 0 && (
                <span className="text-muted">{business.followerCount} followers</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-3 mt-6 flex-wrap">
          {business.orderUrl && (
            <a
              href={business.orderUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track('order_click', { businessId: business._id })}
              className="bg-primary text-cream font-bold px-7 py-3.5 rounded-full hover:bg-primary-dark transition-colors"
            >
              Order online
            </a>
          )}
          {business.phone && (
            <a
              href={`tel:${business.phone}`}
              onClick={() => track('call_click', { businessId: business._id })}
              className="border-[1.5px] border-ink font-bold px-7 py-3.5 rounded-full hover:bg-ink hover:text-surface transition-colors"
            >
              Call
            </a>
          )}
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track('directions_click', { businessId: business._id })}
            className="border-[1.5px] border-ink font-bold px-7 py-3.5 rounded-full hover:bg-ink hover:text-surface transition-colors"
          >
            Directions
          </a>
        </div>
      </div>

      <ClaimBanner business={business} />

      {/* Tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-sm font-bold px-5 py-2.5 rounded-full transition-colors cursor-pointer ${
              tab === t ? 'bg-ink text-surface' : 'bg-card border border-line hover:border-primary'
            }`}
          >
            {t}
            {t === 'Offers' && offers.length > 0 ? ` · ${offers.length}` : ''}
          </button>
        ))}
      </div>

      {tab === 'Offers' && (
        <div className="grid sm:grid-cols-2 gap-4">
          {offers.map((o) => (
            <OfferFlipCard key={o._id} offer={{ ...o, business }} />
          ))}
          {offers.length === 0 && (
            <div className="bg-card rounded-2xl p-8 text-muted font-semibold sm:col-span-2 text-center">
              No live offers right now — follow to be notified when one drops.
            </div>
          )}
        </div>
      )}

      {tab === 'Menu' && (
        <div className="flex flex-col gap-6">
          {sections.map((section) => (
            <div key={section} className="bg-card rounded-2xl p-6">
              <h3 className="font-display text-lg font-extrabold mb-4">{section}</h3>
              <div className="flex flex-col gap-3">
                {menu
                  .filter((m) => m.section === section)
                  .map((item) => (
                    <div key={item._id} className="flex justify-between gap-4">
                      <div>
                        <div className="font-bold text-[15px]">{item.name}</div>
                        {item.description && (
                          <div className="text-[13px] text-muted font-semibold">{item.description}</div>
                        )}
                      </div>
                      <div className="font-extrabold text-[15px] whitespace-nowrap">
                        £{item.price.toFixed(2)}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ))}
          {menu.length === 0 && (
            <div className="bg-card rounded-2xl p-8 text-muted font-semibold text-center">
              Menu not added yet.
            </div>
          )}
        </div>
      )}

      {tab === 'Reviews' && (
        <div className="bg-card rounded-2xl p-8">
          {business.reviews?.rating > 0 ? (
            <div className="text-center">
              <div className="font-display text-5xl font-extrabold text-star mb-2">
                ★ {business.reviews.rating.toFixed(1)}
              </div>
              <div className="text-muted font-semibold">
                Based on {business.reviews.count} Google reviews
              </div>
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-5 border-[1.5px] border-ink font-bold px-6 py-3 rounded-full hover:bg-ink hover:text-surface transition-colors"
              >
                Read reviews on Google
              </a>
            </div>
          ) : (
            <div className="text-muted font-semibold text-center">No reviews synced yet.</div>
          )}
        </div>
      )}

      {tab === 'Info' && (
        <div className="bg-card rounded-2xl p-8 grid md:grid-cols-2 gap-8">
          <div>
            <h3 className="font-display text-lg font-extrabold mb-3">About</h3>
            <p className="text-[15px] font-semibold text-ink-soft leading-relaxed">
              {business.description || 'No description yet.'}
            </p>
            <h3 className="font-display text-lg font-extrabold mt-6 mb-3">Contact</h3>
            <dl className="text-[15px] font-semibold text-ink-soft space-y-1.5">
              {business.address && <div>{business.address}</div>}
              <div>{business.town} {business.postcode}</div>
              {business.phone && <div>{business.phone}</div>}
              {business.website && (
                <a href={business.website} className="text-primary block" target="_blank" rel="noopener noreferrer">
                  {business.website}
                </a>
              )}
            </dl>
          </div>
          <div>
            <h3 className="font-display text-lg font-extrabold mb-3">Opening hours</h3>
            {business.openingHours ? (
              <dl className="text-[15px] font-semibold text-ink-soft space-y-1.5">
                {Object.entries(business.openingHours).map(([day, hours]) => (
                  <div key={day} className="flex justify-between gap-6">
                    <dt className="capitalize">{day}</dt>
                    <dd>{hours || 'Closed'}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-muted font-semibold">Not provided yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
