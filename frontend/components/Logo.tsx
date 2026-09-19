import Link from 'next/link';

export default function Logo({ size = 'md' }: { size?: 'md' | 'sm' }) {
  return (
    <Link
      href="/"
      className={`inline-flex items-center gap-2.5 font-display font-extrabold tracking-tight text-ink ${
        size === 'md' ? 'text-2xl' : 'text-xl'
      }`}
    >
      <svg
        viewBox="0 0 32 32"
        aria-hidden="true"
        className={`text-primary ${size === 'md' ? 'w-8 h-8' : 'w-7 h-7'}`}
      >
        <rect width="32" height="32" rx="10" fill="currentColor" />
        <circle cx="11" cy="11" r="3" fill="#fff" />
        <circle cx="21" cy="21" r="3" fill="#fff" />
        <path d="M21 9 11 23" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      <span>
        Tru<span className="text-primary">Offers</span>
      </span>
    </Link>
  );
}
