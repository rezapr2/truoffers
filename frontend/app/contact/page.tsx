import Link from 'next/link';
import ContactForm from '@/components/ContactForm';
import PageHero from '@/components/PageHero';

export const metadata = { title: 'Contact — TruOffers', description: 'Ask a question, report a problem with a listing, or get help with your business account.' };

export default function ContactPage() {
  return (
    <div>
      <PageHero title="Contact us" subtitle="Questions about an offer, a listing or your account. We usually reply within one working day." />
      <div className="mx-auto max-w-6xl px-5 md:px-10 py-10 grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-8">
        <section className="bg-card border border-line rounded-3xl p-7">
          <h2 className="font-display text-xl font-extrabold mb-5">Send us a message</h2>
          <ContactForm />
        </section>
        <aside className="flex flex-col gap-4">
          {[
            ['Sales', 'Plans, promotions and supplier sponsorship', 'sales@truoffers.co.uk'],
            ['Partnerships', 'Foodbell integration, franchises and media', 'partners@truoffers.co.uk'],
          ].map(([title, desc, email]) => (
            <div key={email} className="bg-surface rounded-3xl p-6">
              <h2 className="font-display text-lg font-extrabold mb-1">{title}</h2>
              <p className="text-sm font-semibold text-muted mb-3">{desc}</p>
              <a href={`mailto:${email}`} className="text-primary font-bold">
                {email}
              </a>
            </div>
          ))}
          <div className="bg-surface rounded-3xl p-6 text-sm text-muted font-semibold">
            Own a takeaway listed here and want it removed? Use the <Link href="/removal-request" className="text-primary font-bold">removal request form</Link>.
          </div>
        </aside>
      </div>
    </div>
  );
}
