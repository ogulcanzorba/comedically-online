import type { Metadata } from 'next';
import { Fraunces, Public_Sans } from 'next/font/google';
import './globals.css';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { CookieBanner } from '@/components/CookieBanner';

const display = Fraunces({ subsets: ['latin'], variable: '--font-display' });
const bodyFont = Public_Sans({ subsets: ['latin'], variable: '--font-body' });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Comedically Online — Live comedy, moderated by someone who gets the joke',
    template: '%s | Comedically Online',
  },
  description:
    'Live stand-up streaming with comedy-aware moderation. Browse shows, grab a ticket, watch the jokes land.',
  icons: { icon: '/icon.svg' },
  openGraph: {
    siteName: 'Comedically Online',
    type: 'website',
    title: 'Comedically Online',
    description: 'Live comedy. Moderated by someone who gets the joke.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Comedically Online',
    description: 'Live comedy. Moderated by someone who gets the joke.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${bodyFont.variable}`}>
      <body className="bg-ink text-neutral-100 antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-spotlight focus:px-3 focus:py-2 focus:text-ink"
        >
          Skip to content
        </a>
        <SiteHeader />
        <div id="main">{children}</div>
        <SiteFooter />
        <CookieBanner />
      </body>
    </html>
  );
}
