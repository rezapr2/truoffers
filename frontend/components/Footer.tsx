import Link from 'next/link';

const LINKS = [
  { href: '/offers', label: 'Offers' },
  { href: '/categories', label: 'Categories' },
  { href: '/takeaways', label: 'Takeaways' },
  { href: '/blog', label: 'Blog' },
  { href: '/about', label: 'About' },
  { href: '/claim-your-business', label: 'Add your business', highlight: true },
  { href: '/pricing', label: 'Pricing' },
  { href: '/suppliers', label: 'Suppliers' },
];

export default function Footer() {
  return (
    <footer className="mt-16 pb-8 px-5 md:px-10">
      <div className="mx-auto max-w-7xl border-t border-line pt-8">
        <nav className="flex gap-x-8 gap-y-3 text-sm font-bold text-ink-soft flex-wrap mb-6">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={l.highlight ? 'text-primary hover:text-primary-dark' : 'hover:text-primary'}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col sm:flex-row sm:justify-between gap-3 text-[13px] text-muted font-semibold">
          <span>© 2026 TruOffers.co.uk — Made for independent takeaways</span>
          <span className="flex gap-5">
            <Link href="/privacy" className="hover:text-primary">Privacy</Link>
            <Link href="/terms" className="hover:text-primary">Terms</Link>
            <Link href="/contact" className="hover:text-primary">Contact</Link>
            <Link href="/bot" className="hover:text-primary">TruOffersBot</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
