import OpenAI from 'openai';
import { slugifyTag } from '../db/tags';

/** Live tagger: muse-spark-1.3 over the existing OpenAI-compatible client. */
export async function liveTags(title: string, description: string, categorySlug: string): Promise<string[]> {
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new Error('MODEL_API_KEY is not set');
  const client = new OpenAI({ baseURL: 'https://api.meta.ai/v1', apiKey: key });
  const res = await client.chat.completions.create({
    model: 'muse-spark-1.3',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'Tag a stand-up comedy show. Reply with JSON only: {"tags": ["tag1", ...]}. ' +
          'Return 3 to 6 short lowercase topic tags (1-2 words each) drawn from the title and ' +
          'description, e.g. "dating", "airports", "office-life". No hashtags, no category names.',
      },
      { role: 'user', content: `Title: ${title}\nDescription: ${description}\nCategory: ${categorySlug}` },
    ],
  });
  const content = res.choices[0]?.message?.content ?? '';
  const parsed = JSON.parse(content) as { tags?: unknown };
  if (!Array.isArray(parsed.tags)) throw new Error('tagger returned no tags');
  const slugs = parsed.tags
    .filter((t): t is string => typeof t === 'string')
    .map((t) => slugifyTag(t))
    .filter((t) => t.length > 0);
  return [...new Set(slugs)].slice(0, 6);
}
