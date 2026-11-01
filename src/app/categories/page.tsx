import Link from 'next/link';
import { CATEGORIES } from '@/data/categories';
import { listShows } from '@/db/shows';
import { CategoryIcon } from '@/components/CategoryIcon';

export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const counts = new Map<string, number>();
  for (const s of listShows()) counts.set(s.category_slug, (counts.get(s.category_slug) ?? 0) + 1);
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="font-serif text-4xl">Categories</h1>
      <p className="mt-2 text-neutral-400">Every flavor of funny, from crowd work to cringe.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CATEGORIES.map((c) => (
          <Link
            key={c.slug}
            href={`/categories/${c.slug}`}
            className="rounded-md border border-neutral-800 bg-neutral-900/60 p-5 hover:border-neutral-600"
          >
            <CategoryIcon slug={c.slug} className="h-8 w-8 text-amber-300" />
            <h2 className="mt-3 font-serif text-xl">{c.name}</h2>
            <p className="mt-1 text-sm text-neutral-400">{c.description}</p>
            <p className="mt-2 text-xs text-neutral-500">
              {counts.get(c.slug) ?? 0} show{(counts.get(c.slug) ?? 0) === 1 ? '' : 's'}
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
