import Link from 'next/link';
import { listShows } from '@/db/shows';
import { findUserById } from '@/db/users';
import { countByTier } from '@/db/tickets';
import { CATEGORIES } from '@/data/categories';
import { ShowCard } from '@/components/ShowCard';
import { JsonLd, siteUrl } from '@/components/JsonLd';
import { getSessionUser } from '@/auth/get-session';

export const dynamic = 'force-dynamic';

export const metadata = {
  alternates: { canonical: '/' },
};

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<{ category?: string; q?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const category = params.category ?? '';
  const q = (params.q ?? '').trim();
  const shows = listShows({ category: category || undefined, q: q || undefined });
  const user = await getSessionUser();

  const base = siteUrl();
  return (
    <main className="relative">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'Comedically Online',
          url: base,
          logo: `${base}/icon.svg`,
        }}
      />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: 'Comedically Online',
          url: base,
          potentialAction: {
            '@type': 'SearchAction',
            target: `${base}/search?q={query}`,
          },
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-96"
        style={{
          background:
            'radial-gradient(ellipse 60% 45% at 50% -5%, rgba(255, 214, 140, 0.22), transparent 70%)',
        }}
      />
      <div className="relative mx-auto max-w-5xl px-6 pb-16">
        <p className="mt-8 inline-flex w-fit items-center gap-2 rounded-full border border-amber-200/30 bg-amber-100/10 px-3 py-1 text-xs text-amber-100">
          Test build: demo video coming soon
        </p>
        <h1 className="mt-4 font-serif text-5xl leading-tight">
          Live comedy.
          <br />
          <span className="text-neutral-300">Moderated by someone who gets the joke.</span>
        </h1>
        <p className="mt-4 max-w-xl text-neutral-400">
          One stage per show, ten seconds of broadcast delay. Pick a show, grab a (mock) ticket,
          and watch the jokes land.
        </p>
        {user?.role === 'comedian' ? (
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/studio"
              className="rounded-md bg-amber-300 px-6 py-3 font-semibold text-neutral-950 hover:bg-amber-200"
            >
              Open your Studio
            </Link>
            <Link
              href="/studio/shows"
              className="rounded-md border border-neutral-600 px-6 py-3 font-semibold text-neutral-100 hover:border-neutral-400"
            >
              Prepare a live show
            </Link>
          </div>
        ) : user ? (
          <div className="mt-6">
            <div className="flex flex-wrap gap-3">
              <Link
                href="/shows/demo-night"
                className="rounded-md bg-amber-300 px-6 py-3 font-semibold text-neutral-950 hover:bg-amber-200"
              >
                Watch Demo Night free
              </Link>
              <Link
                href="#shows"
                className="rounded-md border border-neutral-600 px-6 py-3 font-semibold text-neutral-100 hover:border-neutral-400"
              >
                Browse shows
              </Link>
            </div>
            <p className="mt-3 text-sm text-neutral-500">
              Funny yourself?{' '}
              <Link href="/register" className="underline hover:text-neutral-300">
                Become a comedian
              </Link>
            </p>
          </div>
        ) : (
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/shows/demo-night"
              className="rounded-md bg-amber-300 px-6 py-3 font-semibold text-neutral-950 hover:bg-amber-200"
            >
              Watch Demo Night free
            </Link>
            <Link
              href="/register"
              className="rounded-md border border-neutral-600 px-6 py-3 font-semibold text-neutral-100 hover:border-neutral-400"
            >
              Go live as a comedian
            </Link>
          </div>
        )}

        <form method="GET" className="mt-12 flex flex-wrap gap-3" role="search">
          <label className="sr-only" htmlFor="q">
            Search shows
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder="Search shows…"
            className="min-w-52 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm"
          />
          <label className="sr-only" htmlFor="category">
            Filter by category
          </label>
          <select
            id="category"
            name="category"
            defaultValue={category}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm"
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-md border border-neutral-600 px-5 py-2 text-sm hover:border-neutral-400">
            Filter
          </button>
        </form>

        <section id="shows" aria-label="Shows" className="mt-6 grid scroll-mt-20 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shows.map((show) => (
            <ShowCard
              key={show.id}
              show={show}
              comedianName={findUserById(show.comedian_id)?.stage_name ?? 'Unknown comic'}
              sold={countByTier(show.id)}
            />
          ))}
        </section>
        {shows.length === 0 && (
          <p className="mt-8 text-neutral-400">
            No shows match. Try another search — or run <code>npm run seed</code> if the DB is empty.
          </p>
        )}
      </div>
    </main>
  );
}
