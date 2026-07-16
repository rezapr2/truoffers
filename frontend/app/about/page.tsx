import Link from 'next/link';

export const metadata = { title: 'About — TruOffers' };

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 md:px-10 py-14">
      <h1 className="font-display text-4xl font-extrabold tracking-tight mb-6">
        The offers come first.
      </h1>
      <div className="text-[17px] font-semibold text-ink-soft leading-relaxed space-y-5">
        <p>
          TruOffers is the UK&apos;s takeaway offers search engine. We built it because ordering food
          has quietly become expensive: delivery fees, service charges and menu mark-ups stack up,
          while independent takeaways hand over 14–30% of every order to marketplaces.
        </p>
        <p>
          We think there&apos;s a better way. Customers search one place for every live offer near
          their postcode. Takeaways get found without giving away commission — they list free, get
          verified, and pay only for extra visibility if they want it. Orders go direct: your money
          goes to the kitchen, not the middleman.
        </p>
        <p>
          TruOffers works alongside <strong>Foodbell</strong>, the direct-ordering platform for
          independent takeaways. TruOffers helps customers discover; Foodbell powers the order.
        </p>
      </div>
      <div className="mt-10 flex gap-3 flex-wrap">
        <Link href="/offers" className="bg-primary text-cream font-bold px-7 py-3.5 rounded-full hover:bg-primary-dark transition-colors">
          Find offers near you
        </Link>
        <Link href="/claim-your-business" className="border-[1.5px] border-ink font-bold px-7 py-3.5 rounded-full hover:bg-ink hover:text-surface transition-colors">
          List your takeaway
        </Link>
      </div>
    </div>
  );
}
