/** Pricing in USD, supplied by the project owner. */
export const PRICING = {
  voiceTranscribePerHourUsd: 0.18,
  samVideoPerThousandFramesUsd: 0.2,
  sparkInputPerMillionTokensUsd: 1.25,
  sparkOutputPerMillionTokensUsd: 4.25,
} as const;

/** Hard spend cap per stream (USD). Overriding via env is allowed for rehearsal. */
export function maxSpendUsd(): number {
  const raw = Number(process.env.MAX_SPEND_USD ?? 5);
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
}

export class SpendTracker {
  private total = 0;

  add(usd: number): void {
    if (usd > 0) this.total += usd;
  }

  get totalUsd(): number {
    return this.total;
  }

  get capped(): boolean {
    return this.total >= maxSpendUsd();
  }
}
