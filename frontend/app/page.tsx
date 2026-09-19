import Link from 'next/link';
import { serverApi } from '@/lib/server-api';
import type { Category, Offer, Business } from '@/lib/types';
import PostcodeSearch from '@/components/PostcodeSearch';
import OfferRow from '@/components/OfferRow';
import BusinessCard from '@/components/BusinessCard';
import { OffersIcon, PricingIcon, ShieldIcon, StoreIcon } from '@/components/icons';

export default async function HomePage() {
  const [categories, offers, featured] = await Promise.all([
    serverApi<Category[]>('/categories'),
    serverApi<Offer[]>('/offers?limit=6'),
    serverApi<{ items: Business[] }>('/businesses?featured=true&limit=3'),
  ]);

  const heroOffers = (offers || []).slice(0, 3);
  const offsets = ['', 'ml-8', ''];

  return (
    <div className="mx-auto max-w-7xl">
      {/* Hero */}
      <section className="mx-5 md:mx-10 mt-3 md:mt-8 bg-gradient-to-br from-tint-blue via-surface to-card border border-line rounded-3xl px-6 py-10 md:px-14 md:py-16 grid md:grid-cols-[1.2fr_1fr] gap-10 md:gap-12 items-center">
        <div>
          <h1 className="font-display text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.1] mb-5">
            The deal comes first.
            <br />
            Then dinner.
          </h1>
          <p className="text-base md:text-lg text-muted-2 mb-8 leading-relaxed max-w-lg">
            Every live takeaway offer near you, in one search. Verified businesses, real reviews,
            direct ordering.
          </p>
          <PostcodeSearch />
        </div>
        <div className="hidden md:flex flex-col gap-3">
          {heroOffers.map((offer, i) => {
            const business =
              typeof offer.businessId === 'object' ? (offer.businessId as Partial<Business>) : {};
            return (
              <Link
                key={offer._id}
                href={`/offer/${offer._id}`}
                className={`bg-card text-ink border border-line shadow-sm rounded-2xl px-6 py-4 flex items-center gap-4 hover:shadow-lg transition-shadow ${offsets[i % 3]}`}
              >
                <span className="font-display text-2xl font-extrabold text-primary flex-none">
                  {offer.displayLabel}
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-extrabold truncate">
                    {business.name} →
                  </span>
                  <span className="block text-[13px] font-semibold text-muted truncate">
                    {offer.title} · {business.postcodeArea}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Stats strip */}
      <section className="mx-5 md:mx-10 mt-8 grid grid-cols-2 md:grid-cols-4 gap-y-6 border-y border-line py-6 md:divide-x md:divide-line">
        {[
          [StoreIcon, 'bg-tint-blue text-primary', '2,000+', 'takeaways listed'],
          [ShieldIcon, 'bg-tint-mint text-verified', '500+', 'verified businesses'],
          [PricingIcon, 'bg-tint-peach text-star', '£0', 'cost to customers'],
          [OffersIcon, 'bg-tint-lilac text-primary', '0%', 'commission taken'],
        ].map(([Icon, tint, num, label]) => {
          const StatIcon = Icon as typeof StoreIcon;
          return (
            <div key={label as string} className="flex items-center gap-4 md:px-7">
              <span className={`w-12 h-12 rounded-full flex items-center justify-center flex-none ${tint as string}`}>
                <StatIcon className="w-5 h-5" />
              </span>
              <div>
                <div className="text-[13px] text-muted">{label as string}</div>
                <div className="font-display text-2xl font-extrabold leading-tight">{num as string}</div>
              </div>
            </div>
          );
        })}
      </section>

      {/* Cuisines */}
      <section className="px-5 md:px-10 pt-10 pb-2">
        <h2 className="font-display text-2xl md:text-3xl font-extrabold tracking-tight mb-5">
          What are you craving?
        </h2>
        <div className="flex gap-2.5 flex-wrap">
          {(categories || []).map((cat, i) => (
            <Link
              key={cat._id}
              href={`/offers?category=${cat.slug}`}
              className={`text-[15px] font-bold px-5 py-3 rounded-full transition-colors ${
                i === 0
                  ? 'bg-tint-blue text-primary'
                  : 'bg-card border border-line text-ink hover:border-primary'
              }`}
            >
              {cat.name}
              {cat.businessCount > 0 ? ` · ${cat.businessCount}` : ''}
            </Link>
          ))}
        </div>
      </section>

      {/* Fresh offers */}
      <section className="px-5 md:px-10 py-12">
        <div className="flex items-baseline justify-between mb-5">
          <h2 className="font-display text-2xl md:text-3xl font-extrabold tracking-tight">
            Fresh offers near you
          </h2>
          <Link href="/offers" className="text-[15px] font-bold text-primary hover:text-primary-dark">
            All offers →
          </Link>
        </div>
        <div className="flex flex-col gap-3">
          {(offers || []).map((offer) => (
            <OfferRow key={offer._id} offer={offer} />
          ))}
          {(!offers || offers.length === 0) && (
            <div className="bg-card border border-line rounded-2xl p-8 text-center text-muted font-semibold">
              No live offers yet — start the API and run the seed script.
            </div>
          )}
        </div>
      </section>

      {/* Featured takeaways */}
      <section className="px-5 md:px-10 pb-12">
        <div className="flex items-baseline justify-between mb-5">
          <h2 className="font-display text-2xl md:text-3xl font-extrabold tracking-tight">
            Featured takeaways
          </h2>
          <Link href="/takeaways" className="text-[15px] font-bold text-primary hover:text-primary-dark">
            Browse all →
          </Link>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {(featured?.items || []).map((b) => (
            <BusinessCard key={b._id} business={b} />
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mx-5 md:mx-10 bg-surface rounded-3xl px-7 py-9 md:px-12 md:py-12">
        <h2 className="font-display text-2xl md:text-3xl font-extrabold tracking-tight mb-8">
          How it works
        </h2>
        <div className="grid md:grid-cols-3 gap-8 md:gap-10">
          {[
            ['1', 'Enter your postcode', 'Every takeaway near you, with live offers, menus and reviews.'],
            ['2', 'Follow your favourites', 'Get notified the moment they post a new offer.'],
            ['3', 'Order direct', 'Straight to the takeaway — no marketplace mark-ups.'],
          ].map(([n, title, body]) => (
            <div key={n} className="flex gap-4">
              <div className="w-11 h-11 flex-none rounded-full bg-tint-blue text-primary font-display font-extrabold text-lg flex items-center justify-center">{n}</div>
              <div>
                <div className="text-[17px] font-extrabold mb-1.5">{title}</div>
                <div className="text-sm text-muted font-semibold leading-relaxed">{body}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* App / follow banner */}
      <section className="mx-5 md:mx-10 mt-6 bg-gradient-to-br from-tint-blue to-card border border-line rounded-3xl px-7 py-9 md:px-12 md:py-10 flex flex-col md:flex-row items-start md:items-center gap-6 md:gap-10">
        <div className="flex-1">
          <h2 className="font-display text-2xl md:text-3xl font-extrabold tracking-tight mb-2">
            Never miss a deal
          </h2>
          <p className="text-[15px] text-muted-2">
            Follow your favourite takeaways — we&apos;ll notify you the moment they post a new offer.
          </p>
        </div>
        <div className="flex gap-3">
          <span className="btn-soft text-sm font-extrabold px-6 py-3 rounded-2xl">
            App Store
          </span>
          <span className="btn-soft text-sm font-extrabold px-6 py-3 rounded-2xl">
            Google Play
          </span>
        </div>
      </section>
    </div>
  );
}
