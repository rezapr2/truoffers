import { assetUrl } from '@/lib/api';

// Panel classes and the colour of the marks inside the logo square (it must contrast with the square)
const TONES = [
  { panel: 'bg-brand-deep text-leaf', mark: '#10462F' },
  { panel: 'bg-sun-soft text-brand-deeper', mark: '#FFFFFF' },
  { panel: 'bg-tomato text-white', mark: '#EE5B3B' },
  { panel: 'bg-tint-mint text-brand-deep', mark: '#FFFFFF' },
];

/** A blog post's cover image, or a branded panel showing its tag when it has none. */
export default function BlogCover({ url, title, label, className = 'aspect-[16/9]' }: { url?: string; title: string; label?: string; className?: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- covers are uploads or external https images
    return <img src={assetUrl(url)} alt="" className={`w-full object-cover bg-surface ${className}`} loading="lazy" />;
  }
  const tone = TONES[[...title].reduce((n, c) => n + c.charCodeAt(0), 0) % TONES.length];
  return (
    <div className={`w-full ${className} ${tone.panel} hero-pattern flex flex-col justify-between p-6`} aria-hidden="true">
      <svg viewBox="0 0 32 32" className="w-10 h-10 opacity-90">
        <rect width="32" height="32" rx="10" fill="currentColor" />
        <circle cx="11" cy="11" r="3" fill={tone.mark} />
        <circle cx="21" cy="21" r="3" fill={tone.mark} />
        <path d="M21 9 11 23" stroke={tone.mark} strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      <span className="font-display text-lg font-extrabold uppercase tracking-wide">{label ?? 'TruOffers blog'}</span>
    </div>
  );
}
