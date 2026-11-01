import { mockTags } from './mock';
import { liveTags } from './live';

export type TagMode = 'mock' | 'live';

export function tagMode(): TagMode {
  return process.env.TAG_MODE === 'live' ? 'live' : 'mock';
}

/** 3–6 tag slugs for a show. Live failures fall back to mock (creation never breaks). */
export async function autoTag(title: string, description: string, categorySlug: string): Promise<string[]> {
  if (tagMode() === 'live') {
    try {
      const tags = await liveTags(title, description, categorySlug);
      if (tags.length >= 3) return tags;
      const extra = mockTags(title, description, categorySlug).filter((t) => !tags.includes(t));
      return [...tags, ...extra].slice(0, 6);
    } catch {
      // fall through to mock
    }
  }
  return mockTags(title, description, categorySlug);
}
