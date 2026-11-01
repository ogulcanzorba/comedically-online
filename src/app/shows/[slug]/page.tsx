import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getShowBySlug } from '@/db/shows';
import { findUserById } from '@/db/users';
import { countByTier, hasTicket } from '@/db/tickets';
import { getShowTags } from '@/db/tags';
import { categoryBySlug } from '@/data/categories';
import { getSessionUser } from '@/auth/get-session';
import { formatCents, isSoldOut, showStatus } from '@/lib/datetime';
import { ShowArt } from '@/components/ShowArt';
import { LocalTime } from '@/components/LocalTime';
import { Countdown } from '@/components/Countdown';
import { ShowPlayer } from '@/components/ShowPlayer';
import { TagChips } from '@/components/TagChips';

export const dynamic = 'force-dynamic';

export default async function ShowPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const show = getShowBySlug(slug);
  if (!show) notFound();
  const comedian = findUserById(show.comedian_id);
  const status = showStatus(show.starts_at_utc, show.duration_min);
  const sold = countByTier(show.id);
  const soldOut = isSoldOut(show.tiers, sold);
  const category = categoryBySlug(show.category_slug);
  const user = await getSessionUser();
  const ticketHeld = user ? hasTicket(user.id, show.id) : false;

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← All shows
      </Link>
      <div className="mt-4 overflow-hidden rounded-md border border-neutral-800">
        <ShowArt theme={show.thumbnail_theme} title={show.title} className="aspect-[16/6] w-full" />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        {category && (
          <span className="rounded-full bg-neutral-800 px-3 py-1 text-neutral-200">{category.name}</span>
        )}
        {status === 'live' && (
          <span className="rounded-full bg-red-500 px-3 py-1 text-xs font-bold text-white">● Live now</span>
        )}
        {soldOut && status !== 'ended' && (
          <span className="rounded-full bg-neutral-800 px-3 py-1 text-xs font-bold text-neutral-300">Sold out</span>
        )}
      </div>

      <h1 className="mt-3 font-serif text-4xl">{show.title}</h1>
      <p className="mt-1 text-neutral-400">
        by {comedian?.stage_name ?? comedian?.display_name ?? 'Unknown comic'}
        {comedian?.country ? ` · ${comedian.country}` : ''}
      </p>
      <p className="mt-2 text-lg">
        <LocalTime utc={show.starts_at_utc} variant="full" />{' '}
        <span className="text-sm text-neutral-500">(your time · {show.duration_min} min)</span>
      </p>

      {status === 'upcoming' && (
        <section aria-label="Countdown" className="mt-6 rounded-md border border-neutral-800 bg-neutral-900/60 p-6 text-center">
          <p className="text-sm text-neutral-400">The show starts in</p>
          <div className="mt-2">
            <Countdown targetUtc={show.starts_at_utc} />
          </div>
        </section>
      )}

      {status === 'live' && (
        <section aria-label="Watch live" className="mt-6">
          {ticketHeld ? (
            <ShowPlayer />
          ) : (
            <div className="rounded-md border border-amber-200/40 bg-amber-100/10 p-6">
              <p className="font-semibold text-amber-100">This show is live — grab a ticket to watch.</p>
              {!user && (
                <p className="mt-2 text-sm text-neutral-300">
                  <Link href={`/login?next=/shows/${show.slug}`} className="underline">
                    Log in
                  </Link>{' '}
                  or{' '}
                  <Link href="/register" className="underline">
                    join
                  </Link>{' '}
                  first (18+).
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {status === 'ended' && (
        <p className="mt-6 rounded-md border border-neutral-800 bg-neutral-900/60 p-4 text-neutral-300">
          This show has ended. The recording is on its way — check back soon.
        </p>
      )}

      <section aria-label="About this show" className="mt-8">
        <h2 className="font-serif text-2xl">About this show</h2>
        <p className="mt-2 whitespace-pre-line text-neutral-300">{show.description}</p>
      </section>

      <section aria-label="Comedian" className="mt-8 rounded-md border border-neutral-800 bg-neutral-900/60 p-5">
        <h2 className="font-serif text-xl">{comedian?.stage_name ?? comedian?.display_name}</h2>
        {comedian?.bio && <p className="mt-2 text-sm text-neutral-300">{comedian.bio}</p>}
      </section>

      <section aria-label="Tags" className="mt-8">
        <TagChips tags={getShowTags(show.id)} />
      </section>

      <section aria-label="Tickets" className="mt-8">
        <h2 className="font-serif text-2xl">Tickets</h2>
        {ticketHeld && (
          <p className="mt-3 rounded-md border border-emerald-400/40 bg-emerald-400/10 p-3 text-sm text-emerald-200">
            You&apos;re in — ticket held on your account.
          </p>
        )}
        <ul className="mt-3 space-y-3">
          {show.tiers.map((tier) => {
            const left = tier.cap === undefined ? null : tier.cap - (sold[tier.id] ?? 0);
            const tierSoldOut = left !== null && left <= 0;
            return (
              <li
                key={tier.id}
                className="flex flex-wrap items-center gap-3 rounded-md border border-neutral-800 bg-neutral-900/60 p-4"
              >
                <div className="min-w-40 flex-1">
                  <p className="font-semibold">{tier.name}</p>
                  <p className="text-sm text-neutral-400">
                    {tier.min_cents !== undefined ? (
                      <>Pay what you want (min {formatCents(tier.min_cents)})</>
                    ) : (
                      formatCents(tier.price_cents)
                    )}
                    {left !== null && !tierSoldOut && <span> · {left} left</span>}
                    {tierSoldOut && <span> · sold out</span>}
                  </p>
                </div>
                {!ticketHeld && !tierSoldOut && status !== 'ended' && (
                  <Link
                    href={`/checkout?show=${show.slug}&tier=${tier.id}`}
                    className="rounded-md bg-amber-300 px-5 py-2 text-sm font-semibold text-neutral-950 hover:bg-amber-200"
                  >
                    {tier.price_cents === 0 ? 'Claim free pass' : 'Buy ticket'}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
        {show.tiers.length === 0 && <p className="mt-3 text-neutral-400">Tickets coming soon.</p>}
      </section>
    </main>
  );
}
