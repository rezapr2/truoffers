import Link from 'next/link';

export default function Logo({
  size = 'md',
  tone = 'ink',
}: {
  size?: 'md' | 'sm';
  /** `light` is for the green hero bar, where the wordmark sits on dark. */
  tone?: 'ink' | 'light';
}) {
  return (
    <Link
      href="/"
      className={`inline-flex items-center gap-2.5 font-display font-extrabold tracking-tight ${
        tone === 'light' ? 'text-white' : 'text-ink'
      } ${size === 'md' ? 'text-2xl' : 'text-xl'}`}
    >
      <svg
        viewBox="0 0 32 32"
        aria-hidden="true"
        className={`${tone === 'light' ? 'text-sun' : 'text-primary'} ${size === 'md' ? 'w-8 h-8' : 'w-7 h-7'}`}
      >
        <rect width="32" height="32" rx="10" fill="currentColor" />
        <circle cx="11" cy="11" r="3" fill={tone === 'light' ? '#10462F' : '#fff'} />
        <circle cx="21" cy="21" r="3" fill={tone === 'light' ? '#10462F' : '#fff'} />
        <path
          d="M21 9 11 23"
          stroke={tone === 'light' ? '#10462F' : '#fff'}
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
      <span>
        Tru<span className={tone === 'light' ? 'text-sun' : 'text-primary'}>Offers</span>
      </span>
    </Link>
  );
}
