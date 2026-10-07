import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import BlogCover from '@/components/BlogCover';
import HelpBody from '@/components/HelpBody';
import { serverApi } from '@/lib/server-api';

interface Post {
  _id: string;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  coverUrl?: string;
  tags: string[];
  publishedAt: string;
  updatedAt: string;
  authorName?: string;
  seoTitle?: string;
  seoDescription?: string;
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://truoffers.co.uk';
const load = cache((slug: string) => serverApi<{ post: Post; related: Post[] }>(`/blog/${encodeURIComponent(slug)}`));
const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const data = await load((await params).slug);
  if (!data) return { title: 'Blog — TruOffers' };
  const { post } = data;
  const description = post.seoDescription || post.excerpt;
  return {
    title: `${post.seoTitle || post.title} — TruOffers`,
    description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: { title: post.seoTitle || post.title, description, type: 'article', publishedTime: post.publishedAt, url: `${SITE_URL}/blog/${post.slug}` },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const data = await load((await params).slug);
  if (!data) notFound();
  const { post, related } = data;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    author: { '@type': 'Organization', name: post.authorName || 'TruOffers' },
    mainEntityOfPage: `${SITE_URL}/blog/${post.slug}`,
  };

  return (
    <article className="mx-auto max-w-3xl px-5 md:px-10 py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <Link href="/blog" className="text-sm font-bold text-muted hover:text-primary">
        ← Blog
      </Link>
      <div className="flex gap-2 flex-wrap mt-4 mb-2">
        {post.tags.map((t) => (
          <Link key={t} href={`/blog?tag=${encodeURIComponent(t)}`} className="text-[11px] font-extrabold uppercase text-primary">
            {t}
          </Link>
        ))}
      </div>
      <h1 className="font-display text-3xl md:text-[42px] font-extrabold tracking-tight leading-[1.1] mb-3">{post.title}</h1>
      <div className="text-sm font-bold text-muted mb-8">
        {fmt(post.publishedAt)}
        {post.authorName ? ` · ${post.authorName}` : ''}
      </div>
      <div className="rounded-3xl overflow-hidden mb-8">
        <BlogCover url={post.coverUrl} title={post.title} label={post.tags[0]} className="aspect-[21/9]" />
      </div>
      {post.excerpt && <p className="text-lg font-semibold text-ink-soft leading-relaxed mb-6">{post.excerpt}</p>}
      <HelpBody body={post.body} />
      {related.length > 0 && (
        <section className="mt-14 border-t border-line pt-8">
          <h2 className="font-display text-xl font-extrabold mb-4">More to read</h2>
          <ul className="flex flex-col gap-3">
            {related.map((r) => (
              <li key={r._id}>
                <Link href={`/blog/${r.slug}`} className="font-bold hover:text-primary">
                  {r.title}
                </Link>
                <p className="text-sm text-muted">{r.excerpt}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
