import Link from 'next/link';
import PageHero from '@/components/PageHero';
import { serverApi } from '@/lib/server-api';
import BlogCover from '@/components/BlogCover';

export const metadata = { title: 'Blog — TruOffers', description: 'Guides for takeaway customers and owners, and news from TruOffers.' };

interface PostSummary {
  _id: string;
  slug: string;
  title: string;
  excerpt: string;
  coverUrl?: string;
  tags: string[];
  publishedAt: string;
}

const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });

export default async function BlogPage({ searchParams }: { searchParams: Promise<{ tag?: string; page?: string }> }) {
  const { tag, page } = await searchParams;
  const qs = new URLSearchParams();
  if (tag) qs.set('tag', tag);
  if (page) qs.set('page', page);
  const data = await serverApi<{ items: PostSummary[]; tags: string[]; page: number; pages: number }>(`/blog${qs.size ? `?${qs}` : ''}`);
  const posts = data?.items ?? [];

  return (
    <div>
      <PageHero title="Blog" subtitle="Guides for takeaway lovers and owners, and news from TruOffers." />
      <div className="mx-auto max-w-6xl px-5 md:px-10 py-10">
        {data && data.tags.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-8">
            <Link href="/blog" className={`text-sm font-bold px-4 py-2 rounded-full ${!tag ? 'bg-tint-blue text-primary' : 'bg-card border border-line hover:border-primary'}`}>
              All posts
            </Link>
            {data.tags.map((t) => (
              <Link key={t} href={`/blog?tag=${encodeURIComponent(t)}`} className={`text-sm font-bold px-4 py-2 rounded-full ${tag === t ? 'bg-tint-blue text-primary' : 'bg-card border border-line hover:border-primary'}`}>
                {t}
              </Link>
            ))}
          </div>
        )}
        {posts.length === 0 ? (
          <div className="bg-surface rounded-3xl p-10 text-center text-muted font-semibold">No posts yet. Check back soon.</div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {posts.map((post) => (
              <Link key={post._id} href={`/blog/${post.slug}`} className="group bg-card border border-line rounded-3xl overflow-hidden hover:shadow-lg transition-shadow flex flex-col">
                <BlogCover url={post.coverUrl} title={post.title} label={post.tags[0]} />
                <div className="p-6 flex flex-col gap-2 flex-1">
                  {post.tags[0] && <span className="text-[11px] font-extrabold uppercase text-primary">{post.tags[0]}</span>}
                  <h2 className="font-display text-xl font-extrabold leading-snug group-hover:text-primary">{post.title}</h2>
                  <p className="text-sm font-semibold text-muted flex-1">{post.excerpt}</p>
                  <span className="text-[12.5px] font-bold text-muted mt-2">{fmt(post.publishedAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
        {data && data.pages > 1 && (
          <div className="flex justify-center gap-3 mt-10">
            {data.page > 1 && (
              <Link className="text-sm font-bold border border-line rounded-full px-4 py-2" href={`/blog?${new URLSearchParams({ ...(tag ? { tag } : {}), page: String(data.page - 1) })}`}>
                ← Newer
              </Link>
            )}
            {data.page < data.pages && (
              <Link className="text-sm font-bold border border-line rounded-full px-4 py-2" href={`/blog?${new URLSearchParams({ ...(tag ? { tag } : {}), page: String(data.page + 1) })}`}>
                Older →
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
