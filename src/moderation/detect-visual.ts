import OpenAI from 'openai';
import type { ModerationMode, NormBox, VisualFlag } from './types';
import { videoBlurRules } from './rulebook';
import { PRICING } from './cost';

const SAM_MODEL = 'sam-3.1';
/** Each moderation chunk is 2s of media. */
const CHUNK_MS = 2000;

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

async function segmentConcept(
  client: OpenAI,
  concept: string,
  videoDataUrl: string,
): Promise<{ records: ParsedRecord[]; frames: number }> {
  const stream = client.responses.stream({
    model: SAM_MODEL,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: concept },
          { type: 'input_video', video_url: videoDataUrl },
        ],
      },
    ],
  } as unknown as Parameters<typeof client.responses.stream>[0]);
  let text = '';
  for await (const event of stream) {
    const ev = event as { type?: string; delta?: string };
    if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string') text += ev.delta;
  }
  const records = parseSamOutput(text);
  const frames = records.reduce((max, r) => Math.max(max, r.frame + 1), 0);
  return { records, frames };
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
  const client = new OpenAI({ baseURL: 'https://api.meta.ai/v1', apiKey: requireKey() });
  const videoDataUrl = `data:video/webm;base64,${video.toString('base64')}`;
  const flags: VisualFlag[] = [];
  let costUsd = 0;
  for (const { concept, ruleId } of conceptsFromRulebook()) {
    const { records, frames } = await segmentConcept(client, concept, videoDataUrl);
    costUsd += (frames / 1000) * PRICING.samVideoPerThousandFramesUsd;
    flags.push(...flagsForConcept(concept, ruleId, records, frames));
  }
  return { flags, costUsd };
}
