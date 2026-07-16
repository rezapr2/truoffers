import Link from 'next/link';
import { serverApi } from '@/lib/server-api';
import type { Category } from '@/lib/types';

export const metadata = {
  title: 'Browse by cuisine — TruOffers',
  description: 'Pizza, Indian, Chinese, fish & chips and more — find live takeaway offers by cuisine.',
};

export default async function CategoriesPage() {
  const categories = (await serverApi<Category[]>('/categories')) || [];

  return (
    <div className="mx-auto max-w-7xl px-5 md:px-10 py-10">
      <h1 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight mb-2">
        Browse by cuisine
      </h1>
      <p className="text-muted font-semibold mb-10">
        Every category links straight to live offers near you.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {categories.map((cat) => (
          <Link
            key={cat._id}
            href={`/offers?category=${cat.slug}`}
            className="bg-card rounded-3xl p-7 text-center hover:shadow-lg hover:-translate-y-0.5 transition-all"
          >
            <div className="text-4xl mb-3">{cat.emoji || '🍽️'}</div>
            <div className="font-display text-lg font-extrabold">{cat.name}</div>
            <div className="text-[13px] font-bold text-muted mt-1">
              {cat.businessCount} takeaway{cat.businessCount === 1 ? '' : 's'}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
