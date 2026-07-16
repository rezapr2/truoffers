import Link from 'next/link';
import { serverApi } from '@/lib/server-api';
import type { Business } from '@/lib/types';
import BusinessCard from '@/components/BusinessCard';

export async function generateMetadata({ params }: { params: Promise<{ town: string }> }) {
  const { town } = await params;
  const name = decodeURIComponent(town);
  const title = name.charAt(0).toUpperCase() + name.slice(1);
  return {
    title: `Takeaways in ${title} — live offers | TruOffers`,
    description: `Find the best takeaway offers in ${title}. Verified businesses, real reviews and direct ordering.`,
  };
}

export default async function TownPage({ params }: { params: Promise<{ town: string }> }) {
  const { town } = await params;
  const name = decodeURIComponent(town);
  const title = name.charAt(0).toUpperCase() + name.slice(1);

  const data = await serverApi<{ items: Business[]; total: number }>(
    `/businesses?town=${encodeURIComponent(name)}&limit=48`,
  );

  return (
    <div className="mx-auto max-w-7xl px-5 md:px-10 py-8">
      <nav className="text-sm font-bold text-muted mb-4">
        <Link href="/takeaways" className="hover:text-primary">Takeaways</Link> / {title}
      </nav>
      <h1 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight mb-2">
        Takeaways in {title}
      </h1>
      <p className="text-muted font-semibold mb-8">
        {data?.total ?? 0} takeaway{(data?.total ?? 0) === 1 ? '' : 's'} with live offers, menus and
        reviews in {title}.
      </p>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(data?.items || []).map((b) => (
          <BusinessCard key={b._id} business={b} />
        ))}
      </div>
      {(!data || data.items.length === 0) && (
        <div className="bg-card rounded-2xl p-10 text-center text-muted font-semibold">
          No takeaways listed in {title} yet.{' '}
          <Link href="/claim-your-business" className="text-primary font-bold">
            Add your business →
          </Link>
        </div>
      )}
    </div>
  );
}
