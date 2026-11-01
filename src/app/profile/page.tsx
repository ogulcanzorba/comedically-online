import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/auth/get-session';
import { listTicketsByUser, salesByComedian } from '@/db/tickets';
import { listShows } from '@/db/shows';
import { formatCents, showStatus } from '@/lib/datetime';
import { LocalTime } from '@/components/LocalTime';
import { ProfileForm } from '@/components/ProfileForm';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'My profile',
  description: 'Your Comedically Online account, tickets, and stats.',
  alternates: { canonical: '/profile' },
};

export default async function ProfilePage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/profile');

  const tickets = user.role === 'viewer' ? listTicketsByUser(user.id) : [];
  const myShows = user.role === 'comedian' ? listShows({ comedianId: user.id }) : [];
  const sales = user.role === 'comedian' ? salesByComedian(user.id) : { sold: 0, revenueCents: 0 };

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="font-serif text-3xl">My profile</h1>

      <section aria-label="Account" className="mt-6 rounded-md border border-neutral-800 bg-neutral-900/60 p-5">
        <div className="flex items-center gap-3">
          <h2 className="font-serif text-xl">{user.displayName}</h2>
          <span className="rounded-full bg-neutral-700 px-2.5 py-0.5 text-xs capitalize text-neutral-200">
            {user.role}
          </span>
        </div>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-neutral-500">Email</dt><dd>{user.email}</dd></div>
          <div><dt className="text-neutral-500">Country</dt><dd>{user.country || '—'}</dd></div>
          <div className="sm:col-span-2"><dt className="text-neutral-500">Bio</dt><dd>{user.bio || '—'}</dd></div>
          {user.role === 'comedian' && (
            <>
              <div><dt className="text-neutral-500">Stage name</dt><dd>{user.stageName || '—'}</dd></div>
              <div><dt className="text-neutral-500">Styles</dt><dd>{user.comedyStyles.join(', ') || '—'}</dd></div>
            </>
          )}
        </dl>
      </section>

      <section aria-label="Edit profile" className="mt-6 rounded-md border border-neutral-800 bg-neutral-900/60 p-5">
        <h2 className="font-serif text-xl">Edit profile</h2>
        <div className="mt-3">
          <ProfileForm user={user} />
        </div>
      </section>

      {user.role === 'viewer' && (
        <section id="tickets" aria-label="My tickets" className="mt-6 scroll-mt-20">
          <h2 className="font-serif text-2xl">My tickets</h2>
          {tickets.length === 0 && (
            <p className="mt-2 text-neutral-400">
              No tickets yet.{' '}
              <Link href="/" className="underline">
                Browse shows
              </Link>
              .
            </p>
          )}
          <ul className="mt-3 space-y-3">
            {tickets.map((t) => {
              const live = showStatus(t.starts_at_utc, t.duration_min) === 'live';
              return (
                <li key={t.ticket_id} className="flex flex-wrap items-center gap-3 rounded-md border border-neutral-800 bg-neutral-900/60 p-4">
                  <div className="min-w-52 flex-1">
                    <p className="font-semibold">{t.show_title}</p>
                    <p className="text-sm text-neutral-400">
                      <LocalTime utc={t.starts_at_utc} /> · {t.tier}
                    </p>
                  </div>
                  {live ? (
                    <Link
                      href={`/shows/${t.show_slug}`}
                      className="rounded-md bg-red-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-400"
                    >
                      Watch
                    </Link>
                  ) : (
                    <Link href={`/shows/${t.show_slug}`} className="text-sm text-neutral-300 underline">
                      Details
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {user.role === 'comedian' && (
        <>
          <section aria-label="Public profile" className="mt-6">
            <h2 className="font-serif text-2xl">Public profile</h2>
            <p className="mt-2 text-sm text-neutral-300">
              <Link href={`/comedians/${user.id}`} className="underline">
                View your public profile
              </Link>{' '}
              — this is what viewers see.
            </p>
          </section>
          <section aria-label="Stats" className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              { label: 'Shows', value: String(myShows.length) },
              { label: 'Tickets sold', value: String(sales.sold) },
              { label: 'Mock revenue', value: formatCents(sales.revenueCents) },
            ].map((s) => (
              <div key={s.label} className="rounded-md border border-neutral-800 bg-neutral-900/60 p-4">
                <p className="font-serif text-3xl">{s.value}</p>
                <p className="text-sm text-neutral-400">{s.label}</p>
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
