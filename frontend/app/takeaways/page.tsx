import Link from 'next/link';
import { serverApi } from '@/lib/server-api';
import type { Business } from '@/lib/types';
import BusinessCard from '@/components/BusinessCard';
import PageHero from '@/components/PageHero';

export const metadata = {
  title: 'Takeaway directory — TruOffers',
  description: 'Browse verified takeaways across the UK with live offers, menus and reviews.',
};

export default async function TakeawaysPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q, page } = await searchParams;
  const query = new URLSearchParams();
  if (q) query.set('q', q);
  if (page) query.set('page', page);
  query.set('limit', '24');

  const [data, towns] = await Promise.all([
    serverApi<{ items: Business[]; total: number; page: number; pages: number }>(
      `/businesses?${query.toString()}`,
    ),
    serverApi<{ town: string; count: number }[]>('/businesses/towns'),
  ]);

  return (
    <div>
      <PageHero
        title="Takeaway directory"
        subtitle={`${data?.total ?? 0} takeaways listed — verified profiles, live offers and ordering direct.`}
      >
        {/* Towns */}
        <div className="flex gap-2.5 flex-wrap">
          {(towns || []).map((t) => (
            <Link
              key={t.town}
              href={`/takeaways/${encodeURIComponent(t.town.toLowerCase())}`}
              className="bg-white/12 text-white text-sm font-bold px-4 py-2.5 rounded-full hover:bg-white hover:text-brand-deep transition-colors"
            >
              {t.town} · {t.count}
            </Link>
          ))}
        </div>
      </PageHero>

      <div className="mx-auto max-w-7xl px-5 md:px-10 py-10 grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(data?.items || []).map((b) => (
          <BusinessCard key={b._id} business={b} />
        ))}
      </div>

      {data && data.pages > 1 && (
        <div className="flex gap-2 justify-center pb-10">
          {Array.from({ length: data.pages }, (_, i) => (
            <Link
              key={i}
              href={`/takeaways?page=${i + 1}${q ? `&q=${q}` : ''}`}
              className={`w-10 h-10 flex items-center justify-center rounded-full font-bold text-sm ${
                data.page === i + 1 ? 'bg-tint-blue text-primary' : 'bg-card border border-line'
              }`}
            >
              {i + 1}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
