import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import OpenAI from 'openai';
import type { ModerationMode, NormBox, SamBreakdown, SamConceptDebug, VisualFlag } from './types';
import { videoBlurRules } from './rulebook';
import { samUsdForFrames, samUsdForImages } from './cost';
import { samTimeoutMs, startTimeout } from './timeout';
import { extractSampleJpegs, webmToMp4 } from './transcode';

const SAM_MODEL = 'sam-3.1';
/** Each moderation chunk is 2s of media. */
const CHUNK_MS = 2000;
/** An image hit blurs the frame time ±1s. */
const IMAGE_PAD_MS = 1000;
/** Sample times (chunk-relative ms) for 1- and 2-frame sampling. */
const SAMPLE_TIMES: Record<1 | 2, number[]> = { 1: [CHUNK_MS / 2], 2: [500, 1500] };

export interface ParsedRecord {
  frame: number;
  id: number;
  box: NormBox;
  confidence?: number;
}

/**
 * Frames sampled per chunk for SAM image calls. Two frames catch briefer
 * gestures (t≈0.5s/1.5s) at twice the image cost; wall latency stays flat.
 */
export function framesPerChunk(): 1 | 2 {
  return process.env.SAM_FRAMES_PER_CHUNK === '2' ? 2 : 1;
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

async function segmentMedia(
  concept: string,
  mediaPart: { type: 'input_video'; video_url: string } | { type: 'input_image'; image_url: string },
): Promise<{
  records: ParsedRecord[];
  frames: number;
  usage: SamUsage | null;
  ttfbMs: number;
  attempts: number;
}> {
  const t = startTimeout(samTimeoutMs());
  // Fresh client per call (no connection state; the runtime fetch pools
  // underneath) so HTTP attempts are attributable to this exact call.
  let attempts = 0;
  // Use the runtime fetch (like transcribe.ts) so proxied networks work;
  // identical behavior on direct networks.
  const client = new OpenAI({
    baseURL: 'https://api.meta.ai/v1',
    apiKey: requireKey(),
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
            content: [{ type: 'input_text', text: concept }, mediaPart],
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
    t.throwIfAborted(mediaPart.type === 'input_video' ? 'sam video' : 'sam image');
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

/** Collapse per-frame boxes for one object into a single chunk-relative flag. */
function flagsForConcept(
  concept: string,
  ruleId: string,
  records: ParsedRecord[],
  frames: number,
): VisualFlag[] {
  if (records.length === 0 || frames === 0) return [];
  const msPerFrame = CHUNK_MS / frames;
  const byId = new Map<number, ParsedRecord[]>();
  for (const r of records) {
    const list = byId.get(r.id) ?? [];
    list.push(r);
    byId.set(r.id, list);
  }
  const flags: VisualFlag[] = [];
  for (const [, list] of byId) {
    list.sort((a, b) => a.frame - b.frame);
    const first = list[0];
    const last = list[list.length - 1];
    const mid = list[Math.floor(list.length / 2)];
    flags.push({
      startMs: Math.max(0, Math.round(first.frame * msPerFrame)),
      endMs: Math.min(CHUNK_MS, Math.round((last.frame + 1) * msPerFrame)),
      box: mid.box,
      label: concept,
      ruleId,
    });
  }
  return flags;
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
): Promise<{ flags: VisualFlag[]; costUsd: number; detail?: SamBreakdown }> {
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
  // Frame sampling: 320px JPEG(s) from the chunk middle per concept (~0.5s
  // per call instead of 4-18s for video). Failures throw into the
  // pipeline's visual fail handling (closed/open), unchanged.
  const frames = framesPerChunk();
  const sampleTimes = SAMPLE_TIMES[frames];
  const tExtract = Date.now();
  const jpegs = await extractSampleJpegs(video, frames);
  const extractMs = Date.now() - tExtract;
  saveDebugFrames(seq, jpegs);
  const urls = jpegs.map((jpg) => `data:image/jpeg;base64,${jpg.toString('base64')}`);
  // One SAM image request per concept per frame, all in flight at once.
  const settled = await Promise.all(
    conceptsFromRulebook().map(async ({ concept, ruleId }) => {
      const t0 = Date.now();
      const perFrame = await Promise.all(
        urls.map((image_url) => segmentMedia(concept, { type: 'input_image', image_url })),
      );
      const ms = Date.now() - t0;
      let costUsd = 0;
      let attempts = 0;
      const imageFlags: VisualFlag[] = [];
      const allRecords: ParsedRecord[] = [];
      perFrame.forEach(({ records, usage, attempts: a }, i) => {
        costUsd += samUsdForImages(usage?.imagesProcessed ?? 1);
        attempts += a;
        allRecords.push(...records);
        imageFlags.push(...flagsForImageHit(concept, ruleId, records, sampleTimes[i]));
      });
      const ttfbs = perFrame.map((p) => p.ttfbMs).filter((t) => t >= 0);
      const ttfbMs = ttfbs.length > 0 ? Math.min(...ttfbs) : -1;
      const boxes = allRecords.length;
      const confidence = meanConfidence(allRecords);
      let confirmed = false;
      let confirmMs: number | null = null;
      let flags = imageFlags;
      if (imageFlags.length > 0) {
        // Confirm step, positive chunks only: a 320px video call refines the
        // blur window. Any failure keeps the image flags (fail-closed).
        try {
          const tConfirm = Date.now();
          const mp4 = await webmToMp4(video, undefined, 320);
          const confirm = await segmentMedia(concept, {
            type: 'input_video',
            video_url: `data:video/mp4;base64,${mp4.toString('base64')}`,
          });
          confirmMs = Date.now() - tConfirm;
          attempts += confirm.attempts;
          costUsd += samUsdForFrames(confirm.usage?.videoFramesProcessed ?? confirm.frames);
          const precise = flagsForConcept(concept, ruleId, confirm.records, confirm.frames);
          if (precise.length > 0) {
            flags = precise;
            confirmed = true;
          }
        } catch {
          // Keep the image flags.
        }
      }
      console.log(
        `[sam] chunk #${seq} rule=${ruleId} frames=${perFrame.length} ` +
          `boxes=${boxes} conf=${confidence === null ? 'n/a' : confidence.toFixed(2)} ` +
          `ttfb=${ttfbMs}ms ms=${ms} attempts=${attempts}` +
          (confirmMs !== null ? ` confirm=${confirmMs}ms${confirmed ? '(kept)' : '(image-kept)'}` : ''),
      );
      const conceptDebug: SamConceptDebug = {
        ruleId,
        frames: perFrame.length,
        boxes,
        confidence,
        ttfbMs,
        ms,
        attempts,
        confirmed,
        confirmMs,
      };
      return { flags, costUsd, conceptDebug };
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
    `[sam] chunk #${seq} extract=${extractMs}ms total=+${costUsd.toFixed(4)}`,
  );
  return { flags, costUsd, detail: { extractMs, concepts } };
}
