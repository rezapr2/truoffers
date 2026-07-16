import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-5 py-24 text-center">
      <div className="font-display text-7xl font-extrabold text-primary mb-4">404</div>
      <h1 className="font-display text-3xl font-extrabold tracking-tight mb-3">
        This page is off the menu
      </h1>
      <p className="text-muted font-semibold mb-8">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>
      <div className="flex gap-3 justify-center flex-wrap">
        <Link
          href="/"
          className="bg-ink text-surface font-bold px-7 py-3.5 rounded-full hover:bg-primary transition-colors"
        >
          Back home
        </Link>
        <Link
          href="/offers"
          className="border-[1.5px] border-ink font-bold px-7 py-3.5 rounded-full hover:bg-ink hover:text-surface transition-colors"
        >
          Browse offers
        </Link>
      </div>
    </div>
  );
}
