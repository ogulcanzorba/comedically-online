import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getSessionUser } from '@/auth/get-session';
import { getShowById } from '@/db/shows';
import { utcToZonedInput } from '@/lib/timezone';
import { ShowForm } from '@/components/ShowForm';
import { RevenueCalculator } from '@/components/RevenueCalculator';

export const dynamic = 'force-dynamic';

export default async function EditShowPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const { id } = await params;
  const show = getShowById(id);
  if (!show || show.comedian_id !== user.id) notFound();
  const prefill = utcToZonedInput(show.starts_at_utc, show.timezone) ?? { date: '', time: '' };
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/studio/shows" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← My shows
      </Link>
      <h1 className="mt-2 font-serif text-3xl">Edit show</h1>
      <div className="mt-6">
        <ShowForm
          showId={show.id}
          initial={{
            title: show.title,
            description: show.description,
            date: prefill.date,
            time: prefill.time,
            timezone: show.timezone,
            durationMin: show.duration_min,
            categorySlug: show.category_slug,
            tiers: show.tiers,
            thumbnailTheme: show.thumbnail_theme,
          }}
        />
      </div>
      <div className="mt-8">
        <RevenueCalculator />
      </div>
    </main>
  );
}
