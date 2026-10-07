import type { MetadataRoute } from 'next';

// Lets people add TruOffers to their phone's home screen and open it like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TruOffers: takeaway offers near you',
    short_name: 'TruOffers',
    description: 'Every live takeaway offer near you, in one search. Order direct, no marketplace mark-ups.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F6F5EF',
    theme_color: '#10462F',
    categories: ['food', 'shopping', 'lifestyle'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Offers near me', url: '/offers', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
      { name: 'Takeaways', url: '/takeaways', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
