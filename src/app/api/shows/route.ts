import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createShow, type Tier } from '@/db/shows';
import { getSessionUser } from '@/auth/get-session';
import { checkSameOrigin } from '@/auth/csrf';
import { localToUtcIso } from '@/lib/timezone';
import { categoryBySlug } from '@/data/categories';
import { THEMES } from '@/data/themes';
import { setShowTags } from '@/db/tags';
import { autoTag } from '@/tags/index';

/** Shared show-payload validation for create + update. */
export interface ShowPayload {
  title: string;
  description: string;
  date: string;
  time: string;
  timezone: string;
  durationMin: number;
  categorySlug: string;
  tiers: Tier[];
  thumbnailTheme: string;
}

export function validateShowPayload(b: Record<string, unknown>): { ok: true; value: ShowPayload } | { ok: false; error: string } {
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  const description = typeof b.description === 'string' ? b.description.trim() : '';
  const date = typeof b.date === 'string' ? b.date : '';
  const time = typeof b.time === 'string' ? b.time : '';
  const timezone = typeof b.timezone === 'string' ? b.timezone : '';
  const durationMin = typeof b.durationMin === 'number' ? b.durationMin : Number.NaN;
  const categorySlug = typeof b.categorySlug === 'string' ? b.categorySlug : '';
  const thumbnailTheme = typeof b.thumbnailTheme === 'string' ? b.thumbnailTheme : '';

  if (title.length < 3 || title.length > 100) return { ok: false, error: 'title must be 3–100 characters' };
  if (description.length > 2000) return { ok: false, error: 'description too long (max 2000)' };
  if (!localToUtcIso(date, time, timezone)) return { ok: false, error: 'invalid date, time, or time zone' };
  if (!Number.isInteger(durationMin) || durationMin < 15 || durationMin > 480) {
    return { ok: false, error: 'duration must be 15–480 minutes' };
  }
  if (!categoryBySlug(categorySlug)) return { ok: false, error: 'unknown category' };
  if (!THEMES.some((t) => t.id === thumbnailTheme)) return { ok: false, error: 'unknown thumbnail theme' };

  const rawTiers = Array.isArray(b.tiers) ? b.tiers : [];
  if (rawTiers.length > 6) return { ok: false, error: 'at most 6 tiers' };
  const tiers: Tier[] = [];
  const ids = new Set<string>();
  for (const raw of rawTiers) {
    const t = raw as Record<string, unknown>;
    const id = typeof t.id === 'string' ? t.id.trim().toLowerCase() : '';
    const name = typeof t.name === 'string' ? t.name.trim() : '';
    const price = typeof t.price_cents === 'number' ? t.price_cents : Number.NaN;
    const min = t.min_cents === undefined || t.min_cents === null ? undefined : Number(t.min_cents);
    const cap = t.cap === undefined || t.cap === null || t.cap === '' ? undefined : Number(t.cap);
    if (!/^[a-z0-9-]{1,32}$/.test(id) || ids.has(id)) return { ok: false, error: 'tier ids must be unique slugs' };
    if (!name || name.length > 40) return { ok: false, error: 'tier names required (max 40)' };
    if (!Number.isInteger(price) || price < 0 || price > 1_000_000) return { ok: false, error: 'tier price invalid' };
    if (min !== undefined && (!Number.isInteger(min) || min < 0 || min > price)) {
      return { ok: false, error: 'pay-what-you-want minimum invalid' };
    }
    if (cap !== undefined && (!Number.isInteger(cap) || cap < 1 || cap > 100_000)) {
      return { ok: false, error: 'tier cap invalid' };
    }
    ids.add(id);
    tiers.push({ id, name, price_cents: price, ...(min !== undefined ? { min_cents: min } : {}), ...(cap !== undefined ? { cap } : {}) });
  }
  return { ok: true, value: { title, description, date, time, timezone, durationMin, categorySlug, tiers, thumbnailTheme } };
}

export function slugifyTitle(title: string): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'show';
  return `${base}-${randomBytes(2).toString('hex')}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!checkSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: 'login required' }, { status: 401 });
  if (user.role !== 'comedian') {
    return NextResponse.json({ ok: false, error: 'comedians only' }, { status: 403 });
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
  const show = createShow({
    slug: slugifyTitle(v.title),
    comedianId: user.id,
    title: v.title,
    description: v.description,
    startsAtUtc,
    durationMin: v.durationMin,
    categorySlug: v.categorySlug,
    timezone: v.timezone,
    tiers: v.tiers,
    thumbnailTheme: v.thumbnailTheme,
  });
  setShowTags(show.id, [v.categorySlug], 'category');
  try {
    setShowTags(show.id, await autoTag(v.title, v.description, v.categorySlug), 'auto');
  } catch {
    // tagging must never break show creation
  }
  return NextResponse.json({ ok: true, show });
}
