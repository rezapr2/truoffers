import Link from 'next/link';
import { serverApi } from '@/lib/server-api';
import PageHero from '@/components/PageHero';

export const metadata = {
  title: 'Help — TruOffers',
  description: 'How TruOffers works for customers and takeaways: offers, verification, plans and listings.',
};

interface HelpPage {
  _id: string;
  slug: string;
  title: string;
}

interface Faq {
  question: string;
  answer: string;
}

export default async function HelpPage() {
  const [pages, faqs] = await Promise.all([serverApi<HelpPage[]>('/content/help'), serverApi<Faq[]>('/content/faqs')]);
  return (
    <div>
      <PageHero title="Help" subtitle="Answers for customers and takeaway owners." />
      <div className="mx-auto max-w-4xl px-5 md:px-10 py-10 flex flex-col gap-12">
        {pages && pages.length > 0 && (
          <section>
            <h2 className="font-display text-2xl font-extrabold mb-5">Guides</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {pages.map((p) => (
                <Link key={p._id} href={`/help/${p.slug}`} className="bg-card border border-line rounded-2xl px-5 py-4 font-extrabold hover:border-primary hover:text-primary transition-colors">
                  {p.title} →
                </Link>
              ))}
            </div>
          </section>
        )}
        {faqs && faqs.length > 0 && (
          <section>
            <h2 className="font-display text-2xl font-extrabold mb-5">Frequently asked questions</h2>
            <div className="flex flex-col gap-3">
              {faqs.map((f, i) => (
                <details key={i} className="bg-card border border-line rounded-2xl px-5 py-4 group">
                  <summary className="font-extrabold cursor-pointer list-none flex justify-between gap-4">
                    {f.question}
                    <span className="text-muted group-open:rotate-45 transition-transform">+</span>
                  </summary>
                  <p className="mt-3 text-ink-soft leading-relaxed whitespace-pre-line">{f.answer}</p>
                </details>
              ))}
            </div>
          </section>
        )}
        <section className="bg-surface rounded-3xl px-6 py-6 text-sm text-ink-soft">
          Still stuck? <Link href="/contact" className="text-primary font-bold">Contact us</Link>. Own a takeaway that’s listed and want it removed?{' '}
          <Link href="/removal-request" className="text-primary font-bold">Ask for removal</Link>.
        </section>
      </div>
    </div>
  );
}
