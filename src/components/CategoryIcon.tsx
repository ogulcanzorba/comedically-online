import type { JSX } from 'react';

/** Hand-drawn mini icons, one per category. Pure inline SVG, no assets. */
const ICONS: Record<string, JSX.Element> = {
  'stand-up': (
    <>
      <rect x="10" y="10" width="4" height="10" rx="2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  observational: (
    <>
      <ellipse cx="12" cy="12" rx="9" ry="5.5" fill="none" strokeWidth="2" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  'dark-humor': (
    <>
      <circle cx="12" cy="12" r="8" fill="none" strokeWidth="2" />
      <circle cx="15" cy="9" r="5" fill="currentColor" opacity="0.45" stroke="none" />
    </>
  ),
  satire: <polygon points="13,2 5,14 11,14 10,22 19,9 13,9" />,
  'political-satire': <polygon points="12,2 15,9 22,9 16.5,13.5 18.5,21 12,16.5 5.5,21 7.5,13.5 2,9 9,9" />,
  improv: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" fill="none" strokeWidth="2" />
      <circle cx="9" cy="9" r="1.4" />
      <circle cx="15" cy="15" r="1.4" />
      <circle cx="15" cy="9" r="1.4" />
      <circle cx="9" cy="15" r="1.4" />
    </>
  ),
  roast: <polygon points="12,2 20,20 4,20" fill="none" strokeWidth="2" />,
  storytelling: (
    <>
      <rect x="3" y="5" width="8" height="14" rx="1.5" fill="none" strokeWidth="2" />
      <rect x="13" y="5" width="8" height="14" rx="1.5" fill="none" strokeWidth="2" />
    </>
  ),
  'one-liners': (
    <>
      <rect x="4" y="6" width="16" height="2.5" rx="1" />
      <rect x="4" y="11" width="16" height="2.5" rx="1" />
      <rect x="4" y="16" width="10" height="2.5" rx="1" />
    </>
  ),
  'crowd-work': (
    <>
      <circle cx="6" cy="9" r="3" />
      <circle cx="18" cy="9" r="3" />
      <circle cx="12" cy="16" r="3.5" />
    </>
  ),
  cringe: <polyline points="3,14 8,14 10,7 14,19 16,14 21,14" fill="none" strokeWidth="2" />,
  'bilingual-tr-en': (
    <>
      <rect x="3" y="4" width="11" height="8" rx="3" fill="none" strokeWidth="2" />
      <rect x="10" y="12" width="11" height="8" rx="3" fill="none" strokeWidth="2" />
    </>
  ),
};

export function CategoryIcon({ slug, className }: { slug: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" stroke="currentColor" aria-hidden="true">
      {ICONS[slug] ?? ICONS['stand-up']}
    </svg>
  );
}
