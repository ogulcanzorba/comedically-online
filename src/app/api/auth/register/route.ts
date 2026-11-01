import { NextRequest, NextResponse } from 'next/server';
import { createUser, findUserByEmail, toPublic, type UserRole } from '@/db/users';
import { hashPassword } from '@/auth/password';
import { SESSION_COOKIE, SESSION_TTL_MS } from '@/auth/cookie';
import { signSession } from '@/auth/session';
import { checkSameOrigin } from '@/auth/csrf';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function bad(message: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!checkSameOrigin(req)) return bad('forbidden', 403);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return bad('invalid JSON');
  }
  const b = body as Record<string, unknown>;
  const role = b.role === 'comedian' || b.role === 'viewer' ? (b.role as UserRole) : null;
  const email = typeof b.email === 'string' ? b.email.trim() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  const displayName = typeof b.displayName === 'string' ? b.displayName.trim() : '';
  const stageName = typeof b.stageName === 'string' ? b.stageName.trim() : '';
  const bio = typeof b.bio === 'string' ? b.bio.trim() : '';
  const country = typeof b.country === 'string' ? b.country.trim() : '';
  const styles = Array.isArray(b.comedyStyles)
    ? (b.comedyStyles as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 8)
    : [];

  if (!role) return bad('choose a role: viewer or comedian');
  if (!EMAIL_RE.test(email) || email.length > 120) return bad('enter a valid email');
  if (password.length < 8 || password.length > 128) return bad('password must be 8+ characters');
  if (!displayName || displayName.length > 60) return bad('display name is required (max 60)');
  if (b.ageConfirmed !== true) return bad('you must confirm you are 18+');
  if (stageName.length > 60) return bad('stage name too long');
  if (bio.length > 500) return bad('bio too long (max 500)');
  if (country.length > 60) return bad('country too long');
  if (findUserByEmail(email)) return bad('that email is already registered', 409);

  // NOTE: passwords are hashed and never logged.
  const row = createUser({
    role,
    email,
    passwordHash: await hashPassword(password),
    displayName,
    stageName: role === 'comedian' && stageName ? stageName : null,
    bio: bio || null,
    comedyStyles: styles.map((s) => s.trim()).filter(Boolean),
    country: country || null,
  });
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
