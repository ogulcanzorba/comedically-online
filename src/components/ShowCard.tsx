import Link from 'next/link';
import type { Show } from '@/db/shows';
import { categoryBySlug } from '@/data/categories';
import { formatCents, isSoldOut, minPrice, showStatus } from '@/lib/datetime';
import { ShowArt } from './ShowArt';
import { LocalTime } from './LocalTime';

export function ShowCard({
  show,
  comedianName,
  sold,
}: {
  show: Show;
  comedianName: string;
  sold: Record<string, number>;
}) {
  const status = showStatus(show.starts_at_utc, show.duration_min);
  const soldOut = isSoldOut(show.tiers, sold);
  const price = minPrice(show.tiers);
  const category = categoryBySlug(show.category_slug);
  return (
    <Link
      href={`/shows/${show.slug}`}
      className="group overflow-hidden rounded-md border border-neutral-800 bg-neutral-900/60 hover:border-neutral-600"
    >
      <div className="relative">
        <ShowArt theme={show.thumbnail_theme} title={show.title} className="aspect-video w-full" />
        {status === 'live' && (
          <span className="absolute left-2 top-2 rounded-full bg-red-500 px-2.5 py-0.5 text-xs font-bold text-white">
            ● Live now
          </span>
        )}
        {soldOut && status !== 'ended' && (
          <span className="absolute left-2 top-2 rounded-full bg-neutral-950/90 px-2.5 py-0.5 text-xs font-bold text-neutral-300">
            Sold out
          </span>
        )}
      </div>
      <div className="p-4">
        <p className="text-xs text-neutral-400">{comedianName}</p>
        <h3 className="mt-1 font-serif text-lg leading-snug group-hover:underline">{show.title}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {category && (
            <span className="rounded-full bg-neutral-800 px-2.5 py-0.5 text-neutral-300">{category.name}</span>
          )}
          <LocalTime utc={show.starts_at_utc} className="text-neutral-400" />
          <span className="ml-auto font-semibold text-amber-200">
            {price === null ? 'TBA' : formatCents(price)}
          </span>
        </div>
      </div>
    </Link>
  );
}
