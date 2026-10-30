import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest): NextResponse {
  if (!req.cookies.get('comedically_unlocked')) {
    return NextResponse.redirect(new URL('/checkout', req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/watch'] };
