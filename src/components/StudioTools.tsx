import Link from 'next/link';
import type { JSX } from 'react';

const ICONS: Record<string, JSX.Element> = {
  prepare: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" fill="none" strokeWidth="2" />
      <polyline points="9,13 12,16 16,10" fill="none" strokeWidth="2" />
    </>
  ),
  create: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="2" fill="none" strokeWidth="2" />
      <path d="M12 9v6M9 12h6" strokeWidth="2" />
    </>
  ),
  revenue: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" fill="none" strokeWidth="2" />
    </>
  ),
  rulebook: (
    <>
      <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z" fill="none" strokeWidth="2" />
      <path d="M9 9h7M9 13h7" strokeWidth="2" />
    </>
  ),
  delay: (
    <>
      <circle cx="12" cy="12" r="8" fill="none" strokeWidth="2" />
      <path d="M12 7v5l3.5 2" fill="none" strokeWidth="2" />
    </>
  ),
};

const CARDS = [
  {
    icon: 'prepare',
    title: 'Prepare live show',
    href: '/studio/shows',
    text: 'Pick a show, accept the rulebook, and rehearse before broadcast.',
  },
  {
    icon: 'create',
    title: 'Create show',
    href: '/studio/shows/new',
    text: 'Schedule a new show with tiers and ticket caps.',
  },
  {
    icon: 'revenue',
    title: 'Revenue calculator',
    href: '/studio/shows/new#revenue-calculator',
    text: 'Estimate payouts and find your price range.',
  },
  {
    icon: 'rulebook',
    title: 'Rulebook',
    href: '/studio/rulebook',
    text: 'The moderation rules every broadcast follows.',
  },
  {
    icon: 'delay',
    title: 'Preview delay',
    href: '/studio/delay',
    text: 'See how the 20-second broadcast delay works.',
  },
];

/** Prominent tool cards for the studio overview. */
export function StudioTools() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {CARDS.map((c) => (
        <Link
          key={c.href + c.title}
          href={c.href}
          className="group rounded-md border border-neutral-800 bg-neutral-900/60 p-5 hover:border-spotlight/60"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-8 w-8 text-spotlight"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            {ICONS[c.icon]}
          </svg>
          <h3 className="mt-3 font-semibold group-hover:underline">{c.title}</h3>
          <p className="mt-1 text-sm text-neutral-400">{c.text}</p>
        </Link>
      ))}
    </div>
  );
}
