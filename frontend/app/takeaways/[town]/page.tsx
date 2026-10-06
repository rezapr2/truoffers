import Link from 'next/link';
import { cache } from 'react';
import { serverApi } from '@/lib/server-api';
import type { Business } from '@/lib/types';
import BusinessCard from '@/components/BusinessCard';
import HelpBody from '@/components/HelpBody';

// A city set up in Categories & cities has its own name, icon and SEO text; any other town still gets a page.
interface Area {
  name?: string;
  icon?: string;
  seoText?: string;
}

const loadArea = cache((slug: string) => serverApi<Area>(`/taxonomy/areas/${encodeURIComponent(slug)}`));

function titleOf(town: string, area: Area | null) {
  if (area?.name) return area.name;
  const name = decodeURIComponent(town);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export async function generateMetadata({ params }: { params: Promise<{ town: string }> }) {
  const { town } = await params;
  const title = titleOf(town, await loadArea(decodeURIComponent(town)));
  return {
    title: `Takeaways in ${title} — live offers | TruOffers`,
    description: `Find the best takeaway offers in ${title}. Verified businesses, real reviews and direct ordering.`,
  };
}

export default async function TownPage({ params }: { params: Promise<{ town: string }> }) {
  const { town } = await params;
  const name = decodeURIComponent(town);
  const [area, data] = await Promise.all([loadArea(name), serverApi<{ items: Business[]; total: number }>(`/businesses?town=${encodeURIComponent(townName(name))}&limit=48`)]);
  const title = titleOf(town, area);

  return (
    <div className="mx-auto max-w-7xl px-5 md:px-10 py-8">
      <nav className="text-sm font-bold text-muted mb-4">
        <Link href="/takeaways" className="hover:text-primary">
          Takeaways
        </Link>{' '}
        / {title}
      </nav>
      <h1 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight mb-2">
        {area?.icon ? `${area.icon} ` : ''}Takeaways in {title}
      </h1>
      <p className="text-muted font-semibold mb-8">
        {data?.total ?? 0} takeaway{(data?.total ?? 0) === 1 ? '' : 's'} with live offers, menus and reviews in {title}.
      </p>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(data?.items || []).map((b) => (
          <BusinessCard key={b._id} business={b} />
        ))}
      </div>
      {(!data || data.items.length === 0) && (
        <div className="bg-card border border-line rounded-2xl p-10 text-center text-muted font-semibold">
          No takeaways listed in {title} yet.{' '}
          <Link href="/claim-your-business" className="text-primary font-bold">
            Add your business →
          </Link>
        </div>
      )}
      {area?.seoText && (
        <section className="mt-14 bg-surface rounded-3xl px-6 py-8 md:px-10">
          <HelpBody body={area.seoText} />
        </section>
      )}
    </div>
  );
}

// Town names are matched case-insensitively by the API; slugs use hyphens for spaces.
function townName(slug: string) {
  return slug.replace(/-/g, ' ');
}
