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
    <footer className="mt-12 px-5 md:px-10 pb-5">
      <div className="mx-auto max-w-7xl bg-brand-deep text-white rounded-[2rem] px-7 py-10 md:px-12">
        <div className="flex flex-col md:flex-row md:items-center gap-6 md:gap-10 mb-8">
          <Logo tone="light" />
          <p className="text-[13.5px] text-leaf-soft/75 max-w-sm leading-relaxed">
            The UK takeaway offers search engine. Free for customers, free to list — every order
            goes straight to the takeaway.
          </p>
        </div>

        <nav className="flex gap-x-8 gap-y-3 text-sm font-bold flex-wrap mb-8">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={l.highlight ? 'text-sun hover:text-sun-soft' : 'text-leaf-soft/85 hover:text-white'}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex flex-col sm:flex-row sm:justify-between gap-3 text-[13px] font-semibold border-t border-white/12 pt-6 text-leaf-soft/70">
          <span>© 2026 TruOffers.co.uk — Made for independent takeaways</span>
          <span className="flex gap-5 flex-wrap">
            <Link href="/privacy" className="hover:text-white">Privacy</Link>
            <Link href="/terms" className="hover:text-white">Terms</Link>
            <Link href="/contact" className="hover:text-white">Contact</Link>
            <Link href="/bot" className="hover:text-white">TruOffersBot</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
