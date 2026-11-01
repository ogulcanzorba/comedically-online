/** Pricing helper math. Assumptions are spelled out in the dashboard UI. */

export interface RevenueEstimate {
  grossCents: number;
  feeCents: number;
  payoutCents: number;
}

/** Gross, platform fee, and comedian payout for N tickets at an average price. */
export function revenueFor(tickets: number, avgPriceCents: number, feePct: number): RevenueEstimate {
  const grossCents = Math.round(tickets * avgPriceCents);
  const feeCents = Math.round((grossCents * feePct) / 100);
  return { grossCents, feeCents, payoutCents: grossCents - feeCents };
}

/**
 * Suggested Standard-tier range in cents, from simple venue-size analogs:
 * base by duration (bar set / club hour / long show / marathon), +20% on
 * Fri–Sun. VIP typically 2x Standard; Early Bird ~30% off.
 */
export function suggestedRange(durationMin: number, weekend: boolean): { low: number; high: number } {
  let low: number;
  let high: number;
  if (durationMin <= 30) {
    low = 500;
    high = 800;
  } else if (durationMin <= 60) {
    low = 900;
    high = 1500;
  } else if (durationMin <= 90) {
    low = 1200;
    high = 2000;
  } else {
    low = 1500;
    high = 2500;
  }
  if (weekend) {
    low = Math.round((low * 1.2) / 100) * 100;
    high = Math.round((high * 1.2) / 100) * 100;
  }
  return { low, high };
}
