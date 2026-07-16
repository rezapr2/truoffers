import type { Business, Offer } from '@/lib/types';

/**
 * schema.org structured data per blueprint §17.2 [S5]:
 * Restaurant + AggregateRating + Offer, rendered as JSON-LD.
 */
export default function BusinessJsonLd({
  business,
  offers,
}: {
  business: Business;
  offers: Offer[];
}) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://truoffers.co.uk';
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: business.name,
    url: `${siteUrl}/takeaway/${business.slug}`,
    servesCuisine: Array.isArray(business.categories)
      ? (business.categories as { name?: string }[]).map((c) => c?.name).filter(Boolean)
      : undefined,
    telephone: business.phone || undefined,
    address: {
      '@type': 'PostalAddress',
      streetAddress: business.address || undefined,
      addressLocality: business.town || undefined,
      postalCode: business.postcode,
      addressCountry: 'GB',
    },
    description: business.description || undefined,
  };

  if (business.reviews?.rating > 0 && business.reviews?.count > 0) {
    data.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: business.reviews.rating,
      reviewCount: business.reviews.count,
    };
  }

  if (offers.length > 0) {
    data.makesOffer = offers.map((o) => ({
      '@type': 'Offer',
      name: o.title,
      description: o.description || undefined,
      validThrough: o.endsAt || undefined,
      url: `${siteUrl}/offer/${o._id}`,
    }));
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
