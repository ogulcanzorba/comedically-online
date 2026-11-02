import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/auth/get-session';
import { checkSameOrigin } from '@/auth/csrf';
import { recordAcceptance } from '@/db/acceptances';
import { RULEBOOK_VERSION_HASH } from '@/moderation/rulebook';

/** Record rulebook acceptance. Only the current revision hash is accepted. */
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
  const hash = (body as Record<string, unknown>).hash;
  if (hash !== RULEBOOK_VERSION_HASH) {
    return NextResponse.json({ ok: false, error: 'stale rulebook revision' }, { status: 400 });
  }
  const acceptance = recordAcceptance(user.id, RULEBOOK_VERSION_HASH);
  return NextResponse.json({ ok: true, hash: acceptance.rulebook_hash, at: acceptance.accepted_at });
}
