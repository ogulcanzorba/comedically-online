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

export function voiceUsdForMs(ms: number): number {
  return (ms / 3_600_000) * PRICING.voiceTranscribePerHourUsd;
}

export function samUsdForFrames(frames: number): number {
  return (frames / 1000) * PRICING.samVideoPerThousandFramesUsd;
}

export function sparkUsdForTokens(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * PRICING.sparkInputPerMillionTokensUsd +
    (outputTokens / 1_000_000) * PRICING.sparkOutputPerMillionTokensUsd
  );
}

/** Projected $/stream-hour from spend so far. */
export function projectedHourlyUsd(spentUsd: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return spentUsd / (elapsedMs / 3_600_000);
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
