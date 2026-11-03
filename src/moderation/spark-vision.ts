import OpenAI from 'openai';
import type {
  ResponseCreateParamsNonStreaming,
  ResponseInputContent,
} from 'openai/resources/responses/responses';
import type { ReasoningEffort } from 'openai/resources/shared';
import type { ModerationMode, VisionRuleResult, VisualFlag } from './types';
import { ruleById, videoBlurRules } from './rulebook';
import { sparkUsdForTokens } from './cost';
import { sparkVisionTimeoutMs, startTimeout } from './timeout';

/** Each moderation chunk is 2s of media. */
const CHUNK_MS = 2000;
/** Output cap: structured verdicts are small; reasoning still bills output. */
const VISION_MAX_OUTPUT_TOKENS = 512;
/** Wait before the single 429/5xx retry, when time remains. */
const RETRY_WAIT_MS = 500;
/** Effort for the unsure-band second opinion. */
const SECOND_OPINION_EFFORT = 'low';

/** Spark model for multi-frame vision classification. */
export function sparkVisionModel(): string {
  const raw = (process.env.SPARK_VISION_MODEL ?? '').trim();
  return raw.length > 0 ? raw : 'muse-spark-1.3';
}

/** First-pass reasoning effort (minimal|low|medium|high). */
export function sparkVisionEffort(): string {
  const raw = (process.env.SPARK_VISION_EFFORT ?? '').trim().toLowerCase();
  return raw.length > 0 ? raw : 'minimal';
}

/** Confidence at or above which a rule blurs the chunk. */
export function visionHit(): number {
  const raw = Number(process.env.VISION_HIT ?? 0.5);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.5;
}

/** Lower edge of the unsure band (second opinion with low effort). */
export function visionUnsure(): number {
  const raw = Number(process.env.VISION_UNSURE ?? 0.3);
  const hit = visionHit();
  return Number.isFinite(raw) && raw >= 0 && raw < hit ? raw : Math.min(0.3, hit * 0.6);
}

/**
 * Precise per-rule visual definitions, keyed by rulebook rule id. The
 * classifier prompt is generated from the rulebook's video rules plus these
 * definitions; a test pins every video rule to an entry here.
 */
const RULE_DEFINITIONS: Record<string, string> = {
  'hand-gesture-three':
    'three_fingers: exactly three fingers extended and clearly shown toward the camera; ' +
    'ordinary hands, waving, two or four fingers are NOT a match',
  'touching-nose':
    'finger_on_nose: a fingertip in contact with or within ~1 cm of the nose; ' +
    'touching chin/cheek/mouth is NOT a match',
};

export interface VisionRuleDef {
  id: string;
  definition: string;
}

/** Prompt definitions for the rulebook's video rules (description fallback). */
export function visionRuleDefs(): VisionRuleDef[] {
  return videoBlurRules().map((r) => ({
    id: r.id,
    definition: RULE_DEFINITIONS[r.id] ?? `${r.match}: ${r.description}`,
  }));
}

/** Rule ids with a precise classifier definition (for the sync test). */
export function definedVisionRuleIds(): string[] {
  return Object.keys(RULE_DEFINITIONS);
}

/** Classifier prompt: rulebook rules + conservative instructions. */
export function buildVisionPrompt(
  defs: VisionRuleDef[],
  frameCount: number,
  prevCount: number,
): string {
  const lines = [
    `You are a live-moderation vision classifier. You get ${frameCount} frames` +
      (prevCount > 0
        ? ` (frames 1-${prevCount} are the previous chunk, the rest this chunk).`
        : '.'),
    'For each rule below, decide if it is present in ANY frame. Be conservative about false positives, but flag even a single frame that matches.',
    'Rules:',
    ...defs.map((d) => `- id "${d.id}": ${d.definition}`),
    `Reply with JSON only: per rule {id, present, confidence 0-1, frame_indices 0-based over the ${frameCount} frames}.`,
  ];
  return lines.join('\n');
}

/** Strict JSON-schema shape for the classifier verdict. */
export function visionSchema(ids: string[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      rules: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', enum: ids },
            present: { type: 'boolean' },
            confidence: { type: 'number' },
            frame_indices: { type: 'array', items: { type: 'integer' } },
          },
          required: ['id', 'present', 'confidence', 'frame_indices'],
          additionalProperties: false,
        },
      },
    },
    required: ['rules'],
    additionalProperties: false,
  };
}

/**
 * Strict parse of the classifier verdict; null on invalid JSON, unknown
 * shape, or unknown rule ids (fail-closed upstream). Out-of-range frame
 * indices are dropped; confidence is clamped to 0-1.
 */
