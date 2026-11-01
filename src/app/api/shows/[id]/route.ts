import { NextRequest, NextResponse } from 'next/server';
import { getShowById, updateShow } from '@/db/shows';
import { getSessionUser } from '@/auth/get-session';
import { checkSameOrigin } from '@/auth/csrf';
import { localToUtcIso } from '@/lib/timezone';
import { validateShowPayload } from '../route';

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!checkSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: 'login required' }, { status: 401 });
  const { id } = await ctx.params;
  const show = getShowById(id);
  if (!show) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  if (show.comedian_id !== user.id) {
    return NextResponse.json({ ok: false, error: 'not your show' }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  const parsed = validateShowPayload(body as Record<string, unknown>);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  const v = parsed.value;
  const startsAtUtc = localToUtcIso(v.date, v.time, v.timezone);
  if (!startsAtUtc) return NextResponse.json({ ok: false, error: 'invalid start time' }, { status: 400 });
  const updated = updateShow(id, {
    title: v.title,
    description: v.description,
    startsAtUtc,
    durationMin: v.durationMin,
    categorySlug: v.categorySlug,
    timezone: v.timezone,
    tiers: v.tiers,
    thumbnailTheme: v.thumbnailTheme,
  });
  return NextResponse.json({ ok: true, show: updated });
}
