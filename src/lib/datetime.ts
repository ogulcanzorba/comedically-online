import type { Tier } from '../db/shows';

export type ShowStatus = 'upcoming' | 'live' | 'ended';

export function showStatus(startsAtUtc: string, durationMin: number, nowMs = Date.now()): ShowStatus {
  const start = Date.parse(startsAtUtc);
  if (Number.isNaN(start)) return 'upcoming';
  if (nowMs < start) return 'upcoming';
  if (nowMs < start + durationMin * 60_000) return 'live';
  return 'ended';
}

/** Cheapest tier price in cents, or null when no tiers. */
export function minPrice(tiers: Tier[]): number | null {
  if (tiers.length === 0) return null;
  return tiers.reduce((m, t) => Math.min(m, t.price_cents), Number.POSITIVE_INFINITY);
}

/** Sold out when every tier has a cap and every cap is reached. Uncapped tiers never sell out. */
export function isSoldOut(tiers: Tier[], sold: Record<string, number>): boolean {
  if (tiers.length === 0) return false;
  return tiers.every((t) => t.cap !== undefined && (sold[t.id] ?? 0) >= t.cap);
}

export function formatCents(cents: number): string {
  if (cents === 0) return 'Free';
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
