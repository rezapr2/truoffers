import Link from 'next/link';
import { serverApi } from '@/lib/server-api';
import type { Supplier } from '@/lib/types';
import VerifiedBadge from '@/components/VerifiedBadge';

export const metadata = {
  title: 'Supplier marketplace — TruOffers',
  description:
    'Packaging, EPOS, ingredients, recruitment and delivery partners for UK takeaways.',
};

const CATEGORY_LABELS: Record<string, string> = {
  packaging: '📦 Packaging',
  epos: '🖥️ EPOS & tech',
  ingredients: '🧂 Ingredients',
  recruitment: '👥 Recruitment',
  delivery: '🛵 Delivery',
  accounting: '📊 Accounting',
};

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const suppliers =
    (await serverApi<Supplier[]>(`/suppliers${category ? `?category=${category}` : ''}`)) || [];
  const allCategories = [...new Set(suppliers.map((s) => s.category))];

  return (
    <div className="mx-auto max-w-7xl px-5 md:px-10 py-10">
      <h1 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight mb-2">
        Supplier marketplace
      </h1>
      <p className="text-muted font-semibold mb-8 max-w-2xl">
        Trusted partners for takeaways — packaging, EPOS, ingredients and more. Request quotes
        directly from supplier profiles.
      </p>

      <div className="flex gap-2 flex-wrap mb-8">
        <Link
          href="/suppliers"
          className={`text-sm font-bold px-4 py-2.5 rounded-full ${
            !category ? 'bg-ink text-surface' : 'bg-card border border-line hover:border-primary'
          }`}
        >
          All
        </Link>
        {allCategories.map((c) => (
          <Link
            key={c}
            href={`/suppliers?category=${c}`}
            className={`text-sm font-bold px-4 py-2.5 rounded-full capitalize ${
              category === c ? 'bg-ink text-surface' : 'bg-card border border-line hover:border-primary'
            }`}
          >
            {CATEGORY_LABELS[c] || c}
          </Link>
        ))}
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {suppliers.map((s) => (
          <Link
            key={s._id}
            href={`/suppliers/${s.slug}`}
            className="bg-card rounded-3xl p-7 hover:shadow-lg transition-shadow flex flex-col"
          >
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <h2 className="font-display text-lg font-extrabold">{s.name}</h2>
              <VerifiedBadge status={s.verificationStatus} className="text-[12px]" />
              {s.featured && (
                <span className="text-[11px] font-extrabold uppercase bg-primary text-cream px-2.5 py-0.5 rounded-full">
                  Featured
                </span>
              )}
            </div>
            <div className="text-[13px] font-bold text-muted capitalize mb-3">
              {CATEGORY_LABELS[s.category] || s.category} · {s.serviceArea}
            </div>
            <p className="text-sm font-semibold text-ink-soft leading-relaxed line-clamp-3">
              {s.description}
            </p>
            <span className="mt-4 text-sm font-bold text-primary">Request a quote →</span>
          </Link>
        ))}
      </div>

      <div className="mt-14 bg-ink text-surface rounded-3xl px-8 py-10 md:px-14 flex flex-col md:flex-row items-start md:items-center gap-6">
        <div className="flex-1">
          <h2 className="font-display text-2xl font-extrabold mb-2">Are you a supplier?</h2>
          <p className="text-[15px] text-[#C9B8AC] font-semibold">
            Reach thousands of independent takeaways actively looking for partners.
          </p>
        </div>
        <Link
          href="/register?role=supplier"
          className="bg-surface text-ink font-extrabold px-7 py-3.5 rounded-full hover:bg-peach-2 transition-colors"
        >
          List your business
        </Link>
      </div>
    </div>
  );
}
