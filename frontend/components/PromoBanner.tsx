import Link from 'next/link';
import type { Category } from '@/lib/types';
import { FlameIcon } from './icons';

export type BannerTone = 'sun' | 'tomato' | 'leaf';

const TONES: Record<
  BannerTone,
  { panel: string; kicker: string; heading: string; badge: string; button: string }
> = {
  sun: {
    panel: 'bg-sun-soft',
    kicker: 'text-[#8A6A12]',
    heading: 'text-brand-deeper',
    badge: 'bg-sun text-[#43310A]',
    button: 'bg-card text-brand-deep',
  },
  tomato: {
    panel: 'bg-tomato',
    kicker: 'text-white/80',
    heading: 'text-white',
    badge: 'bg-card text-tomato',
    button: 'bg-card text-tomato',
  },
  leaf: {
    panel: 'bg-brand-deep',
    kicker: 'text-leaf',
    heading: 'text-white',
    badge: 'bg-sun text-[#43310A]',
    button: 'bg-sun text-[#43310A]',
  },
};

/**
 * The colour-block cuisine promos under the hero. Each one is a real category
 * with live listings, so the badge counts what is actually there.
 */
export default function PromoBanner({
  category,
  tone,
  kicker,
  size = 'sm',
}: {
  category: Category;
  tone: BannerTone;
  kicker: string;
  size?: 'sm' | 'lg';
}) {
  const t = TONES[tone];

  return (
    <Link
      href={`/offers?category=${category.slug}`}
      className={`group relative overflow-hidden rounded-3xl flex flex-col justify-between ${t.panel} ${
        size === 'lg' ? 'p-7 md:p-9 min-h-[330px]' : 'p-6 md:p-7 min-h-[155px]'
      }`}
    >
      {/* The oversized emoji stands in for the reference's food photography */}
      <span
        aria-hidden="true"
        className={`absolute select-none leading-none opacity-90 transition-transform duration-300 group-hover:scale-105 ${
          size === 'lg'
            ? 'text-[190px] md:text-[240px] -right-6 -bottom-10 rotate-6'
            : 'text-[110px] -right-2 -bottom-5 rotate-6'
        }`}
        style={{ filter: 'drop-shadow(0 18px 24px rgb(0 0 0 / 0.18))' }}
      >
        {category.emoji || '🍽️'}
      </span>

      <div className="relative max-w-[62%]">
        <div className={`text-[12px] font-extrabold uppercase tracking-[0.14em] mb-1.5 ${t.kicker}`}>
          {kicker}
        </div>
        <div
          className={`font-display font-extrabold leading-[1.05] ${t.heading} ${
            size === 'lg' ? 'text-3xl md:text-[40px]' : 'text-xl md:text-2xl'
          }`}
        >
          {category.name}
        </div>
      </div>

      <div className="relative flex items-center gap-3 flex-wrap">
        <span
          className={`text-[13px] font-extrabold px-4 py-2 rounded-full inline-flex items-center gap-1.5 ${t.button}`}
        >
          Order now
          <FlameIcon className="w-3.5 h-3.5" />
        </span>
        <span className={`text-[12px] font-extrabold px-3 py-1.5 rounded-full ${t.badge}`}>
          {category.businessCount} takeaway{category.businessCount === 1 ? '' : 's'}
        </span>
      </div>
    </Link>
  );
}
