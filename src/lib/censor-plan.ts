import type { Decision, NormBox } from '../moderation/types';

/**
 * Censorship plan for one violation clip, in clip-relative seconds. The same
 * plan drives the overlay player (blur boxes + bleep mute) and the censored
 * download renderer, so clips show exactly what viewers saw.
 */
export interface CensorPlan {
  bleeps: Array<{ startS: number; endS: number }>;
  blurs: Array<{ startS: number; endS: number; box: NormBox }>;
  durationS: number;
}

const FULL_FRAME: NormBox = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Map one flagged chunk's decisions onto its clip timeline. Decisions are
 * chunk-relative ms; the flagged window starts at centerSeq*2 scene seconds.
 */
export function planForClip(
  decisions: Decision[],
  clipStartS: number,
  centerSeq: number,
  clipEndS: number,
): CensorPlan {
  const offsetS = centerSeq * 2 - clipStartS;
  const bleeps: CensorPlan['bleeps'] = [];
  const blurs: CensorPlan['blurs'] = [];
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
  return { bleeps, blurs, durationS: Math.max(0, clipEndS - clipStartS) };
}

export function isBleepedAt(plan: CensorPlan, tS: number): boolean {
  return plan.bleeps.some((b) => tS >= b.startS && tS < b.endS);
}

export function activeBlursAt(plan: CensorPlan, tS: number): NormBox[] {
  return plan.blurs.filter((b) => tS >= b.startS && tS < b.endS).map((b) => b.box);
}
