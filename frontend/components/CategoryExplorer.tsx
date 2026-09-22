import Link from 'next/link';
import type { Category } from '@/lib/types';

// Where each floating card sits around the plate on large screens
const SEATS = [
  'lg:absolute lg:top-2 lg:left-1/2 lg:-ml-[76px]',
  'lg:absolute lg:top-1/3 lg:left-0',
  'lg:absolute lg:top-1/3 lg:right-0',
  'lg:absolute lg:bottom-6 lg:left-[14%]',
  'lg:absolute lg:bottom-16 lg:right-[16%]',
];

/**
 * One cuisine. The drift lives on the wrapper and the hover lift on the card,
 * so the two transforms never overwrite each other.
 */
function CategoryTile({
  category,
  index,
  className = '',
}: {
  category: Category;
  index: number;
  className?: string;
}) {
  return (
    <div
      className={`bob ${className}`}
      style={{ animationDelay: `${index * 0.7}s`, animationDuration: `${5 + (index % 3) * 0.8}s` }}
    >
      <Link
        href={`/offers?category=${category.slug}`}
        className="group block bg-card rounded-3xl px-5 py-4 w-full lg:w-[152px] text-center shadow-lg transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl"
      >
        <span className="w-12 h-12 mx-auto mb-2.5 rounded-full bg-sun-soft flex items-center justify-center text-2xl leading-none transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-12">
          {category.emoji || '🍽️'}
        </span>
        <div className="font-display font-extrabold text-[14px] leading-tight group-hover:text-primary transition-colors">
          {category.name}
        </div>
        <div className="text-[11.5px] font-bold text-muted mt-0.5">
          {category.businessCount} takeaway{category.businessCount === 1 ? '' : 's'}
        </div>
      </Link>
    </div>
  );
}

/** The pale-green cuisine section: cards floating around a plate. */
export default function CategoryExplorer({ categories }: { categories: Category[] }) {
  const floating = categories.slice(0, SEATS.length);
  const plateEmoji = categories.slice(0, 4).map((c) => c.emoji || '🍽️');

  return (
    <section className="mx-5 md:mx-10 bg-leaf rounded-[2rem] px-6 py-10 md:px-12 md:py-14">
      <div className="flex flex-col md:flex-row md:items-end gap-4 md:gap-10 mb-10">
        <h2 className="font-display text-2xl md:text-[34px] font-extrabold tracking-tight leading-[1.15] text-brand-deeper flex-1">
          Explore delicious cuisine
          <br className="hidden md:block" /> by category
        </h2>
        <p className="text-[13.5px] text-brand-deep/75 font-semibold max-w-xs leading-relaxed">
          Every cuisine, every live offer near you. Whether you&apos;re after a quick bite or
          tonight&apos;s big order, start here.
        </p>
      </div>

      {/* Mobile: a plain grid. Large screens: cards orbiting the plate. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 lg:hidden">
        {categories.map((cat, i) => (
          <CategoryTile key={cat._id} category={cat} index={i} />
        ))}
      </div>

      <div className="hidden lg:block relative h-[430px] mx-auto max-w-4xl">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[378px] h-[378px]">
          <div className="ring-turn w-full h-full rounded-full border-2 border-dashed border-brand-deep/15" />
        </div>
        <div className="bob-slow absolute left-1/2 top-1/2 -ml-[165px] -mt-[165px]">
          <div className="plate w-[330px] h-[330px] rounded-full flex items-center justify-center">
            <div className="grid grid-cols-2 gap-3 text-[62px] leading-none select-none" aria-hidden="true">
              {plateEmoji.map((e, i) => (
                <span key={i} className="drop-shadow-sm">
                  {e}
                </span>
              ))}
            </div>
          </div>
        </div>
        {floating.map((cat, i) => (
          <CategoryTile key={cat._id} category={cat} index={i} className={SEATS[i]} />
        ))}
      </div>

      <div className="flex justify-center mt-9 lg:mt-4">
        <Link
          href="/categories"
          className="bg-brand-deep text-white text-[13px] font-extrabold px-7 py-3.5 rounded-full hover:bg-brand transition-colors"
        >
          View all categories
        </Link>
      </div>
    </section>
  );
}
