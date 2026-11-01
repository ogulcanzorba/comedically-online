import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from './auth/cookie';

/**
 * Cookie-presence gate for studio + watch. Full session validity and
 * per-show ticket checks happen in server components/API routes (Node),
 * since middleware runs on the edge runtime without SQLite access.
 */
export function middleware(req: NextRequest): NextResponse {
  if (!req.cookies.get(SESSION_COOKIE)) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/studio/:path*'] };
