import { NextRequest, NextResponse } from 'next/server';
import { findUserById, toPublic, updateUser } from '@/db/users';
import { getSessionUser } from '@/auth/get-session';
import { checkSameOrigin } from '@/auth/csrf';

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  if (!checkSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: 'login required' }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const displayName = typeof b.displayName === 'string' ? b.displayName.trim() : undefined;
  const bio = typeof b.bio === 'string' ? b.bio.trim() : undefined;
  const country = typeof b.country === 'string' ? b.country.trim() : undefined;
  if (displayName !== undefined && (displayName.length < 1 || displayName.length > 60)) {
    return NextResponse.json({ ok: false, error: 'display name must be 1–60 characters' }, { status: 400 });
  }
  if (bio !== undefined && bio.length > 500) {
    return NextResponse.json({ ok: false, error: 'bio too long (max 500)' }, { status: 400 });
  }
  if (country !== undefined && country.length > 60) {
    return NextResponse.json({ ok: false, error: 'country too long' }, { status: 400 });
  }
  // Comedian-only fields are stored for comedians, ignored for viewers.
  let stageName: string | undefined;
  let comedyStyles: string[] | undefined;
  if (user.role === 'comedian') {
    stageName = typeof b.stageName === 'string' ? b.stageName.trim() : undefined;
    if (stageName !== undefined && stageName.length > 60) {
      return NextResponse.json({ ok: false, error: 'stage name too long' }, { status: 400 });
    }
    if (b.comedyStyles !== undefined) {
      if (!Array.isArray(b.comedyStyles)) {
        return NextResponse.json({ ok: false, error: 'comedyStyles must be an array' }, { status: 400 });
      }
      comedyStyles = (b.comedyStyles as unknown[])
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 8);
      if (comedyStyles.some((s) => s.length > 40)) {
        return NextResponse.json({ ok: false, error: 'style names too long' }, { status: 400 });
      }
    }
  }
  const updated = updateUser(user.id, {
    ...(displayName !== undefined ? { display_name: displayName } : {}),
    ...(bio !== undefined ? { bio: bio || null } : {}),
    ...(country !== undefined ? { country: country || null } : {}),
    ...(stageName !== undefined ? { stage_name: stageName || null } : {}),
    ...(comedyStyles !== undefined ? { comedy_styles: comedyStyles } : {}),
  });
  const row = updated ?? findUserById(user.id);
  if (!row) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true, user: toPublic(row) });
}