export function parseVisionOutput(
  content: string,
  validIds: Set<string>,
  frameCount: number,
): VisionRuleResult[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const rules = (parsed as { rules?: unknown }).rules;
  if (!Array.isArray(rules)) return null;
  const out: VisionRuleResult[] = [];
  for (const r of rules) {
    if (typeof r !== 'object' || r === null) return null;
    const row = r as { id?: unknown; present?: unknown; confidence?: unknown; frame_indices?: unknown };
    if (typeof row.id !== 'string' || !validIds.has(row.id)) return null;
    if (typeof row.present !== 'boolean') return null;
    if (typeof row.confidence !== 'number' || !Number.isFinite(row.confidence)) return null;
    if (!Array.isArray(row.frame_indices)) return null;
    const frameIndices: number[] = [];
    for (const f of row.frame_indices) {
      if (!Number.isInteger(f)) return null;
      if ((f as number) >= 0 && (f as number) < frameCount) frameIndices.push(f as number);
    }
    out.push({
      id: row.id,
      present: row.present,
      confidence: Math.max(0, Math.min(1, row.confidence)),
      frameIndices,
    });
  }
  return out;
}

export type VisionCallDecision = 'hit' | 'clean' | 'unsure';

/** Threshold one classifier verdict into hit/clean/unsure. */
export function decideVision(
  results: VisionRuleResult[],
  hitAt: number,
  unsureAt: number,
): { decision: VisionCallDecision; topRuleId: string | null; maxConfidence: number } {
  let maxConfidence = 0;
  let topRuleId: string | null = null;
  for (const r of results) {
    if (r.present && r.confidence > maxConfidence) {
      maxConfidence = r.confidence;
      topRuleId = r.id;
    }
  }
  if (maxConfidence >= hitAt) return { decision: 'hit', topRuleId, maxConfidence };
  if (maxConfidence >= unsureAt) return { decision: 'unsure', topRuleId, maxConfidence };
  return { decision: 'clean', topRuleId: null, maxConfidence };
}

/** Hysteresis: after a hit, the next two chunks blur even when clean. */
export interface HysteresisState {
  armed: boolean;
  /** Consecutive clean chunks since the last hit (while armed). */
  cleanStreak: number;
  lastRuleId: string | null;
}

export function initialHysteresis(): HysteresisState {
  return { armed: false, cleanStreak: 0, lastRuleId: null };
}

/**
 * Fold one chunk's vision verdict into the hysteresis state. A hit arms (and
 * blurs); while armed the first two consecutive clean chunks still blur, the
 * third disarms. Returns whether this chunk must blur plus the next state.
 */
export function hysteresisNext(
  state: HysteresisState,
  hit: boolean,
  ruleId: string | null,
): { blur: boolean; state: HysteresisState } {
  if (hit) {
    return { blur: true, state: { armed: true, cleanStreak: 0, lastRuleId: ruleId } };
  }
  if (!state.armed) return { blur: false, state };
  const cleanStreak = state.cleanStreak + 1;
  if (cleanStreak <= 2) {
    return { blur: true, state: { ...state, cleanStreak } };
  }
  return { blur: false, state: { armed: false, cleanStreak: 0, lastRuleId: null } };
}

function requireKey(): string {
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new Error('MODEL_API_KEY is not set');
  return key;
}

export interface SparkVisionCall {
  results: VisionRuleResult[];
  inputTokens: number;
  outputTokens: number;
  ms: number;
}

function isRetryable(e: unknown): boolean {
  const status = (e as { status?: unknown }).status;
  return status === 429 || (typeof status === 'number' && status >= 500 && status < 600);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** One Responses API classifier call over labeled frame data URLs. */
async function classifyOnce(
  client: OpenAI,
  model: string,
  effort: string,
  prompt: string,
  imageUrls: string[],
  prevCount: number,
  schema: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ text: string; inputTokens: number; outputTokens: number; ms: number }> {
  const content: ResponseInputContent[] = [{ type: 'input_text', text: prompt }];
  imageUrls.forEach((url, i) => {
    content.push({ type: 'input_text', text: `frame ${i + 1}${i < prevCount ? ' (prev chunk)' : ''}:` });
    content.push({ type: 'input_image', image_url: url, detail: 'auto' });
  });
  // 'minimal' rides the wire as a plain string; the cast is only because
  // this SDK version predates the value in its union type.
  const payload: ResponseCreateParamsNonStreaming = {
    model,
    reasoning: { effort: effort as unknown as ReasoningEffort },
    max_output_tokens: VISION_MAX_OUTPUT_TOKENS,
    input: [{ type: 'message', role: 'user', content }],
    text: { format: { type: 'json_schema', name: 'vision', schema, strict: true } },
  };
  const t0 = Date.now();
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = startTimeout(timeoutMs);
    try {
      const res = await client.responses.create(payload, { signal: t.signal });
      const ms = Date.now() - t0;
      if (res.status !== 'completed') {
        throw new Error(`vision response ${res.status ?? 'unknown'}`);
      }
      const text = res.output_text;
      if (!text) throw new Error('vision returned empty output');
      return {
        text,
        inputTokens: res.usage?.input_tokens ?? 0,
        outputTokens: res.usage?.output_tokens ?? 0,
        ms,
      };
    } catch (e) {
      lastError = e;
      // Retry once on 429/5xx, only when a wait + second attempt fits the budget.
      if (attempt === 0 && isRetryable(e) && Date.now() - t0 + RETRY_WAIT_MS < timeoutMs) {
        await sleep(RETRY_WAIT_MS);
        continue;
      }
      throw e;
    } finally {
      t.cancel();
    }
  }
  throw lastError;
}

