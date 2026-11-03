import OpenAI from 'openai';
import type { ModerationMode, NormBox, VisualFlag } from './types';
import { videoBlurRules } from './rulebook';
import { samUsdForFrames, samUsdForImages } from './cost';
import { samTimeoutMs, startTimeout } from './timeout';
import { extractMiddleJpeg, webmToMp4 } from './transcode';

const SAM_MODEL = 'sam-3.1';
/** Each moderation chunk is 2s of media. */
const CHUNK_MS = 2000;
/** The sampled middle frame sits at ~t=1.0s of the chunk. */
const IMAGE_FRAME_MS = CHUNK_MS / 2;
/** An image hit blurs the frame time ±1s (the whole 2s chunk). */
const IMAGE_PAD_MS = 1000;

export interface ParsedRecord {
  frame: number;
  id: number;
  box: NormBox;
}

/**
 * Parse SAM 3.1 output_text lines into normalized boxes.
 * Line shape: <Nf>id<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..|>...
 */
export function parseSamOutput(text: string): ParsedRecord[] {
  const records: ParsedRecord[] = [];
  const frameRe = /<(\d+)f>((?:\d+<\|box;[^|]*\|>(?:<\|mask;[^|]*\|>)?,?)*)/g;
  const boxRe = /(\d+)<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)/g;
  for (const frameMatch of text.matchAll(frameRe)) {
    const frame = Number(frameMatch[1]);
    const body = frameMatch[2];
    for (const boxMatch of body.matchAll(boxRe)) {
      const [, id, x1, y1, x2, y2, w, h] = boxMatch.map(Number);
      if (!w || !h) continue;
      records.push({
        frame,
        id,
        box: { x: x1 / w, y: y1 / h, w: (x2 - x1) / w, h: (y2 - y1) / h },
      });
    }
  }
  return records;
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
  client: OpenAI,
  concept: string,
  mediaPart: { type: 'input_video'; video_url: string } | { type: 'input_image'; image_url: string },
): Promise<{ records: ParsedRecord[]; frames: number; usage: SamUsage | null }> {
  const t = startTimeout(samTimeoutMs());
  let text = '';
  try {
    const stream = client.responses.stream(
      {
        model: SAM_MODEL,
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
    return { records, frames, usage };
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
      startMs: Math.max(0, IMAGE_FRAME_MS - IMAGE_PAD_MS),
      endMs: Math.min(CHUNK_MS, IMAGE_FRAME_MS + IMAGE_PAD_MS),
      box: list[Math.floor(list.length / 2)].box,
      label: concept,
      ruleId,
    });
  }
  return flags;
}

export async function detectVisual(
  video: Buffer | null,
  seq: number,
  mode: ModerationMode,
): Promise<{ flags: VisualFlag[]; costUsd: number }> {
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
  // Use the runtime fetch (like transcribe.ts) so proxied networks work;
  // identical behavior on direct networks.
  const client = new OpenAI({
    baseURL: 'https://api.meta.ai/v1',
    apiKey: requireKey(),
    fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  });
  // Frame sampling: one 320px JPEG from the chunk middle per concept (~0.5s
  // per call instead of 4-18s for video). Failures throw into the
  // pipeline's visual fail handling (closed/open), unchanged.
  const jpg = await extractMiddleJpeg(video);
  const imageDataUrl = `data:image/jpeg;base64,${jpg.toString('base64')}`;
  // One SAM image request per concept, all in flight at once.
  const settled = await Promise.all(
    conceptsFromRulebook().map(async ({ concept, ruleId }) => {
      const { records, usage } = await segmentMedia(client, concept, {
        type: 'input_image',
        image_url: imageDataUrl,
      });
      let costUsd = samUsdForImages(usage?.imagesProcessed ?? 1);
      const imageFlags = flagsForImageHit(concept, ruleId, records);
      if (imageFlags.length === 0) return { flags: imageFlags, costUsd };
      // Confirm step, positive chunks only: a 320px video call refines the
      // blur window. Any failure keeps the image flag (fail-closed).
      try {
        const mp4 = await webmToMp4(video, undefined, 320);
        const confirm = await segmentMedia(client, concept, {
          type: 'input_video',
          video_url: `data:video/mp4;base64,${mp4.toString('base64')}`,
        });
        costUsd += samUsdForFrames(confirm.usage?.videoFramesProcessed ?? confirm.frames);
        const precise = flagsForConcept(concept, ruleId, confirm.records, confirm.frames);
        return { flags: precise.length > 0 ? precise : imageFlags, costUsd };
      } catch {
        return { flags: imageFlags, costUsd };
      }
    }),
  );
  const flags: VisualFlag[] = [];
  let costUsd = 0;
  for (const s of settled) {
    costUsd += s.costUsd;
    flags.push(...s.flags);
  }
  return { flags, costUsd };
}
