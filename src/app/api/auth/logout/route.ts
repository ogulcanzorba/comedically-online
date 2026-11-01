import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/auth/cookie';
import { checkSameOrigin } from '@/auth/csrf';

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!checkSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