export interface SparkVisionResult {
  flags: VisualFlag[];
  costUsd: number;
  results: VisionRuleResult[];
  decision: 'hit' | 'clean';
  topRuleId: string | null;
  maxConfidence: number;
  secondCall: boolean;
  ms: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Classify one chunk's frames (last-2 prev + current) with ONE Responses API
 * call; an unsure-band verdict triggers a second call at low effort whose
 * decision stands. Any error, invalid JSON, or timeout throws into the
 * pipeline's visual fail handling (fail-closed blur).
 */
export async function runSparkVision(
  imageUrls: string[],
  prevCount: number,
  seq: number,
  mode: ModerationMode,
): Promise<SparkVisionResult> {
  const empty: SparkVisionResult = {
    flags: [],
    costUsd: 0,
    results: [],
    decision: 'clean',
    topRuleId: null,
    maxConfidence: 0,
    secondCall: false,
    ms: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  if (mode === 'mock' || imageUrls.length === 0) return empty;
  const defs = visionRuleDefs();
  const validIds = new Set(defs.map((d) => d.id));
  const prompt = buildVisionPrompt(defs, imageUrls.length, prevCount);
  const schema = visionSchema(defs.map((d) => d.id));
  const model = sparkVisionModel();
  const effort = sparkVisionEffort();
  const hitAt = visionHit();
  const unsureAt = visionUnsure();
  const timeoutMs = sparkVisionTimeoutMs();
  // Use the runtime fetch (like judge.ts) so proxied networks work.
  const client = new OpenAI({
    baseURL: 'https://api.meta.ai/v1',
    apiKey: requireKey(),
    fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  });
  const t0 = Date.now();
  const first = await classifyOnce(client, model, effort, prompt, imageUrls, prevCount, schema, timeoutMs);
  const firstResults = parseVisionOutput(first.text, validIds, imageUrls.length);
  if (!firstResults) throw new Error(`vision returned invalid JSON: ${first.text.slice(0, 120)}`);
  let results = firstResults;
  let inputTokens = first.inputTokens;
  let outputTokens = first.outputTokens;
  let secondCall = false;
  const firstDecision = decideVision(results, hitAt, unsureAt);
  if (firstDecision.decision === 'unsure') {
    secondCall = true;
    const second = await classifyOnce(
      client,
      model,
      SECOND_OPINION_EFFORT,
      prompt,
      imageUrls,
      prevCount,
      schema,
      timeoutMs,
    );
    const secondResults = parseVisionOutput(second.text, validIds, imageUrls.length);
    if (!secondResults) throw new Error(`vision 2nd opinion returned invalid JSON: ${second.text.slice(0, 120)}`);
    results = secondResults;
    inputTokens += second.inputTokens;
    outputTokens += second.outputTokens;
  }
  const final = decideVision(results, hitAt, unsureAt);
  const decision: 'hit' | 'clean' = final.decision === 'hit' ? 'hit' : 'clean';
  const flags: VisualFlag[] = [];
  if (decision === 'hit') {
    for (const r of results) {
      if (!r.present || r.confidence < hitAt) continue;
      const rule = ruleById(r.id);
      flags.push({
        startMs: 0,
        endMs: CHUNK_MS,
        box: { x: 0, y: 0, w: 1, h: 1 },
        label: rule ? `${rule.title} (spark ${r.confidence.toFixed(2)})` : `${r.id} (spark)`,
        ruleId: r.id,
      });
    }
  }
  const costUsd = sparkUsdForTokens(inputTokens, outputTokens);
  const ms = Date.now() - t0;
  console.log(
    `[vision] chunk #${seq} frames=${imageUrls.length} (prev=${prevCount}) model=${model} ` +
      `effort=${effort}${secondCall ? `->${SECOND_OPINION_EFFORT}` : ''} ms=${ms} ` +
      `in=${inputTokens} out=${outputTokens} ` +
      `conf=${results.map((r) => `${r.id}:${r.confidence.toFixed(2)}`).join(',') || 'none'} ` +
      `decision=${decision}${secondCall ? ' (2nd opinion)' : ''} +$${costUsd.toFixed(5)}`,
  );
  return {
    flags,
    costUsd,
    results,
    decision,
    topRuleId: final.topRuleId,
    maxConfidence: final.maxConfidence,
    secondCall,
    ms,
    inputTokens,
    outputTokens,
  };
}
