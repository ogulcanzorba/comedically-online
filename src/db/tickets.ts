import { randomUUID } from 'node:crypto';
import { getDb } from './client';

export interface TicketRow {
  id: string;
  show_id: string;
  user_id: string;
  tier: string;
  price_cents: number;
  order_ref: string;
  created_at: string;
}

export function createTicket(input: {
  id?: string;
  showId: string;
  userId: string;
  tier: string;
  priceCents: number;
  orderRef: string;
}): TicketRow {
  const row: TicketRow = {
    id: input.id ?? randomUUID(),
    show_id: input.showId,
    user_id: input.userId,
    tier: input.tier,
    price_cents: input.priceCents,
    order_ref: input.orderRef,
    created_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `INSERT INTO tickets(id, show_id, user_id, tier, price_cents, order_ref, created_at)
       VALUES(@id, @show_id, @user_id, @tier, @price_cents, @order_ref, @created_at)`,
    )
    .run(row);
  return row;
}

export function hasTicket(userId: string, showId: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 AS ok FROM tickets WHERE show_id = ? AND user_id = ? LIMIT 1')
    .get(showId, userId) as { ok: number } | undefined;
  return row !== undefined;
}

/** Sold count per tier id for one show. */
export function countByTier(showId: string): Record<string, number> {
  const rows = getDb()
    .prepare('SELECT tier, COUNT(*) AS n FROM tickets WHERE show_id = ? GROUP BY tier')
    .all(showId) as Array<{ tier: string; n: number }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.tier] = r.n;
  return out;
}

export function fakeOrderRef(): string {
  return `MOCK-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1296)
    .toString(36)
    .toUpperCase()
    .padStart(2, '0')}`;
}
