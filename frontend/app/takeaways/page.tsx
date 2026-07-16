import Link from 'next/link';
import { serverApi } from '@/lib/server-api';
import type { Business } from '@/lib/types';
import BusinessCard from '@/components/BusinessCard';

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
    <div className="mx-auto max-w-7xl px-5 md:px-10 py-8">
      <h1 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight mb-2">
        Takeaway directory
      </h1>
      <p className="text-muted font-semibold mb-8">
        {data?.total ?? 0} takeaways listed — verified profiles, live offers and direct ordering.
      </p>

      {/* Towns */}
      <div className="flex gap-2.5 flex-wrap mb-8">
        {(towns || []).map((t) => (
          <Link
            key={t.town}
            href={`/takeaways/${encodeURIComponent(t.town.toLowerCase())}`}
            className="bg-card border border-line text-sm font-bold px-4 py-2.5 rounded-full hover:border-primary transition-colors"
          >
            {t.town} · {t.count}
          </Link>
        ))}
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(data?.items || []).map((b) => (
          <BusinessCard key={b._id} business={b} />
        ))}
      </div>

      {data && data.pages > 1 && (
        <div className="flex gap-2 justify-center mt-10">
          {Array.from({ length: data.pages }, (_, i) => (
            <Link
              key={i}
              href={`/takeaways?page=${i + 1}${q ? `&q=${q}` : ''}`}
              className={`w-10 h-10 flex items-center justify-center rounded-full font-bold text-sm ${
                data.page === i + 1 ? 'bg-ink text-surface' : 'bg-card border border-line'
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
