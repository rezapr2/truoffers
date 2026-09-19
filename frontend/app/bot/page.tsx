import Link from 'next/link';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://truoffers.co.uk').replace(/\/+$/, '');
const USER_AGENT = `TruOffersBot/1.0 (+${SITE_URL}/bot)`;

export const metadata = {
  title: 'TruOffersBot',
  description: 'What TruOffersBot is, which pages it reads, and how to control or stop it.',
};

function Code({ children }: { children: React.ReactNode }) {
  return <pre className="bg-ink text-surface rounded-2xl px-5 py-4 text-[13px] font-mono overflow-x-auto">{children}</pre>;
}

export default function BotPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 md:px-10 py-14">
      <h1 className="font-display text-4xl font-extrabold tracking-tight mb-6">TruOffersBot</h1>
      <div className="text-[15px] font-semibold text-ink-soft leading-relaxed space-y-8">
        <section className="space-y-3">
          <p>
            TruOffersBot reads the public offers page of a takeaway’s own website, so customers searching TruOffers see
            that takeaway’s current deals. It only visits websites our team has added and checked. Nothing it finds is
            published until a person at TruOffers or the takeaway itself has reviewed it.
          </p>
          <p>Every request it makes carries this User-Agent, which never changes:</p>
          <Code>{USER_AGENT}</Code>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl font-extrabold text-ink">What it reads, and what it doesn’t</h2>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>The home page, offers, menu, contact and branch pages of an approved takeaway website: by default no more than 50 pages a visit.</li>
            <li>By default one request every two seconds to a website at most. If your robots.txt sets a longer crawl delay, it waits that long instead.</li>
            <li>It never logs in, fills in forms, adds items to a basket, or tries to get past a CAPTCHA or rate limit.</li>
            <li>It never visits marketplaces such as Just Eat, Uber Eats or Deliveroo, or search engines, maps and social networks.</li>
            <li>It doesn’t keep copies of your pages: only the offer details and a short quote (500 characters at most) showing where each detail came from.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl font-extrabold text-ink">Controlling it with robots.txt</h2>
          <p>TruOffersBot follows robots.txt. To keep it off your whole website:</p>
          <Code>{`User-agent: TruOffersBot\nDisallow: /`}</Code>
          <p>To keep it out of part of your website only:</p>
          <Code>{`User-agent: TruOffersBot\nDisallow: /members/`}</Code>
          <p>
            The one exception: if a takeaway’s owner has told us they want their offers listed, but their website’s robots.txt asks all
            bots to stay away (a website platform’s setting, for example), we record that consent and read that website anyway. It
            applies to that website alone, at the same slow rate, and it ends as soon as the owner opts out or asks us to stop.
          </p>
          <p>
            It also respects <code className="font-mono text-ink">noindex</code> and{' '}
            <code className="font-mono text-ink">nofollow</code>, set either in a{' '}
            <code className="font-mono text-ink">&lt;meta name=&quot;robots&quot;&gt;</code> tag (or{' '}
            <code className="font-mono text-ink">name=&quot;truoffersbot&quot;</code>) or in an{' '}
            <code className="font-mono text-ink">X-Robots-Tag</code> header. It won’t use pages marked{' '}
            <code className="font-mono text-ink">noindex</code>.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl font-extrabold text-ink">Removing imported offers</h2>
          <p>
            If you run a takeaway and don’t want your offers imported,{' '}
            <Link href="/removal-request" className="text-primary font-bold hover:text-primary-dark">send a removal request</Link>.
            It takes effect straight away: imported offers are taken down and we stop visiting the website.
          </p>
          <p>
            Prefer to manage your offers yourself?{' '}
            <Link href="/claim-your-business" className="text-primary font-bold hover:text-primary-dark">Claim your listing</Link>{' '}
            and you can confirm, edit or remove anything imported from your website.
          </p>
        </section>
      </div>
    </div>
  );
}
