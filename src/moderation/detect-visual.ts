import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import OpenAI from 'openai';
import type {
  GateBreakdown,
  ModerationMode,
  NormBox,
  SamBreakdown,
  SamConceptDebug,
  VisionBreakdown,
  VisualFlag,
} from './types';
import { videoBlurRules } from './rulebook';
import { samUsdForImages } from './cost';
import { samImageTimeoutMs, startTimeout } from './timeout';
import { extractSampleJpegs } from './transcode';
import { gateFrames, pickGateIndices, runGate } from './gate';
import { runSparkVision, sparkVisionEffort, sparkVisionModel } from './spark-vision';

const SAM_MODEL = 'sam-3.1';
/** Each moderation chunk is 2s of media. */
const CHUNK_MS = 2000;
/** An image hit blurs the frame time ±1s. */
const IMAGE_PAD_MS = 1000;

export interface ParsedRecord {
  frame: number;
  id: number;
  box: NormBox;
  confidence?: number;
}

/** Default frames sampled per chunk (browser capture + server fallback). */
export const DEFAULT_FRAMES_PER_CHUNK = 4;

/**
 * Frames sampled per chunk for SAM image calls. More frames catch briefer
 * gestures at linear image cost; wall latency stays flat since every
 * frame×rule call runs in parallel.
 */
export function framesPerChunk(): number {
  const raw = Number(process.env.FRAMES_PER_CHUNK ?? DEFAULT_FRAMES_PER_CHUNK);
  return Number.isInteger(raw) && raw >= 1 && raw <= 8 ? raw : DEFAULT_FRAMES_PER_CHUNK;
}

/** Chunk-relative sample times (ms) for `count` evenly spaced frames. */
export function sampleTimesMs(count: number): number[] {
  const n = Math.max(1, Math.floor(count) || 1);
  return Array.from({ length: n }, (_, i) => ((i + 0.5) * CHUNK_MS) / n);
}

/**
 * Live visual strategy. `gate` (default) classifies sampled frames with one
 * Spark VLM call each (~2s, ~$0.0007); `sam` runs SAM segmentation per
 * concept per frame (~8s each, misses small targets). Mock mode ignores this.
 * @deprecated Prefer VISION_BACKEND; kept as a fallback alias.
 */
export function visualStrategy(): 'gate' | 'sam' {
  return process.env.VISUAL_STRATEGY === 'sam' ? 'sam' : 'gate';
}

/**
 * Live vision backend. `spark` (default) classifies last-2-prev + current
 * frames with ONE Responses API call; `sam` runs legacy segmentation;
 * `gate` keeps the one-call-per-frame classifier. Unset falls back to the
 * legacy VISUAL_STRATEGY alias. Mock mode ignores this.
 */
export function visionBackend(): 'spark' | 'sam' | 'gate' {
  const raw = (process.env.VISION_BACKEND ?? '').trim().toLowerCase();
  if (raw === 'sam' || raw === 'gate' || raw === 'spark') return raw;
  if (process.env.VISION_BACKEND) return 'spark';
  if (process.env.VISUAL_STRATEGY) return visualStrategy();
  return 'spark';
}

/** Debug dir for sampled JPEGs when DEBUG_FRAMES=1, else null. */
export function debugFramesDir(): string | null {
  return process.env.DEBUG_FRAMES === '1' ? join(process.cwd(), 'debug-frames') : null;
}

/**
 * Parse SAM 3.1 output_text lines into normalized boxes.
 * Line shape: <Nf>id<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..[;c=..]|>...
 * Confidence (c=) is present only when requested via metadata; parsing stays
 * backward compatible with responses that omit it.
 */
export function parseSamOutput(text: string): ParsedRecord[] {
  const records: ParsedRecord[] = [];
  const frameRe = /<(\d+)f>((?:\d+<\|box;[^|]*\|>(?:<\|mask;[^|]*\|>)?,?)*)/g;
  const boxRe =
    /(\d+)<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)(?:;c=([\d.]+))?/g;
  for (const frameMatch of text.matchAll(frameRe)) {
    const frame = Number(frameMatch[1]);
    const body = frameMatch[2];
    for (const boxMatch of body.matchAll(boxRe)) {
      const [, id, x1, y1, x2, y2, w, h] = boxMatch.map(Number);
      if (!w || !h) continue;
      const confRaw = boxMatch[8];
      const confidence = confRaw === undefined ? NaN : Number(confRaw);
      records.push({
        frame,
        id,
        box: { x: x1 / w, y: y1 / h, w: (x2 - x1) / w, h: (y2 - y1) / h },
        ...(Number.isFinite(confidence) ? { confidence } : {}),
      });
    }
  }
  return records;
}

