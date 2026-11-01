import Link from 'next/link';
import type { Tag } from '@/db/tags';

export function TagChips({ tags }: { tags: Tag[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" aria-label="Tags">
      {tags.map((t) => (
        <Link
          key={t.slug}
          href={`/search?q=${encodeURIComponent(t.slug)}`}
          className="rounded-full border border-neutral-700 px-2.5 py-0.5 text-xs text-neutral-300 hover:border-neutral-400"
        >
          #{t.label}
        </Link>
      ))}
    </div>
  );
}
