import { searchShows } from '@/db/shows';
import { findUserById } from '@/db/users';
import { countByTier } from '@/db/tickets';
import { ShowCard } from '@/components/ShowCard';

export const dynamic = 'force-dynamic';

export default async function SearchPage({ searchParams }: { searchParams?: Promise<{ q?: string }> }) {
  const q = ((await searchParams)?.q ?? '').trim();
  const results = q ? searchShows(q) : [];
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="font-serif text-4xl">Search</h1>
      <form method="GET" className="mt-4 flex gap-3" role="search">
        <label className="sr-only" htmlFor="sq">
          Search shows and tags
        </label>
        <input
          id="sq"
          name="q"
          defaultValue={q}
          placeholder="Try family, airports, roast…"
          className="min-w-52 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm"
        />
        <button type="submit" className="rounded-md border border-neutral-600 px-5 py-2 text-sm hover:border-neutral-400">
          Search
        </button>
      </form>
      {q && (
        <p className="mt-4 text-sm text-neutral-400">
          {results.length} result{results.length === 1 ? '' : 's'} for “{q}” (titles, descriptions, tags)
        </p>
      )}
      <section aria-label="Results" className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((show) => (
          <ShowCard
            key={show.id}
            show={show}
            comedianName={findUserById(show.comedian_id)?.stage_name ?? 'Unknown comic'}
            sold={countByTier(show.id)}
          />
        ))}
      </section>
    </main>
  );
}
