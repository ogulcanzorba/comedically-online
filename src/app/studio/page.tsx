import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/auth/get-session';
import { listShows } from '@/db/shows';
import { countByTier, salesByComedian } from '@/db/tickets';
import { formatCents, showStatus } from '@/lib/datetime';
import { LocalTime } from '@/components/LocalTime';
import { StudioTools } from '@/components/StudioTools';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Studio',
  description: 'Comedian dashboard: shows, tickets, and revenue.',
};

export default async function StudioDashboard() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/studio');
  if (user.role !== 'comedian') {
    // The studio layout already gates viewers; this is defense in depth.
    return (
      <main className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="font-serif text-3xl">403 — Comedians only</h1>
        <p className="mt-2 text-neutral-400">
          The studio is where comedians run their shows.{' '}
          <Link href="/register" className="underline">
            Register as comedian
          </Link>{' '}
          or{' '}
          <Link href="/" className="underline">
            browse shows
          </Link>
          .
        </p>
      </main>
    );
  }

  const shows = listShows({ comedianId: user.id });
  const upcoming = shows
    .filter((s) => showStatus(s.starts_at_utc, s.duration_min) !== 'ended')
    .slice(0, 5);
  const sales = salesByComedian(user.id);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="font-serif text-3xl">Studio</h1>
        <span className="text-sm text-neutral-400">Welcome back, {user.displayName}.</span>
        <span className="ml-auto flex flex-wrap gap-2">
          <Link
            href="/studio/shows/new"
            className="rounded-md bg-amber-300 px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-amber-200"
          >
            + Create show
          </Link>
          <Link
            href="/studio/shows"
            className="rounded-md bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400"
          >
            Prepare live show
          </Link>
        </span>
      </div>

      <section id="tools" aria-label="Tools" className="mt-8 scroll-mt-20">
        <h2 className="font-serif text-2xl">Tools</h2>
        <div className="mt-3">
          <StudioTools />
        </div>
      </section>

      <section aria-label="Revenue summary" className="mt-8 grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Shows', value: String(shows.length) },
          { label: 'Tickets sold (mock)', value: String(sales.sold) },
          { label: 'Mock revenue', value: formatCents(sales.revenueCents) },
        ].map((s) => (
          <div key={s.label} className="rounded-md border border-neutral-800 bg-neutral-900/60 p-4">
            <p className="font-serif text-3xl">{s.value}</p>
            <p className="text-sm text-neutral-400">{s.label}</p>
          </div>
        ))}
      </section>

      <section aria-label="Upcoming shows" className="mt-8">
        <div className="flex items-center gap-4">
          <h2 className="font-serif text-2xl">Upcoming shows</h2>
          <Link href="/studio/shows" className="ml-auto text-sm text-neutral-300 underline">
            Manage all shows
          </Link>
        </div>
        {upcoming.length === 0 && (
          <p className="mt-2 text-neutral-400">No upcoming shows. Create your first one above.</p>
        )}
        <ul className="mt-3 space-y-3">
          {upcoming.map((show) => {
            const sold = Object.values(countByTier(show.id)).reduce((n, c) => n + c, 0);
            return (
              <li key={show.id} className="flex flex-wrap items-center gap-3 rounded-md border border-neutral-800 bg-neutral-900/60 p-4">
                <div className="min-w-52 flex-1">
                  <p className="font-semibold">{show.title}</p>
                  <p className="text-sm text-neutral-400">
                    <LocalTime utc={show.starts_at_utc} /> · {sold} tickets
                  </p>
                </div>
                <Link
                  href={`/studio/shows/${show.id}/prepare`}
                  className="rounded-md bg-spotlight px-4 py-2 text-sm font-semibold text-ink hover:brightness-110"
                >
                  Prepare live show
                </Link>
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
      </section>
    </main>
  );
}