/** Mean confidence over records that report one, else null. */
export function meanConfidence(records: ParsedRecord[]): number | null {
  const values = records.map((r) => r.confidence).filter((c): c is number => typeof c === 'number');
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** One concept per SAM request, drawn from the rulebook's video rules. */
export function conceptsFromRulebook(): Array<{ concept: string; ruleId: string }> {
  return videoBlurRules().map((r) => ({ concept: r.match, ruleId: r.id }));
}

function requireKey(): string {
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new Error('MODEL_API_KEY is not set');
  return key;
}

/** Billing truth from the SAM response; absent when the SDK hides it. */
interface SamUsage {
  videoFramesProcessed?: number;
  imagesProcessed?: number;
}

async function segmentImage(
  concept: string,
  imageUrl: string,
): Promise<{
  records: ParsedRecord[];
  frames: number;
  usage: SamUsage | null;
  ttfbMs: number;
  attempts: number;
}> {
  const t = startTimeout(samImageTimeoutMs());
  // Fresh client per call (no connection state; the runtime fetch pools
  // underneath) so HTTP attempts are attributable to this exact call.
  // Image calls never retry: a slow call fails closed fast (6s) instead of
  // eating pool time.
  let attempts = 0;
  // Use the runtime fetch (like transcribe.ts) so proxied networks work;
  // identical behavior on direct networks.
  const client = new OpenAI({
    baseURL: 'https://api.meta.ai/v1',
    apiKey: requireKey(),
    maxRetries: 0,
    fetch: (...args: Parameters<typeof fetch>) => {
      attempts += 1;
      return fetch(...args);
    },
  });
  const t0 = Date.now();
  let text = '';
  let ttfbMs = -1;
  try {
    const stream = client.responses.stream(
      {
        model: SAM_MODEL,
        metadata: { include_confidence: 'true' },
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: concept },
              { type: 'input_image', image_url: imageUrl },
            ],
          },
        ],
      } as unknown as Parameters<typeof client.responses.stream>[0],
      { signal: t.signal },
    );
    for await (const event of stream) {
      // First event of any kind: empty responses emit no text deltas at all.
      if (ttfbMs < 0) ttfbMs = Date.now() - t0;
      const ev = event as { type?: string; delta?: string };
      if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string') text += ev.delta;
    }
    // Aborting a stream can end it silently; a timeout must surface as an error.
    t.throwIfAborted('sam image');
    const records = parseSamOutput(text);
    const frames = records.reduce((max, r) => Math.max(max, r.frame + 1), 0);
    // Prefer the response's billed usage over parsed output (video bills a
    // 50-frame minimum; empty responses still cost). Never throws: cost
    // accounting degrades to the parsed counts.
    let usage: SamUsage | null = null;
    try {
      const withFinal = stream as unknown as {
        finalResponse?: () => Promise<{ usage?: unknown }>;
      };
      const raw = (await withFinal.finalResponse?.())?.usage as {
        video_frames_processed?: unknown;
        images_processed?: unknown;
      } | null;
      if (raw && typeof raw === 'object') {
        usage = {
          ...(typeof raw.video_frames_processed === 'number'
            ? { videoFramesProcessed: raw.video_frames_processed }
            : {}),
          ...(typeof raw.images_processed === 'number' ? { imagesProcessed: raw.images_processed } : {}),
        };
      }
    } catch {
      usage = null;
    }
    return { records, frames, usage, ttfbMs, attempts };
  } finally {
    t.cancel();
  }
}

/**
 * Collapse single-frame image boxes for one object into a chunk-relative
 * flag: the returned box over the frame time ±1s.
 */
export function flagsForImageHit(
  concept: string,
  ruleId: string,
  records: ParsedRecord[],
  frameMs = CHUNK_MS / 2,
): VisualFlag[] {
  const byId = new Map<number, ParsedRecord[]>();
  for (const r of records) {
    const list = byId.get(r.id) ?? [];
    list.push(r);
    byId.set(r.id, list);
  }
  const flags: VisualFlag[] = [];
  for (const [, list] of byId) {
    list.sort((a, b) => a.frame - b.frame);
    flags.push({
      startMs: Math.max(0, frameMs - IMAGE_PAD_MS),
      endMs: Math.min(CHUNK_MS, frameMs + IMAGE_PAD_MS),
      box: list[Math.floor(list.length / 2)].box,
      label: concept,
      ruleId,
    });
  }
  return flags;
}

