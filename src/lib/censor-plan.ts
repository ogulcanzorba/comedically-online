import type { Decision, NormBox } from '../moderation/types';

/**
 * Censorship plan for the whole broadcast, in scene seconds (2s per chunk).
 * The same plan drives the overlay player (blur boxes + bleep mute) and the
 * censored download renderer, so the studio sees exactly what viewers saw.
 */
export interface CensorPlan {
  bleeps: Array<{ startS: number; endS: number }>;
  blurs: Array<{ startS: number; endS: number; box: NormBox }>;
  durationS: number;
}

const FULL_FRAME: NormBox = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Map every flagged chunk's decisions onto the broadcast timeline. Decisions
 * are chunk-relative ms; chunk N starts at N*2 scene seconds.
 */
export function planForBroadcast(
  events: Array<{ seq: number; decisions: Decision[] }>,
  durationS: number,
): CensorPlan {
  const bleeps: CensorPlan['bleeps'] = [];
  const blurs: CensorPlan['blurs'] = [];
  for (const { seq, decisions } of events) {
    const offsetS = seq * 2;
    for (const d of decisions) {
      if (d.action === 'bleep') {
        bleeps.push({
          startS: Math.max(0, offsetS + (d.startMs ?? 0) / 1000),
          endS: offsetS + (d.endMs ?? 2000) / 1000,
        });
      } else if (d.action === 'blur') {
        blurs.push({
          startS: Math.max(0, offsetS + (d.startMs ?? 0) / 1000),
          endS: offsetS + (d.endMs ?? 2000) / 1000,
          box: d.box ?? FULL_FRAME,
        });
      }
    }
  }
  return { bleeps, blurs, durationS: Math.max(0, durationS) };
}

export function isBleepedAt(plan: CensorPlan, tS: number): boolean {
  return plan.bleeps.some((b) => tS >= b.startS && tS < b.endS);
}

/** Scene seconds of a chunk-relative decision window (chunk N starts at N*2s). */
export function sceneRangeS(
  seq: number,
  startMs: number | undefined,
  endMs: number | undefined,
): { startS: number; endS: number } {
  const offsetS = seq * 2;
  return {
    startS: Math.max(0, offsetS + (startMs ?? 0) / 1000),
    endS: offsetS + (endMs ?? 2000) / 1000,
  };
}

/** "m:ss.s–m:ss.s" for a sub-chunk decision window (whole-chunk reads "m:ss–m:ss"). */
export function formatSceneRange(seq: number, startMs: number | undefined, endMs: number | undefined): string {
  const fmt = (tS: number): string => {
    const m = Math.floor(tS / 60);
    const s = Math.floor(tS % 60);
    const tenths = Math.floor((tS % 1) * 10);
    return tenths === 0
      ? `${m}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}.${tenths}`;
  };
  const { startS, endS } = sceneRangeS(seq, startMs, endMs);
  return `${fmt(startS)}–${fmt(endS)}`;
}

export function activeBlursAt(plan: CensorPlan, tS: number): NormBox[] {
  return plan.blurs.filter((b) => tS >= b.startS && tS < b.endS).map((b) => b.box);
}
