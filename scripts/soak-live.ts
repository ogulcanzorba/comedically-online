/**
 * Live soak replay: feeds a DEBUG_CAPTURE directory back through the real
 * moderation pipeline at real-time pace (one 2s chunk every 2s).
 *
 *   DEBUG_CAPTURE=1 npm run dev   # capture a real broadcast to /tmp/chunks
 *   npm run soak:live             # replay it here (needs MODEL_API_KEY)
 *
 * Flags: --dir <path> (default /tmp/chunks), --limit <n>, --pool <n>.
 * Prints a per-chunk stage table plus first-vs-last trend summary.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Semaphore } from '../src/lib/semaphore';
import { SpendTracker } from '../src/moderation/cost';
import { moderateChunk } from '../src/moderation/index';

interface ManifestRow {
  seq: number;
  receivedAtMs: number;
  hasWav: boolean;
  hasJpg?: boolean;
}

function flag(name: string, fallback: string): string {
  const arg = process.argv.find((a) => a.startsWith(`${name}=`));
  if (arg) return arg.slice(name.length + 1);
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function loadManifest(dir: string): ManifestRow[] {
  const rows: ManifestRow[] = [];
  const manifest = join(dir, 'manifest.jsonl');
  if (existsSync(manifest)) {
    for (const line of readFileSync(manifest, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as ManifestRow;
      if (Number.isInteger(row.seq)) rows.push(row);
    }
    rows.sort((a, b) => a.seq - b.seq);
    return rows;
  }
  // Fallback: any chunkN.webm files, 2s spacing assumed.
  const now = Date.now();
  for (const f of readdirSync(dir)) {
    const m = /^chunk(\d+)\.webm$/.exec(f);
    if (m) {
      const seq = Number(m[1]);
      rows.push({ seq, receivedAtMs: now + seq * 2000, hasWav: existsSync(join(dir, `chunk${seq}.wav`)) });
    }
  }
  rows.sort((a, b) => a.seq - b.seq);
  return rows;
}

async function main(): Promise<void> {
  const dir = flag('--dir', '/tmp/chunks');
  const limit = Number(flag('--limit', '0'));
  const poolMax = Number(flag('--pool', '8'));
  if (!process.env.MODEL_API_KEY) {
    console.error('soak:live needs MODEL_API_KEY (live pipeline replay).');
    process.exit(1);
  }
  process.env.MODERATION_MODE = 'live';
  const rows = loadManifest(dir).slice(0, limit > 0 ? limit : undefined);
  if (rows.length === 0) {
    console.error(`soak:live: no chunks in ${dir} (run with DEBUG_CAPTURE=1 first).`);
    process.exit(1);
  }
  console.log(`soak:live: replaying ${rows.length} chunks from ${dir} at real-time pace (pool ${poolMax}).`);
  const tracker = new SpendTracker();
  const pool = new Semaphore(poolMax);
  let recent = '';
  const sams: number[] = [];
  const queues: number[] = [];
  let retried = 0;
  const run = async (row: ManifestRow): Promise<void> => {
    const release = await pool.acquire();
    const started = Date.now();
    try {
      const res = await moderateChunk({
        seq: row.seq,
        video: readFileSync(join(dir, `chunk${row.seq}.webm`)),
        wav: row.hasWav ? readFileSync(join(dir, `chunk${row.seq}.wav`)) : null,
        frameJpg: row.hasJpg ? readFileSync(join(dir, `chunk${row.seq}.jpg`)) : null,
        recentTranscript: recent,
        tracker,
        receivedAtMs: started,
      });
      if (res.transcriptText.trim()) recent = `${recent} ${res.transcriptText}`.slice(-2000);
      const t = res.debug.timingsMs;
      sams.push(t.samMs);
      queues.push(t.queueMs);
      const concepts = (res.debug.samBreakdown?.concepts ?? [])
        .map((c) => `${c.ruleId.split('-')[0]}:${c.boxes}/${c.ttfbMs}/${c.ms}/x${c.attempts}`)
        .join(' ');
      if ((res.debug.samBreakdown?.concepts ?? []).some((c) => c.attempts > 1)) retried += 1;
      const judgeShow = res.debug.judgeSkipped ? 'skip' : t.judgeMs > 0 ? `${t.judgeMs}` : 'n/a';
      console.log(
        `#${row.seq} q=${t.queueMs} src=${res.debug.samBreakdown?.source ?? '?'} ` +
          `extract=${res.debug.samBreakdown?.extractMs ?? '?'} ` +
          `voice=${t.voiceMs} sam=${t.samMs} judge=${judgeShow} ` +
          `act=${res.entry.action} +$${res.costUsd.toFixed(4)} [${concepts}]`,
      );
    } finally {
      release();
    }
  };
  const t0 = Date.now();
  const pending: Promise<void>[] = [];
  for (let i = 0; i < rows.length; i++) {
    const wait = t0 + i * 2000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    pending.push(run(rows[i]));
  }
  await Promise.all(pending);
  const avg = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const first = sams.slice(0, 20);
  const last = sams.slice(-20);
  console.log(
    `soak:live done: wall=${Date.now() - t0}ms total=$${tracker.totalUsd.toFixed(3)} ` +
      `samFirst20=${avg(first).toFixed(0)} samLast20=${avg(last).toFixed(0)} ` +
      `queueMax=${Math.max(0, ...queues)} chunksWithRetries=${retried}`,
  );
}

void main();
