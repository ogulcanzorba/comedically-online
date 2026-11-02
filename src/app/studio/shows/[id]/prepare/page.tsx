import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getSessionUser } from '@/auth/get-session';
import { getShowById } from '@/db/shows';
import { getAcceptance } from '@/db/acceptances';
import { RULEBOOK_RULES, RULEBOOK_VERSION, RULEBOOK_VERSION_HASH } from '@/moderation/rulebook';
import { RulebookAccept } from '@/components/RulebookAccept';
import { BroadcastStudio } from '@/components/BroadcastStudio';
import { ModerationPanels } from '@/components/ModerationFeed';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const show = getShowById(id);
  return { title: show ? `Prepare: ${show.title}` : 'Prepare live show' };
}

/** Pre-live page for one show. Camera rehearsal, acceptance, then broadcast. */
export default async function PreparePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const { id } = await params;
  const show = getShowById(id);
  if (!show || show.comedian_id !== user.id) notFound();
  const acceptance = getAcceptance(user.id);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <Link href="/studio/shows" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← My shows
      </Link>
      <h1 className="mt-2 font-serif text-3xl">Prepare: {show.title}</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Rehearse, accept the rulebook, then go live. Nothing here broadcasts.
      </p>
      <div className="mt-6" id="acceptance">
        <RulebookAccept
          rules={RULEBOOK_RULES}
          version={RULEBOOK_VERSION}
          versionHash={RULEBOOK_VERSION_HASH}
          accepted={acceptance ? { hash: acceptance.rulebook_hash, at: acceptance.accepted_at } : null}
        />
      </div>

      <section aria-label="Broadcast studio" className="mt-8 max-w-2xl">
        <div>
          <h2 className="font-serif text-xl">Self-view</h2>
          <p className="mb-2 text-sm text-neutral-500">
            Your camera, right now. “Go live now” starts the broadcast in place — the server
            re-checks your rulebook acceptance first. Viewers watch the delayed stream on the show
            page; nothing autoplays here.
          </p>
          <BroadcastStudio
            showId={show.id}
            accepted={acceptance?.rulebook_hash === RULEBOOK_VERSION_HASH}
          />
        </div>
      </section>

      <ModerationPanels showSlug={show.slug} />
    </main>
  );
}
