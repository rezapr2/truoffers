import Link from 'next/link';
import { serverApi } from '@/lib/server-api';
import type { Category } from '@/lib/types';
import PageHero from '@/components/PageHero';

export const metadata = {
  title: 'Browse by cuisine — TruOffers',
  description: 'Pizza, Indian, Chinese, fish & chips and more — find live takeaway offers by cuisine.',
};

export default async function CategoriesPage() {
  const categories = (await serverApi<Category[]>('/categories')) || [];

  return (
    <div>
      <PageHero
        title="Browse by cuisine"
        subtitle="Every category links straight to the live offers near you."
      />
      <div className="mx-auto max-w-7xl px-5 md:px-10 py-10 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {categories.map((cat) => (
          <Link
            key={cat._id}
            href={`/offers?category=${cat.slug}`}
            className="bg-card border border-line rounded-3xl p-7 text-center hover:shadow-lg hover:-translate-y-0.5 transition-all"
          >
            <span className="w-16 h-16 mx-auto mb-3 rounded-full bg-sun-soft flex items-center justify-center text-[32px] leading-none">
              {cat.emoji || '🍽️'}
            </span>
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
