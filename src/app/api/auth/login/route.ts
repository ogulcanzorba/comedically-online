import { NextRequest, NextResponse } from 'next/server';
import { findUserByEmail, toPublic } from '@/db/users';
import { verifyPassword } from '@/auth/password';
import { SESSION_COOKIE, SESSION_TTL_MS } from '@/auth/cookie';
import { signSession } from '@/auth/session';
import { checkRateLimit } from '@/auth/rate-limit';
import { checkSameOrigin } from '@/auth/csrf';

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!checkSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!checkRateLimit(`login:${ip}`)) {
    return NextResponse.json({ ok: false, error: 'too many attempts, try again later' }, { status: 429 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid request' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  // NOTE: passwords are never logged. Failures log nothing user-identifying.
  const row = email ? findUserByEmail(email) : undefined;
  const ok = row ? await verifyPassword(password, row.password_hash) : false;
  if (!row || !ok) {
    return NextResponse.json({ ok: false, error: 'wrong email or password' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true, user: toPublic(row) });
  res.cookies.set(SESSION_COOKIE, signSession(row.id), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}
