/** Mock tagger: deterministic keyword rules. No network, no cost. */

const KEYWORDS: Array<{ tag: string; words: string[] }> = [
  { tag: 'family', words: ['mom', 'mother', 'dad', 'father', 'family', 'parents', 'mother-in-law', 'abuela'] },
  { tag: 'relationships', words: ['ex', 'boyfriend', 'girlfriend', 'wife', 'husband', 'dating', 'tinder', 'marriage', 'divorce', 'date'] },
  { tag: 'work', words: ['boss', 'office', 'job', 'meeting', 'productivity', 'startup', 'colleague', 'guru'] },
  { tag: 'food', words: ['pizza', 'coffee', 'kettle', 'restaurant', 'dinner', 'croissant', 'barista', 'drink', 'sourdough'] },
  { tag: 'travel', words: ['airport', 'flight', 'metro', 'taxi', 'traffic', 'hotel', 'queue', 'queueing'] },
  { tag: 'tech', words: ['phone', 'app', 'wifi', 'ai', 'robot', 'group chat', 'whatsapp', 'algorithm', 'messages'] },
  { tag: 'money', words: ['rent', 'landlord', 'bills', 'tax', 'price', 'cheap', 'expensive', 'mortgage'] },
  { tag: 'animals', words: ['dog', 'cat', 'pet', 'pigeon', 'squirrel', 'houseplant', 'houseplants'] },
  { tag: 'news', words: ['news', 'politics', 'election', 'president', 'headlines', 'politicians'] },
  { tag: 'everyday-life', words: ['everyday', 'morning', 'weather', 'small talk', 'neighbors', 'laundry'] },
];

const FILLERS = ['live-show', 'comedy-night', 'new-material'];

export function mockTags(title: string, description: string, categorySlug: string): string[] {
  const hay = `${title} ${description}`.toLowerCase();
  const out: string[] = [];
  for (const { tag, words } of KEYWORDS) {
    if (words.some((w) => hay.includes(w))) out.push(tag);
    if (out.length >= 5) break;
  }
  if (categorySlug && !out.includes(categorySlug)) out.push(categorySlug);
  for (const f of FILLERS) {
    if (out.length >= 3) break;
    out.push(f);
  }
  return [...new Set(out)].slice(0, 6);
}
