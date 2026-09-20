import Link from 'next/link';
import { serverApi } from '@/lib/server-api';
import type { Category, Offer, Business } from '@/lib/types';
import PostcodeSearch from '@/components/PostcodeSearch';
import OfferCard from '@/components/OfferCard';
import FlashDealCard from '@/components/FlashDealCard';
import PromoBanner, { type BannerTone } from '@/components/PromoBanner';
import CategoryExplorer from '@/components/CategoryExplorer';
import BusinessCard from '@/components/BusinessCard';
import { OffersIcon, PricingIcon, ShieldIcon, StoreIcon } from '@/components/icons';

type BusinessPage = { items: Business[]; total: number };

// The three colour blocks under the hero, in the order the reference lays them out
const BANNERS: { tone: BannerTone; kicker: string }[] = [
  { tone: 'sun', kicker: 'Irresistibly tasty' },
  { tone: 'tomato', kicker: 'Limited time offers' },
  { tone: 'leaf', kicker: 'Super delicious' },
];

export default async function HomePage() {
  const [categories, offers, featured, all, verified] = await Promise.all([
    serverApi<Category[]>('/categories'),
    serverApi<Offer[]>('/offers?limit=12'),
    serverApi<BusinessPage>('/businesses?featured=true&limit=3'),
    serverApi<BusinessPage>('/businesses?limit=1'),
    serverApi<BusinessPage>('/businesses?limit=1&verified=true'),
  ]);

  const cuisines = categories || [];
  const liveOffers = offers || [];
  const featuredBusinesses = featured?.items || [];

  // Limited-run offers head up the flash-deal block; the rest are the top picks
  const flashDeals = liveOffers.filter((o) => o.endsAt || o.maxRedemptions > 0).slice(0, 5);
  const flashIds = new Set(flashDeals.map((o) => o._id));
  const topPicks = liveOffers.filter((o) => !flashIds.has(o._id)).slice(0, 8);

  const bannerCategories = cuisines.filter((c) => c.businessCount > 0).slice(0, 3);
  const topRated = featuredBusinesses.find((b) => b.reviews?.rating > 0);

  const stats: [typeof StoreIcon, string, string, string][] = [
    [StoreIcon, 'bg-tint-blue text-primary', String(all?.total ?? 0), 'takeaways listed'],
    [ShieldIcon, 'bg-tint-mint text-verified', String(verified?.total ?? 0), 'verified businesses'],
    [PricingIcon, 'bg-tint-peach text-star', '£0', 'cost to customers'],
    [OffersIcon, 'bg-sun-soft text-brand', '0%', 'commission taken'],
  ];

  return (
    <div>
      {/* ---------------- Hero ---------------- */}
      <section className="bg-brand-deep hero-pattern text-white rounded-b-[2rem] md:rounded-b-[3rem]">
        <div className="mx-auto max-w-7xl px-5 md:px-10 pt-10 md:pt-14 pb-20 md:pb-28 grid md:grid-cols-[1.05fr_0.95fr] gap-8 items-center">
          <div>
            <h1 className="font-display text-[40px] leading-[1.06] md:text-[58px] font-extrabold tracking-tight mb-5">
              Delicious deals
              <br />
              at your doorstep
            </h1>
            <p className="text-[15px] md:text-base text-leaf-soft/85 mb-8 leading-relaxed max-w-md">
              Every live takeaway offer near you, in one search. Verified businesses, real reviews
              and ordering direct — no marketplace mark-ups.
            </p>
            <PostcodeSearch tone="dark" />
          </div>

          {/* Decorative: a plate of the cuisines currently listed */}
          <div className="relative hidden md:block h-[380px]" aria-hidden="true">
            <div className="plate absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] rounded-full flex items-center justify-center">
              <div className="grid grid-cols-2 gap-2 text-[58px] leading-none select-none">
                {cuisines.slice(0, 4).map((c) => (
                  <span key={c._id}>{c.emoji || '🍽️'}</span>
                ))}
              </div>
            </div>

            {topRated && (
              <div className="absolute top-4 right-0 bg-card text-ink rounded-2xl shadow-lg px-4 py-3 max-w-[210px]">
                <div className="text-star text-[13px] tracking-[-1px]">★★★★★</div>
                <div className="text-[13px] font-extrabold mt-0.5 truncate">{topRated.name}</div>
                <div className="text-[11.5px] font-bold text-muted">
                  {topRated.reviews.rating.toFixed(1)} from {topRated.reviews.count} reviews
                </div>
              </div>
            )}

            <div className="absolute bottom-6 left-0 bg-card text-ink rounded-2xl shadow-lg px-4 py-3 flex items-center gap-3">
              <span className="flex -space-x-2">
                {featuredBusinesses.slice(0, 3).map((b) => (
                  <span
                    key={b._id}
                    className="w-8 h-8 rounded-full bg-sun-soft border-2 border-white flex items-center justify-center font-display font-extrabold text-[13px] text-brand-deep"
                  >
                    {b.name.charAt(0)}
                  </span>
                ))}
              </span>
              <span className="text-[12px] font-extrabold leading-tight">
                {all?.total ?? 0} takeaways
                <span className="block text-muted font-bold">listed and live</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Stats, overlapping the hero ---------------- */}
      <section className="mx-5 md:mx-10 -mt-12 relative z-10">
        <div className="mx-auto max-w-7xl bg-card border border-line shadow-lg rounded-3xl px-6 py-6 md:px-8 grid grid-cols-2 md:grid-cols-4 gap-y-6 md:divide-x md:divide-line">
          {stats.map(([Icon, tint, num, label]) => (
            <div key={label} className="flex items-center gap-3.5 md:px-6 md:first:pl-0">
              <span className={`w-11 h-11 rounded-full flex items-center justify-center flex-none ${tint}`}>
                <Icon className="w-5 h-5" />
              </span>
              <div>
                <div className="font-display text-[22px] font-extrabold leading-tight">{num}</div>
                <div className="text-[12.5px] text-muted">{label}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="mx-auto max-w-7xl">
        {/* ---------------- Cuisine promos ---------------- */}
        {bannerCategories.length > 0 && (
          <section className="px-5 md:px-10 pt-12 md:pt-16">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="grid gap-4 content-start">
                <PromoBanner
                  category={bannerCategories[0]}
                  tone={BANNERS[0].tone}
                  kicker={BANNERS[0].kicker}
                />
                {bannerCategories[2] && (
                  <PromoBanner
                    category={bannerCategories[2]}
                    tone={BANNERS[2].tone}
                    kicker={BANNERS[2].kicker}
                  />
                )}
              </div>
              {bannerCategories[1] && (
                <PromoBanner
                  category={bannerCategories[1]}
                  tone={BANNERS[1].tone}
                  kicker={BANNERS[1].kicker}
                  size="lg"
                />
              )}
            </div>
          </section>
        )}

        {/* ---------------- Top picks ---------------- */}
        <section className="px-5 md:px-10 py-12 md:py-16">
          <div className="text-center mb-8">
            <h2 className="font-display text-2xl md:text-[34px] font-extrabold tracking-tight">
              Our top picks
            </h2>
            <p className="text-[14px] text-muted mt-2">
              A taste of what takeaways near you are running right now.
            </p>
          </div>
          {topPicks.length > 0 ? (
            <div
              className={`grid grid-cols-1 sm:grid-cols-2 gap-4 mx-auto ${
                topPicks.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3 max-w-5xl'
              }`}
            >
              {topPicks.map((offer, i) => (
                <OfferCard key={offer._id} offer={offer} index={i} />
              ))}
            </div>
          ) : (
            <div className="bg-surface rounded-3xl p-10 text-center text-muted font-semibold">
              No live offers yet — start the API and run the seed script.
            </div>
          )}
          <div className="flex justify-center mt-9">
            <Link
              href="/offers"
              className="btn-soft text-[13px] font-extrabold px-7 py-3.5 rounded-full"
            >
              See all offers
            </Link>
          </div>
        </section>

        {/* ---------------- Cuisines ---------------- */}
        {cuisines.length > 0 && <CategoryExplorer categories={cuisines} />}

        {/* ---------------- Flash deals ---------------- */}
        {flashDeals.length > 0 && (
          <section className="px-5 md:px-10 py-12 md:py-16">
            <h2 className="font-display text-2xl md:text-[34px] font-extrabold tracking-tight text-center mb-8">
              Flash deals: ending soon!
            </h2>
            {flashDeals.length >= 4 ? (
              // The reference layout: a tall card in the middle, small ones either side
              <div className="grid lg:grid-cols-3 gap-4 items-stretch">
                <div className="flex flex-col gap-4 order-2 lg:order-1">
                  {flashDeals.slice(1, 3).map((offer) => (
                    <FlashDealCard key={offer._id} offer={offer} />
                  ))}
                </div>
                <div className="order-1 lg:order-2">
                  <FlashDealCard offer={flashDeals[0]} featured />
                </div>
                <div className="flex flex-col gap-4 order-3">
                  {flashDeals.slice(3, 5).map((offer) => (
                    <FlashDealCard key={offer._id} offer={offer} />
                  ))}
                </div>
              </div>
            ) : (
              // Too few to flank: centre them instead of leaving columns empty
              <div
                className={`grid gap-4 mx-auto ${
                  flashDeals.length === 1 ? 'max-w-sm' : 'md:grid-cols-3 max-w-5xl'
                }`}
              >
                {flashDeals.map((offer, i) => (
                  <FlashDealCard key={offer._id} offer={offer} featured={flashDeals.length === 1 || i === 0} />
                ))}
              </div>
            )}
          </section>
        )}

        {/* ---------------- Featured takeaways ---------------- */}
        {featuredBusinesses.length > 0 && (
          <section className="px-5 md:px-10 pb-12 md:pb-16">
            <div className="flex items-baseline justify-between mb-6">
              <h2 className="font-display text-2xl md:text-[30px] font-extrabold tracking-tight">
                Featured takeaways
              </h2>
              <Link href="/takeaways" className="text-[14px] font-extrabold text-primary hover:text-primary-dark">
                Browse all →
              </Link>
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              {featuredBusinesses.map((b) => (
                <BusinessCard key={b._id} business={b} />
              ))}
            </div>
          </section>
        )}

        {/* ---------------- How it works ---------------- */}
        <section className="mx-5 md:mx-10 bg-surface rounded-[2rem] px-7 py-10 md:px-12 md:py-14">
          <h2 className="font-display text-2xl md:text-[30px] font-extrabold tracking-tight mb-9 text-center">
            How it works
          </h2>
          <div className="grid md:grid-cols-3 gap-8 md:gap-10">
            {[
              ['1', 'Enter your postcode', 'Every takeaway near you, with live offers, menus and reviews.'],
              ['2', 'Follow your favourites', 'Get notified the moment they post a new offer.'],
              ['3', 'Order direct', 'Straight to the takeaway — no marketplace mark-ups.'],
            ].map(([n, title, body]) => (
              <div key={n} className="flex gap-4">
                <div className="w-11 h-11 flex-none rounded-full bg-brand text-white font-display font-extrabold text-lg flex items-center justify-center">
                  {n}
                </div>
                <div>
                  <div className="text-[16px] font-extrabold mb-1.5">{title}</div>
                  <div className="text-[13.5px] text-muted font-semibold leading-relaxed">{body}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------- Follow banner ---------------- */}
        <section className="mx-5 md:mx-10 mt-6 mb-4 bg-brand-deep hero-pattern text-white rounded-[2rem] px-7 py-10 md:px-12 md:py-12 flex flex-col md:flex-row items-start md:items-center gap-6 md:gap-10">
          <div className="flex-1">
            <h2 className="font-display text-2xl md:text-[30px] font-extrabold tracking-tight mb-2">
              Never miss a deal
            </h2>
            <p className="text-[14.5px] text-leaf-soft/85 leading-relaxed">
              Follow your favourite takeaways — we&apos;ll notify you the moment they post a new
              offer.
            </p>
          </div>
          <div className="flex gap-3 flex-wrap">
            <Link href="/register" className="btn-sun text-[13px] font-extrabold px-6 py-3.5 rounded-full">
              Create a free account
            </Link>
            <Link
              href="/takeaways"
              className="border-[1.5px] border-white/40 text-white text-[13px] font-extrabold px-6 py-3.5 rounded-full hover:bg-white hover:text-brand-deep transition-colors"
            >
              Browse takeaways
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
