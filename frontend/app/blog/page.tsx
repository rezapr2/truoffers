export const metadata = { title: 'Blog — TruOffers' };

const POSTS = [
  {
    title: 'Best pizza offers in Manchester this week',
    tag: 'City guides',
    excerpt: 'From Rusholme to the Northern Quarter — the deals worth ordering tonight.',
  },
  {
    title: 'How takeaways can cut marketplace fees without losing orders',
    tag: 'For owners',
    excerpt: 'A practical playbook: direct ordering links, offer-led discovery and repeat-customer tools.',
  },
  {
    title: 'Why offer-led discovery beats scrolling menus',
    tag: 'Product',
    excerpt: 'Customers decide where to order based on the deal. Here’s the data.',
  },
];

export default function BlogPage() {
  return (
    <div className="mx-auto max-w-4xl px-5 md:px-10 py-14">
      <h1 className="font-display text-4xl font-extrabold tracking-tight mb-2">Blog</h1>
      <p className="text-muted font-semibold mb-10">Guides, city round-ups and product news.</p>
      <div className="grid gap-4">
        {POSTS.map((post) => (
          <article key={post.title} className="bg-card rounded-3xl p-8 hover:shadow-lg transition-shadow">
            <span className="text-[11px] font-extrabold uppercase text-primary">{post.tag}</span>
            <h2 className="font-display text-xl font-extrabold mt-1 mb-2">{post.title}</h2>
            <p className="text-sm font-semibold text-muted">{post.excerpt}</p>
            <span className="inline-block mt-4 text-sm font-bold text-muted">Coming soon</span>
          </article>
        ))}
      </div>
    </div>
  );
}
