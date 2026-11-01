import { NextRequest } from 'next/server';

/**
 * CSRF guard for cookie-authenticated mutations: the request must carry an
 * Origin or Referer header matching this host. Combined with SameSite=Lax
 * cookies, cross-site form/JS forgery is rejected with 403.
 */
export function checkSameOrigin(req: NextRequest): boolean {
  const host = req.headers.get('host');
  if (!host) return false;
  const expected = `${req.nextUrl.protocol}//${host}`;
  const origin = req.headers.get('origin');
  if (origin) return origin === expected;
  const referer = req.headers.get('referer');
  if (referer) return referer === expected || referer.startsWith(`${expected}/`);
  return false;
}
