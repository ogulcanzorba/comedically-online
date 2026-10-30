import type { Decision } from '../moderation/types';

/** Decisions for one 2s chunk, anchored at the video time its media starts. */
export interface DecisionWindow {
  t0: number;
  decisions: Decision[];
}

/** Decisions whose chunk-relative window contains `now` (video seconds). */
export function activeAt(windows: DecisionWindow[], now: number): Decision[] {
  const out: Decision[] = [];
  for (const w of windows) {
    for (const d of w.decisions) {
      const s = w.t0 + (d.startMs ?? 0) / 1000;
      const e = w.t0 + (d.endMs ?? 2000) / 1000;
      if (now >= s && now < e) out.push(d);
    }
  }
  return out;
}

/** Drop windows fully behind the playhead (plus a small grace period). */
export function pruneWindows(windows: DecisionWindow[], now: number): DecisionWindow[] {
  return windows.filter((w) => {
    const latest = w.decisions.reduce((m, d) => Math.max(m, (d.endMs ?? 2000) / 1000), 2);
    return w.t0 + latest > now - 5;
  });
}
