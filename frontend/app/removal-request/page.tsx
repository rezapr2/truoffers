import Link from 'next/link';
import RemovalRequestForm from './RemovalRequestForm';

export const metadata = {
  title: 'Request removal of imported offers',
  description: 'Ask TruOffers to remove offers imported from your takeaway’s website and stop importing from it.',
};

export default async function RemovalRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ offer?: string; business?: string }>;
}) {
  const { offer, business } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl px-5 md:px-10 py-14">
      <h1 className="font-display text-4xl font-extrabold tracking-tight mb-4">Request removal</h1>
      <div className="text-[15px] font-semibold text-ink-soft leading-relaxed space-y-3 mb-8">
        <p>
          Some offers on TruOffers are imported from takeaways’ own websites by{' '}
          <Link href="/bot" className="text-primary font-bold hover:text-primary-dark">TruOffersBot</Link>. If you run
          or represent the business and don’t want this, tell us here.
        </p>
        <p>
          Removal is immediate: imported offers from the website are taken down, stored excerpts are deleted, and we
          stop importing from it. Our team is notified and may get in touch.
        </p>
      </div>
      <RemovalRequestForm offerId={offer} businessSlug={business} />
    </div>
  );
}
