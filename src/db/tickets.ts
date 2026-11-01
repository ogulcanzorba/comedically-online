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

export interface UserTicket {
  ticket_id: string;
  tier: string;
  price_cents: number;
  order_ref: string;
  show_id: string;
  show_slug: string;
  show_title: string;
  starts_at_utc: string;
  duration_min: number;
}

/** All tickets held by a user, newest show first, with show details. */
export function listTicketsByUser(userId: string): UserTicket[] {
  return getDb()
    .prepare(
      `SELECT t.id AS ticket_id, t.tier, t.price_cents, t.order_ref,
              s.id AS show_id, s.slug AS show_slug, s.title AS show_title,
              s.starts_at_utc, s.duration_min
       FROM tickets t JOIN shows s ON s.id = t.show_id
       WHERE t.user_id = ? ORDER BY s.starts_at_utc DESC`,
    )
    .all(userId) as UserTicket[];
}

/** Mock sales totals across all of a comedian's shows. */
export function salesByComedian(comedianId: string): { sold: number; revenueCents: number } {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS sold, COALESCE(SUM(t.price_cents), 0) AS revenue
       FROM tickets t JOIN shows s ON s.id = t.show_id
       WHERE s.comedian_id = ?`,
    )
    .get(comedianId) as { sold: number; revenue: number };
  return { sold: row.sold, revenueCents: row.revenue };
}

export function fakeOrderRef(): string {
  return `MOCK-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1296)
    .toString(36)
    .toUpperCase()
    .padStart(2, '0')}`;
}
