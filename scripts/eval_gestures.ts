/**
 * Gesture backend eval: labelled 2s clips in, accuracy/latency/cost table out.
 *
 * Usage: npx tsx scripts/eval_gestures.ts <clips-dir> [--cap-usd 1]
 *
 * Clips are video files (.webm/.mp4, ~2s) named by label prefix:
 *   three_fingers_* -> expect hand-gesture-three
 *   nose_*          -> expect touching-nose
 *   hand_*          -> expect clean (hard negative: ordinary hands)
 *   none_*          -> expect clean
 *
 * Configs: sam | spark-minimal-320 | spark-minimal-640 | spark-low-640.
 * Spark runs without prev-chunk overlap here (clips are independent); the
 * relay overlaps in production. Hysteresis is not applied (per-chunk only).
 * Stops before estimated spend passes the cap (default $1).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectVisual } from '../src/moderation/detect-visual';

const THREE_ID = 'hand-gesture-three';
const NOSE_ID = 'touching-nose';

type Label = 'three' | 'nose' | 'hand' | 'none';

interface Config {
  name: string;
  backend: string;
  effort: string;
  width: string;
}

const CONFIGS: Config[] = [
  { name: 'sam', backend: 'sam', effort: 'minimal', width: '320' },
  { name: 'spark-minimal-320', backend: 'spark', effort: 'minimal', width: '320' },
  { name: 'spark-minimal-640', backend: 'spark', effort: 'minimal', width: '640' },
  { name: 'spark-low-640', backend: 'spark', effort: 'low', width: '640' },
];

function labelOf(file: string): Label | null {
  const base = file.toLowerCase();
  if (base.startsWith('three_fingers_')) return 'three';
  if (base.startsWith('nose_')) return 'nose';
  if (base.startsWith('hand_')) return 'hand';
  if (base.startsWith('none_')) return 'none';
  return null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  const capIdx = process.argv.indexOf('--cap-usd');
  const capUsd = capIdx >= 0 ? Number(process.argv[capIdx + 1] ?? 1) : 1;
  if (!dir) {
    console.error('usage: npx tsx scripts/eval_gestures.ts <clips-dir> [--cap-usd 1]');
    process.exit(2);
  }
  if (!process.env.MODEL_API_KEY) {
    console.error('MODEL_API_KEY is not set');
    process.exit(2);
  }
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => /\.(webm|mp4)$/i.test(f) && labelOf(f))
      .sort();
  } catch {
    console.error(`cannot read clips dir: ${dir}`);
    process.exit(2);
  }
  if (files.length === 0) {
    console.error(`no labelled clips in ${dir} (want three_fingers_|nose_|hand_|none_ prefix)`);
    process.exit(2);
  }
  console.log(`clips: ${files.length} from ${dir} (cap $${capUsd})`);

  let spentUsd = 0;
  let stoppedEarly = false;
  const rows: string[] = [];
  for (const cfg of CONFIGS) {
    process.env.VISION_BACKEND = cfg.backend;
    process.env.SPARK_VISION_EFFORT = cfg.effort;
    process.env.FRAME_WIDTH = cfg.width;
    const lat: number[] = [];
    let tokens = 0;
    let cfgCost = 0;
    let threeTotal = 0;
    let threeHit = 0;
    let noseTotal = 0;
    let noseHit = 0;
    let noneTotal = 0;
    let noneFp = 0;
    let handTotal = 0;
    let handFp = 0;
    let errors = 0;
    for (const file of files) {
      if (spentUsd >= capUsd) {
        stoppedEarly = true;
        break;
      }
      const label = labelOf(file) as Label;
      const video = readFileSync(join(dir, file));
      const t0 = Date.now();
      try {
        const res = await detectVisual(video, 0, 'live', []);
        lat.push(Date.now() - t0);
        spentUsd += res.costUsd;
        cfgCost += res.costUsd;
        const predicted = new Set(
          res.flags.map((f) => f.ruleId).filter((id): id is string => !!id),
        );
        if (res.visionDetail) tokens += res.visionDetail.inputTokens + res.visionDetail.outputTokens;
        if (label === 'three') {
          threeTotal += 1;
          if (predicted.has(THREE_ID)) threeHit += 1;
        } else if (label === 'nose') {
          noseTotal += 1;
          if (predicted.has(NOSE_ID)) noseHit += 1;
        } else if (label === 'none') {
          noneTotal += 1;
          if (predicted.size > 0) noneFp += 1;
        } else {
          handTotal += 1;
          if (predicted.size > 0) handFp += 1;
        }
      } catch (e) {
        errors += 1;
        lat.push(Date.now() - t0);
        console.log(`  [${cfg.name}] ${file}: ERROR ${e instanceof Error ? e.message : e}`);
      }
    }
    lat.sort((a, b) => a - b);
    const clipsRun = threeTotal + noseTotal + noneTotal + handTotal;
    const perHour = clipsRun > 0 ? (cfgCost / (clipsRun * 2)) * 3600 : 0;
    const pct = (n: number, d: number): string => (d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(0)}%`);
    rows.push(
      [
        cfg.name.padEnd(18),
        `n=${String(clipsRun).padStart(3)}`,
        `recall_three=${pct(threeHit, threeTotal).padStart(4)}`,
        `recall_nose=${pct(noseHit, noseTotal).padStart(4)}`,
        `fp_none=${pct(noneFp, noneTotal).padStart(4)}`,
        `fp_hand=${pct(handFp, handTotal).padStart(4)}`,
        `p50=${String(Math.round(percentile(lat, 50))).padStart(5)}ms`,
        `p95=${String(Math.round(percentile(lat, 95))).padStart(5)}ms`,
        `tok=${String(tokens).padStart(6)}`,
        `$${cfgCost.toFixed(4)}`,
        `~$${perHour.toFixed(2)}/h`,
        errors > 0 ? `ERR=${errors}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
    if (stoppedEarly) break;
  }
  console.log('');
  for (const r of rows) console.log(r);
  console.log('');
  console.log(`estimated spend: $${spentUsd.toFixed(4)}${stoppedEarly ? ' (STOPPED AT CAP)' : ''}`);
}

void main();
