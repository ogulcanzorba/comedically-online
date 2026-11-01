import { NextResponse } from 'next/server';
import { getShowBySlug } from '@/db/shows';
import { findUserById } from '@/db/users';
import { countByTier } from '@/db/tickets';

/** Public show info for the checkout page. */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const show = getShowBySlug(slug);
  if (!show) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  const comedian = findUserById(show.comedian_id);
  return NextResponse.json({
    ok: true,
    show: {
      id: show.id,
      slug: show.slug,
      title: show.title,
      starts_at_utc: show.starts_at_utc,
      duration_min: show.duration_min,
      tiers: show.tiers,
      comedian: comedian?.stage_name ?? comedian?.display_name ?? 'Unknown comic',
      sold: countByTier(show.id),
    },
  });
}
