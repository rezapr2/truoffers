import type { Metadata } from 'next';
import { Manrope, Bricolage_Grotesque } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-manrope',
});

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-bricolage',
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://truoffers.co.uk';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'TruOffers — The UK takeaway offers search engine',
    template: '%s | TruOffers',
  },
  description:
    'Every live takeaway offer near you, in one search. Verified businesses, real reviews, direct ordering — no marketplace mark-ups.',
  openGraph: {
    type: 'website',
    siteName: 'TruOffers',
    title: 'TruOffers — The UK takeaway offers search engine',
    description:
      'Every live takeaway offer near you, in one search. Verified businesses, real reviews, direct ordering.',
    locale: 'en_GB',
  },
  twitter: {
    card: 'summary_large_image',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${manrope.variable} ${bricolage.variable}`}>
      <body className="min-h-screen flex flex-col antialiased">
        <AuthProvider>
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
