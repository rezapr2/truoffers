import type { MetadataRoute } from 'next';
import { serverApi } from '@/lib/server-api';
import type { Business } from '@/lib/types';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://truoffers.co.uk';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    '',
    '/offers',
    '/takeaways',
    '/categories',
    '/suppliers',
    '/pricing',
    '/claim-your-business',
    '/about',
    '/blog',
    '/contact',
    '/help',
  ].map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: path === '' || path === '/offers' ? 'hourly' : 'daily',
    priority: path === '' ? 1 : 0.8,
  }));

  const [businesses, towns, help, offers, blog] = await Promise.all([
    serverApi<{ items: Business[] }>('/businesses?limit=50'),
    serverApi<{ town: string }[]>('/businesses/towns'),
    serverApi<{ slug: string }[]>('/content/help'),
    serverApi<{ _id: string; slug?: string }[]>('/offers?limit=100'),
    serverApi<{ items: { slug: string; publishedAt: string }[] }>('/blog'),
  ]);
  const blogPages: MetadataRoute.Sitemap = (blog?.items || []).map((p) => ({ url: `${SITE_URL}/blog/${p.slug}`, lastModified: p.publishedAt, changeFrequency: 'monthly', priority: 0.5 }));

  const helpPages: MetadataRoute.Sitemap = (help || []).map((p) => ({ url: `${SITE_URL}/help/${p.slug}`, changeFrequency: 'weekly', priority: 0.5 }));
  // Shareable offer pages, /offer/{id}-{slug}
  const offerPages: MetadataRoute.Sitemap = (Array.isArray(offers) ? offers : []).map((o) => ({
    url: `${SITE_URL}/offer/${o._id}${o.slug ? `-${o.slug}` : ''}`,
    changeFrequency: 'daily',
    priority: 0.6,
  }));

  const businessPages: MetadataRoute.Sitemap = (businesses?.items || []).map((b) => ({
    url: `${SITE_URL}/takeaway/${b.slug}`,
    changeFrequency: 'daily',
    priority: 0.7,
  }));

  const townPages: MetadataRoute.Sitemap = (towns || []).map((t) => ({
    url: `${SITE_URL}/takeaways/${encodeURIComponent(t.town.toLowerCase())}`,
    changeFrequency: 'daily',
    priority: 0.7,
  }));

  return [...staticPages, ...townPages, ...businessPages, ...offerPages, ...helpPages, ...blogPages];
}
