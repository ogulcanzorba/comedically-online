export interface Category {
  slug: string;
  name: string;
  description: string;
}

/** Fixed category catalogue. Tags table holds auto/manual tags; categories are curated. */
export const CATEGORIES: Category[] = [
  { slug: 'stand-up', name: 'Stand-up', description: 'One mic, one comic, no script. The classic club set.' },
  { slug: 'observational', name: 'Observational', description: 'Everyday life under a microscope. Have you ever noticed…' },
  { slug: 'dark-humor', name: 'Dark Humor', description: 'Laughing at the void, tastefully-ish. Not for the faint of heart.' },
  { slug: 'satire', name: 'Satire', description: 'Sharp jokes about society, culture, and sacred cows.' },
  { slug: 'political-satire', name: 'Political Satire', description: 'The news, but funny. Punchlines across the aisle.' },
  { slug: 'improv', name: 'Improv', description: 'Made up on the spot from your suggestions. Never the same twice.' },
  { slug: 'roast', name: 'Roast', description: 'Consensual insults. Love hurts, hilariously.' },
  { slug: 'storytelling', name: 'Storytelling', description: 'Long-form true-ish tales with a killer ending.' },
  { slug: 'one-liners', name: 'One-liners', description: 'Maximum jokes per minute. Blink and you miss three.' },
  { slug: 'crowd-work', name: 'Crowd Work', description: 'The audience is the material. Front row, beware.' },
  { slug: 'cringe', name: 'Cringe', description: 'Glorious on-stage failure. You will laugh through your fingers.' },
  { slug: 'bilingual-tr-en', name: 'Bilingual TR-EN', description: 'Türkçe ve English karışık. Jokes that live between two languages.' },
];

export function categoryBySlug(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}
