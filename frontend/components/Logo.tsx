import Link from 'next/link';

export default function Logo({ size = 'md' }: { size?: 'md' | 'sm' }) {
  return (
    <Link
      href="/"
      className={`font-display font-extrabold tracking-tight text-ink ${
        size === 'md' ? 'text-2xl' : 'text-xl'
      }`}
    >
      Tru<span className="text-primary">Offers</span>
    </Link>
  );
}
