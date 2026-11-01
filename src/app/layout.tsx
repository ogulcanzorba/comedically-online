import type { Metadata } from 'next';
import './globals.css';
import { SiteHeader } from '@/components/SiteHeader';

export const metadata: Metadata = {
  title: 'Comedically Online',
  description: 'Live comedy. Moderated by someone who gets the joke.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-neutral-950 text-neutral-100 antialiased">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