function saveDebugFrames(seq: number, jpegs: Buffer[]): void {
  const dir = debugFramesDir();
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    jpegs.forEach((jpg, i) => {
      const name = jpegs.length === 1 ? `chunk${seq}.jpg` : `chunk${seq}-f${i}.jpg`;
      writeFileSync(join(dir, name), jpg);
    });
    console.log(`[sam] chunk #${seq} frames saved to ${dir}/`);
  } catch (e) {
    console.log(`[sam] chunk #${seq} frame save failed: ${e instanceof Error ? e.message : e}`);
  }
}

export async function detectVisual(
  video: Buffer | null,
  seq: number,
  mode: ModerationMode,
  frameJpgs: Buffer[] = [],
  prevFrameJpgs: Buffer[] = [],
): Promise<{
  flags: VisualFlag[];
  costUsd: number;
  detail?: SamBreakdown;
  gateDetail?: GateBreakdown;
  visionDetail?: VisionBreakdown;
}> {
  if (mode === 'mock') {
    // Scripted stand-ins, alternating the rulebook's video rules.
    const slot = seq % 6;
    const rules = videoBlurRules();
    if ((slot !== 3 && slot !== 4) || rules.length === 0) return { flags: [], costUsd: 0 };
    const rule = (slot === 3 ? rules[0] : rules[1]) ?? rules[0];
    const box: NormBox =
      slot === 3 ? { x: 0.1, y: 0.3, w: 0.22, h: 0.35 } : { x: 0.4, y: 0.08, w: 0.2, h: 0.25 };
    return {
      flags: [
        { startMs: 300, endMs: 1700, box, label: `${rule.title} (mock)`, ruleId: rule.id },
      ],
      costUsd: 0,
    };
  }
  if (!video || video.length === 0) return { flags: [], costUsd: 0 };
  requireKey(); // fail fast before burning ffmpeg work (clients build per call below)
  // Frame sampling: N 320px JPEGs per chunk (studio canvas captures, or
  // server ffmpeg fallback). A hit on any frame flags the chunk. Failures
  // throw into the pipeline's visual fail handling (closed/open) only when
  // every frame fails; partial evidence still moderates.
  const wantFrames = framesPerChunk();
  const received = frameJpgs.filter((j) => j.length > 0).slice(0, wantFrames);
  let jpegs: Buffer[];
  let extractMs: number;
  let source: SamBreakdown['source'];
  if (received.length > 0) {
    jpegs = received;
    extractMs = 0;
    source = 'client';
  } else {
    const tExtract = Date.now();
    jpegs = await extractSampleJpegs(video, wantFrames);
    extractMs = Date.now() - tExtract;
    source = 'server';
  }
  const sampleTimes = sampleTimesMs(jpegs.length);
  saveDebugFrames(seq, jpegs);
  const backend = visionBackend();
  if (backend === 'spark') {
    return detectVisualSpark(seq, mode, jpegs, prevFrameJpgs);
  }
  if (backend === 'gate') {
    return detectVisualGate(seq, mode, jpegs, sampleTimes, source, extractMs);
  }
  const urls = jpegs.map((jpg) => `data:image/jpeg;base64,${jpg.toString('base64')}`);
  const settled = await Promise.all(
    conceptsFromRulebook().map(async ({ concept, ruleId }) => {
      const t0 = Date.now();
      const perFrame = await Promise.allSettled(urls.map((imageUrl) => segmentImage(concept, imageUrl)));
      const ms = Date.now() - t0;
      let costUsd = 0;
      let attempts = 0;
      let failedFrames = 0;
      const imageFlags: VisualFlag[] = [];
      const allRecords: ParsedRecord[] = [];
      const ttfbs: number[] = [];
      let firstError: unknown = null;
      perFrame.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          costUsd += samUsdForImages(r.value.usage?.imagesProcessed ?? 1);
          attempts += r.value.attempts;
          if (r.value.ttfbMs >= 0) ttfbs.push(r.value.ttfbMs);
          allRecords.push(...r.value.records);
          imageFlags.push(...flagsForImageHit(concept, ruleId, r.value.records, sampleTimes[i]));
        } else {
          // Image calls never retry, so a failed call is exactly one attempt.
          failedFrames += 1;
          attempts += 1;
          if (!firstError) firstError = r.reason;
        }
      });
      if (failedFrames === perFrame.length) throw firstError;
      const ttfbMs = ttfbs.length > 0 ? Math.min(...ttfbs) : -1;
      const boxes = allRecords.length;
      const confidence = meanConfidence(allRecords);
      console.log(
        `[sam] chunk #${seq} rule=${ruleId} frames=${perFrame.length} ` +
          `boxes=${boxes} conf=${confidence === null ? 'n/a' : confidence.toFixed(2)} ` +
          `ttfb=${ttfbMs}ms ms=${ms} attempts=${attempts}` +
          (failedFrames > 0 ? ` failed=${failedFrames}` : ''),
      );
      const conceptDebug: SamConceptDebug = {
        ruleId,
        frames: perFrame.length,
        boxes,
        confidence,
        ttfbMs,
        ms,
        attempts,
        failedFrames,
      };
      return { flags: imageFlags, costUsd, conceptDebug };
    }),
  );
  const flags: VisualFlag[] = [];
  let costUsd = 0;
  const concepts: SamConceptDebug[] = [];
  for (const s of settled) {
    costUsd += s.costUsd;
    flags.push(...s.flags);
    concepts.push(s.conceptDebug);
  }
  console.log(
    `[sam] chunk #${seq} src=${source} extract=${extractMs}ms total=+${costUsd.toFixed(4)}`,
  );
  return { flags, costUsd, detail: { extractMs, source, concepts } };
}

