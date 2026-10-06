import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { serverApi } from '@/lib/server-api';
import type { Business, CheckingOffer, Offer } from '@/lib/types';
import OfferDetail from './OfferDetail';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://truoffers.co.uk';

// generateMetadata and the page share one request.
const loadOffer = cache((id: string) => serverApi<Offer | CheckingOffer>(`/offers/${encodeURIComponent(id)}`));

const businessOf = (offer: Offer) => (typeof offer.businessId === 'object' ? (offer.businessId as Business) : null);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const offer = await loadOffer(id);
  if (!offer || 'availability' in offer) return { title: 'Offer', robots: { index: false } };
  const business = businessOf(offer);
  const title = `${offer.displayLabel} at ${business?.name ?? 'a local takeaway'}: ${offer.title}`;
  const description = [offer.description, business?.town ? `${business.name}, ${business.town}.` : undefined, 'Redeem it on TruOffers — no app or account needed.']
    .filter(Boolean)
    .join(' ')
    .slice(0, 300);
  const canonical = `/offer/${offer._id}${offer.slug ? `-${offer.slug}` : ''}`;
  const image = offer.imageUrl ? (offer.imageUrl.startsWith('/api/') ? `${SITE_URL}${offer.imageUrl}` : offer.imageUrl) : undefined;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { type: 'website', url: `${SITE_URL}${canonical}`, title, description, siteName: 'TruOffers', ...(image ? { images: [{ url: image }] } : {}) },
    twitter: { card: image ? 'summary_large_image' : 'summary', title, description },
  };
}

export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const offer = await loadOffer(id);
  if (!offer) notFound();

  // An imported offer the robot could not find on the business's website is hidden while it checks again.
  if ('availability' in offer) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-20 text-center">
        <h1 className="font-display text-3xl font-extrabold mb-3">We’re checking this offer</h1>
        <p className="text-muted font-semibold mb-6">It is hidden until we can confirm {offer.business?.name ?? 'the takeaway'} still runs it.</p>
        {offer.business?.slug && (
          <Link href={`/takeaway/${offer.business.slug}`} className="btn-soft font-bold px-6 py-3 rounded-2xl">
            See {offer.business.name}’s other offers
          </Link>
        )}
      </div>
    );
  }

  const business = businessOf(offer);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Offer',
    name: offer.title,
    description: offer.description ?? offer.terms,
    url: `${SITE_URL}/offer/${offer._id}${offer.slug ? `-${offer.slug}` : ''}`,
    ...(offer.endsAt ? { validThrough: offer.endsAt } : {}),
    ...(offer.startsAt ? { validFrom: offer.startsAt } : {}),
    offeredBy: business
      ? { '@type': 'Restaurant', name: business.name, address: { '@type': 'PostalAddress', streetAddress: business.address, addressLocality: business.town, postalCode: business.postcode, addressCountry: 'GB' } }
      : undefined,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <OfferDetail offer={offer} />
    </>
  );
}
