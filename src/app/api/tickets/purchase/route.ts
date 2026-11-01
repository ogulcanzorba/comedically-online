import { NextRequest, NextResponse } from 'next/server';
import { getShowById } from '@/db/shows';
import { countByTier, createTicket, fakeOrderRef, hasTicket } from '@/db/tickets';
import { getSessionUser } from '@/auth/get-session';
import { checkSameOrigin } from '@/auth/csrf';
import { showStatus } from '@/lib/datetime';

/**
 * MOCK purchase: no payment provider involved. Issues a ticket row with a
 * fake order reference. Card details are never sent here (or anywhere).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
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
  const showId = typeof b.showId === 'string' ? b.showId : '';
  const tierId = typeof b.tierId === 'string' ? b.tierId : '';
  const show = showId ? getShowById(showId) : undefined;
  if (!show) return NextResponse.json({ ok: false, error: 'show not found' }, { status: 404 });
  if (showStatus(show.starts_at_utc, show.duration_min) === 'ended') {
    return NextResponse.json({ ok: false, error: 'show has ended' }, { status: 400 });
  }
  const tier = show.tiers.find((t) => t.id === tierId);
  if (!tier) return NextResponse.json({ ok: false, error: 'tier not found' }, { status: 400 });
  if (hasTicket(user.id, show.id)) {
    return NextResponse.json({ ok: false, error: 'ticket already held' }, { status: 409 });
  }
  const sold = countByTier(show.id)[tier.id] ?? 0;
  if (tier.cap !== undefined && sold >= tier.cap) {
    return NextResponse.json({ ok: false, error: 'tier sold out' }, { status: 409 });
  }
  let priceCents = tier.price_cents;
  if (tier.min_cents !== undefined) {
    const amount = typeof b.amountCents === 'number' ? b.amountCents : Number.NaN;
    if (!Number.isInteger(amount) || amount < tier.min_cents || amount > 1_000_000) {
      return NextResponse.json({ ok: false, error: `amount must be at least ${tier.min_cents}c` }, { status: 400 });
    }
    priceCents = amount;
  }
  const ticket = createTicket({
    showId: show.id,
    userId: user.id,
    tier: tier.id,
    priceCents,
    orderRef: fakeOrderRef(),
  });
  return NextResponse.json({ ok: true, orderRef: ticket.order_ref, slug: show.slug });
}
