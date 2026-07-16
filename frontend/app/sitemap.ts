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
  ].map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: path === '' || path === '/offers' ? 'hourly' : 'daily',
    priority: path === '' ? 1 : 0.8,
  }));

  const [businesses, towns] = await Promise.all([
    serverApi<{ items: Business[] }>('/businesses?limit=50'),
    serverApi<{ town: string }[]>('/businesses/towns'),
  ]);

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

  return [...staticPages, ...townPages, ...businessPages];
}
