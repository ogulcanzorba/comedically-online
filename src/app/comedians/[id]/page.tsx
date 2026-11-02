import { notFound } from 'next/navigation';
import { findUserById } from '@/db/users';
import { listShows } from '@/db/shows';
import { countByTier } from '@/db/tickets';
import { ShowCard } from '@/components/ShowCard';
import { getSessionUser } from '@/auth/get-session';
import { isShowOwner } from '@/lib/show-access';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const comedian = findUserById(id);
  if (!comedian || comedian.role !== 'comedian') return { title: 'Comedian not found' };
  return {
    title: comedian.stage_name ?? comedian.display_name,
    description: comedian.bio ?? `Stand-up comedian on Comedically Online.`,
    alternates: { canonical: `/comedians/${id}` },
  };
}

export default async function ComedianPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const comedian = findUserById(id);
  if (!comedian || comedian.role !== 'comedian') notFound();
  const shows = listShows({ comedianId: id });
  const user = await getSessionUser();
  let styles: string[] = [];
  try {
    const parsed: unknown = JSON.parse(comedian.comedy_styles ?? '[]');
    if (Array.isArray(parsed)) styles = parsed.filter((s): s is string => typeof s === 'string');
  } catch {
    styles = [];
  }
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <p className="text-sm text-neutral-500">Comedian{comedian.country ? ` · ${comedian.country}` : ''}</p>
      <h1 className="mt-1 font-serif text-4xl">{comedian.stage_name ?? comedian.display_name}</h1>
      {comedian.bio && <p className="mt-3 max-w-2xl text-neutral-300">{comedian.bio}</p>}
      {styles.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {styles.map((s) => (
            <span key={s} className="rounded-full bg-neutral-800 px-2.5 py-0.5 text-xs text-neutral-300">
              {s}
            </span>
          ))}
        </div>
      )}
      <h2 className="mt-8 font-serif text-2xl">Shows</h2>
      <section aria-label="Shows by this comedian" className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {shows.map((show) => (
          <ShowCard
            key={show.id}
            show={show}
            comedianName={comedian.stage_name ?? comedian.display_name}
            sold={countByTier(show.id)}
            isOwner={isShowOwner(user?.id, show)}
          />
        ))}
      </section>
      {shows.length === 0 && <p className="mt-4 text-neutral-400">No shows yet.</p>}
    </main>
  );
}