/**
 * Gate strategy: classify evenly spread frames with one Spark VLM call each
 * (parallel) instead of SAM segmentation. Same fail semantics: a non-clean
 * verdict on any frame flags the chunk; all-failed throws.
 */
async function detectVisualGate(
  seq: number,
  mode: ModerationMode,
  jpegs: Buffer[],
  sampleTimes: number[],
  source: GateBreakdown['source'],
  extractMs: number,
): Promise<{
  flags: VisualFlag[];
  costUsd: number;
  detail?: SamBreakdown;
  gateDetail?: GateBreakdown;
}> {
  const indices = pickGateIndices(jpegs.length, gateFrames());
  const urls = indices.map((i) => `data:image/jpeg;base64,${jpegs[i].toString('base64')}`);
  const times = indices.map((i) => sampleTimes[i] ?? CHUNK_MS / 2);
  const g = await runGate(urls, times, seq, mode);
  return {
    flags: g.flags,
    costUsd: g.costUsd,
    gateDetail: {
      extractMs,
      source,
      frames: indices.map((frame, k) => ({
        frame,
        frameMs: times[k],
        verdict: g.verdicts[k] ?? 'clean',
      })),
      ms: g.ms,
      failedFrames: g.failedFrames,
    },
  };
}

/**
 * Spark backend: ONE classifier call over the previous chunk's last 2 frames
 * plus this chunk's frames. Without prev frames (first chunk, server-only
 * fallback) the call runs on this chunk's frames alone.
 */
async function detectVisualSpark(
  seq: number,
  mode: ModerationMode,
  jpegs: Buffer[],
  prevFrameJpgs: Buffer[],
): Promise<{
  flags: VisualFlag[];
  costUsd: number;
  detail?: SamBreakdown;
  gateDetail?: GateBreakdown;
  visionDetail?: VisionBreakdown;
}> {
  const prev = prevFrameJpgs.filter((j) => j.length > 0).slice(-2);
  const frames = [...prev, ...jpegs.filter((j) => j.length > 0)];
  const urls = frames.map((jpg) => `data:image/jpeg;base64,${jpg.toString('base64')}`);
  const v = await runSparkVision(urls, prev.length, seq, mode);
  return {
    flags: v.flags,
    costUsd: v.costUsd,
    visionDetail: {
      model: sparkVisionModel(),
      effort: sparkVisionEffort(),
      frames: urls.length,
      prevFrames: prev.length,
      results: v.results,
      decision: v.decision,
      topRuleId: v.topRuleId,
      maxConfidence: v.maxConfidence,
      secondCall: v.secondCall,
      ms: v.ms,
      inputTokens: v.inputTokens,
      outputTokens: v.outputTokens,
      frameVerdicts: v.frameVerdicts,
    },
  };
}
