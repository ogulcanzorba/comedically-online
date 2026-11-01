import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/auth/get-session';
import { listShows } from '@/db/shows';
import { countByTier } from '@/db/tickets';
import { showStatus } from '@/lib/datetime';
import { LocalTime } from '@/components/LocalTime';

export const dynamic = 'force-dynamic';

export default async function MyShowsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/studio/shows');
  if (user.role !== 'comedian') {
    return (
      <main className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="font-serif text-3xl">Comedians only</h1>
        <p className="mt-2 text-neutral-400">
          This dashboard is for comedian accounts.{' '}
          <Link href="/" className="underline">
            Browse shows
          </Link>{' '}
          instead.
        </p>
      </main>
    );
  }
  const shows = listShows({ comedianId: user.id });
  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-center gap-4">
        <h1 className="font-serif text-3xl">My shows</h1>
        <Link
          href="/studio/shows/new"
          className="ml-auto rounded-md bg-amber-300 px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-amber-200"
        >
          + New show
        </Link>
      </div>
      <ul className="mt-6 space-y-3">
        {shows.map((show) => {
          const sold = Object.values(countByTier(show.id)).reduce((n, c) => n + c, 0);
          const status = showStatus(show.starts_at_utc, show.duration_min);
          return (
            <li key={show.id} className="flex flex-wrap items-center gap-3 rounded-md border border-neutral-800 bg-neutral-900/60 p-4">
              <div className="min-w-52 flex-1">
                <p className="font-semibold">{show.title}</p>
                <p className="text-sm text-neutral-400">
                  <LocalTime utc={show.starts_at_utc} /> · {status} · {sold} tickets
                </p>
              </div>
              <Link href={`/shows/${show.slug}`} className="text-sm text-neutral-300 underline">
                View
              </Link>
              <Link href={`/studio/shows/${show.id}`} className="text-sm text-neutral-300 underline">
                Edit
              </Link>
            </li>
          );
        })}
      </ul>
      {shows.length === 0 && <p className="mt-6 text-neutral-400">No shows yet. Create your first one above.</p>}
    </main>
  );
}
