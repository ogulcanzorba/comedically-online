import { NextRequest, NextResponse } from 'next/server';

/**
 * MOCK checkout: no payment provider, no card data received or stored.
 * The client only sends the plan; card fields never leave the browser.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let plan: string = 'ticket';
  try {
    const body = (await req.json()) as { plan?: unknown };
    if (body.plan === 'sub') plan = 'sub';
  } catch {
    // malformed body defaults to a ticket
  }
  const res = NextResponse.json({ ok: true, plan });
  res.cookies.set('comedically_unlocked', plan, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: plan === 'sub' ? 30 * 24 * 3600 : 12 * 3600,
  });
  return res;
}
