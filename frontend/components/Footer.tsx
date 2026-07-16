import Link from 'next/link';
import Logo from './Logo';

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
    <footer className="mt-16 px-5 md:px-10 py-12 border-t border-line">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-8 mb-8">
          <Logo size="sm" />
          <nav className="flex gap-x-8 gap-y-4 text-sm font-bold text-ink-soft flex-wrap">
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
        </div>
        <div className="border-t border-line pt-5 flex flex-col sm:flex-row sm:justify-between gap-3 text-[13px] text-muted font-semibold">
          <span>© 2026 TruOffers.co.uk — Made for independent takeaways</span>
          <span className="flex gap-5">
            <Link href="/privacy" className="hover:text-primary">Privacy</Link>
            <Link href="/terms" className="hover:text-primary">Terms</Link>
            <Link href="/contact" className="hover:text-primary">Contact</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
