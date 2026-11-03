import OpenAI from 'openai';
import type { ModerationMode, VisualFlag } from './types';
import { ruleById } from './rulebook';
import { sparkUsdForTokens } from './cost';
import { gateTimeoutMs, startTimeout } from './timeout';

const GATE_MODEL = 'muse-spark-1.3';
/** Each moderation chunk is 2s of media. */
const CHUNK_MS = 2000;
/** A gate hit blurs the frame time ±1s (whole frame; see pipeline). */
const GATE_PAD_MS = 1000;
/** Token headroom: minimal-effort reasoning still burns ~60-240 tokens. */
const GATE_MAX_TOKENS = 512;

export type GateVerdict = 'clean' | 'three-fingers' | 'nose-touch';

/** Verdict enum key to rulebook rule id. Covered by a test against rulebook.json. */
const RULE_FOR_VERDICT: Record<Exclude<GateVerdict, 'clean'>, string> = {
  'three-fingers': 'hand-gesture-three',
  'nose-touch': 'touching-nose',
};

const GATE_SCHEMA = {
  type: 'object',
  properties: { verdict: { type: 'string', enum: ['clean', 'three-fingers', 'nose-touch'] } },
  required: ['verdict'],
  additionalProperties: false,
} as const;

const GATE_SYSTEM = 'Classify the image. Return JSON only.';
const GATE_USER =
  'If a hand shows exactly three extended fingers answer three-fingers; ' +
  'else if a finger touches a nose answer nose-touch; else clean.';

/** Frames gated per chunk. Default 2 (middle frames catch sustained gestures). */
export function gateFrames(): number {
  const raw = Number(process.env.GATE_FRAMES ?? 2);
  return Number.isInteger(raw) && raw >= 1 && raw <= 4 ? raw : 2;
}

/**
 * Centered consecutive frame indices for `want` gate calls over `available`
 * frames. 4 available, 2 wanted -> [1, 2] (t=750ms, t=1250ms), which
 * minimizes the worst unsampled interval inside the chunk.
 */
export function pickGateIndices(available: number, want: number): number[] {
  const n = Math.max(0, Math.floor(available));
  const w = Math.max(0, Math.min(Math.floor(want), n));
  if (w === 0 || n === 0) return [];
  const start = Math.floor((n - w) / 2);
  return Array.from({ length: w }, (_, k) => start + k);
}

/** Strict parse of the gate's JSON verdict; null on anything else. */
export function parseGateVerdict(content: string): GateVerdict | null {
  try {
    const parsed = JSON.parse(content) as { verdict?: unknown };
    if (
      parsed.verdict === 'clean' ||
      parsed.verdict === 'three-fingers' ||
      parsed.verdict === 'nose-touch'
    ) {
      return parsed.verdict;
    }
    return null;
  } catch {
    return null;
  }
}

/** Whole-frame flag for a non-clean gate verdict at one frame time. */
export function flagForVerdict(
  verdict: Exclude<GateVerdict, 'clean'>,
  frameMs: number,
): VisualFlag {
  const ruleId = RULE_FOR_VERDICT[verdict];
  const rule = ruleById(ruleId);
  return {
    startMs: Math.max(0, frameMs - GATE_PAD_MS),
    endMs: Math.min(CHUNK_MS, frameMs + GATE_PAD_MS),
    box: { x: 0, y: 0, w: 1, h: 1 },
    label: rule ? `${rule.title} (gate)` : `${verdict} (gate)`,
    ruleId,
  };
}

/** Rule ids the gate can attribute, for the rulebook-existence test. */
export function gateRuleIds(): string[] {
  return Object.values(RULE_FOR_VERDICT);
}

function requireKey(): string {
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new Error('MODEL_API_KEY is not set');
  return key;
}

export interface GateCallResult {
  flags: VisualFlag[];
  costUsd: number;
  /** Verdict per gated frame index (same order as the input urls). */
  verdicts: GateVerdict[];
  ms: number;
  failedFrames: number;
}

async function gateOne(
  client: OpenAI,
  imageUrl: string,
  frameMs: number,
): Promise<{ verdict: GateVerdict; costUsd: number }> {
  const t = startTimeout(gateTimeoutMs());
  try {
    const res = await client.chat.completions.create(
      {
        model: GATE_MODEL,
        max_tokens: GATE_MAX_TOKENS,
        // 'minimal' rides the wire as a plain string; the cast is only
        // because this SDK version predates the value in its union type.
        reasoning_effort: 'minimal' as unknown as 'low',
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'gate', schema: GATE_SCHEMA, strict: true },
        },
        messages: [
          { role: 'system', content: GATE_SYSTEM },
          {
            role: 'user',
            content: [
              { type: 'text', text: GATE_USER },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
      },
      { signal: t.signal },
    );
    const content = res.choices[0]?.message?.content ?? '';
    const verdict = parseGateVerdict(content);
    if (!verdict) throw new Error(`gate returned non-JSON verdict: ${content.slice(0, 80)}`);
    const usage = res.usage;
    const costUsd = usage ? sparkUsdForTokens(usage.prompt_tokens, usage.completion_tokens) : 0;
    return { verdict, costUsd };
  } finally {
    t.cancel();
  }
}

/**
 * Classify sampled chunk frames with one Spark VLM call each (parallel).
 * A non-clean verdict on any frame flags the chunk; failures throw into the
 * pipeline's visual fail handling only when every frame fails.
 */
export async function runGate(
  imageUrls: string[],
  frameTimesMs: number[],
  seq: number,
  mode: ModerationMode,
): Promise<GateCallResult> {
  if (mode === 'mock' || imageUrls.length === 0) {
    return { flags: [], costUsd: 0, verdicts: [], ms: 0, failedFrames: 0 };
  }
  // Use the runtime fetch (like judge.ts) so proxied networks work.
  const client = new OpenAI({
    baseURL: 'https://api.meta.ai/v1',
    apiKey: requireKey(),
    fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  });
  const t0 = Date.now();
  const settled = await Promise.allSettled(
    imageUrls.map((url, i) => gateOne(client, url, frameTimesMs[i] ?? CHUNK_MS / 2)),
  );
  const flags: VisualFlag[] = [];
  const verdicts: GateVerdict[] = [];
  let costUsd = 0;
  let failedFrames = 0;
  let firstError: unknown = null;
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      costUsd += r.value.costUsd;
      verdicts.push(r.value.verdict);
      if (r.value.verdict !== 'clean') {
        flags.push(flagForVerdict(r.value.verdict, frameTimesMs[i] ?? CHUNK_MS / 2));
      }
    } else {
      failedFrames += 1;
      if (!firstError) firstError = r.reason;
    }
  });
  if (failedFrames === settled.length) throw firstError;
  const ms = Date.now() - t0;
  console.log(
    `[gate] chunk #${seq} frames=${settled.length} verdicts=${verdicts.join(',') || 'none'} ` +
      `ms=${ms} +${costUsd.toFixed(5)}` +
      (failedFrames > 0 ? ` failed=${failedFrames}` : ''),
  );
  return { flags, costUsd, verdicts, ms, failedFrames };
}
