import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/auth/get-session';
import { checkSameOrigin } from '@/auth/csrf';
import { hasValidAcceptance } from '@/db/acceptances';
import { getShowById } from '@/db/shows';
import { RULEBOOK_VERSION_HASH } from '@/moderation/rulebook';

/**
 * Server-side go-live gate. Refuses without a valid rulebook acceptance
 * for the current revision. The broadcast page must call this first.
 */
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
  const showId = (body as Record<string, unknown>).showId;
  if (typeof showId === 'string' && showId) {
    const show = getShowById(showId);
    if (!show) return NextResponse.json({ ok: false, error: 'show not found' }, { status: 404 });
    if (show.comedian_id !== user.id) {
      return NextResponse.json({ ok: false, error: 'not your show' }, { status: 403 });
    }
  }
  if (!hasValidAcceptance(user.id, RULEBOOK_VERSION_HASH)) {
    return NextResponse.json(
      { ok: false, code: 'rulebook-acceptance-required', hash: RULEBOOK_VERSION_HASH },
      { status: 403 },
    );
  }
  return NextResponse.json({ ok: true });
}
