import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { serverApi } from '@/lib/server-api';
import HelpBody from '@/components/HelpBody';

interface HelpPage {
  slug: string;
  title: string;
  body: string;
  updatedAt?: string;
}

const load = cache((slug: string) => serverApi<HelpPage>(`/content/help/${encodeURIComponent(slug)}`));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const page = await load((await params).slug);
  if (!page) return { title: 'Help — TruOffers' };
  return { title: `${page.title} — TruOffers help`, description: page.body.replace(/\s+/g, ' ').slice(0, 155) };
}

export default async function HelpArticle({ params }: { params: Promise<{ slug: string }> }) {
  const page = await load((await params).slug);
  if (!page) notFound();
  return (
    <article className="mx-auto max-w-3xl px-5 md:px-10 py-10">
      <Link href="/help" className="text-sm font-bold text-muted hover:text-primary">
        ← Help
      </Link>
      <h1 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight mt-3 mb-6">{page.title}</h1>
      <HelpBody body={page.body} />
    </article>
  );
}
