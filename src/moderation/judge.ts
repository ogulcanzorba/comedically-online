import OpenAI from 'openai';
import type { ModerationAction, ModerationMode } from './types';
import { MOCK_BANNED_RULE_ID, MOCK_BANNED_WORD } from './mock';
import { RULEBOOK_RULES } from './rulebook';
import { PRICING } from './cost';
import { startTimeout } from './timeout';

const SPARK_MODEL = 'muse-spark-1.3';

export interface JudgeInput {
  recentTranscript: string;
  chunkTranscript: string;
}

export interface JudgeVerdict {
  action: ModerationAction;
  reason: string;
  /** Exact offending word/phrase inside chunkTranscript (for bleep timing). */
  target?: string;
}

export async function judgeContext(
  input: JudgeInput,
  mode: ModerationMode,
): Promise<{ verdict: JudgeVerdict; costUsd: number }> {
  if (mode === 'mock') return { verdict: mockJudge(input), costUsd: 0 };
  return liveJudge(input);
}

function mockJudge(input: JudgeInput): JudgeVerdict {
  const hay = input.chunkTranscript.toLowerCase();
  if (hay.includes(MOCK_BANNED_WORD)) {
    return {
      action: 'bleep',
      reason: `mock: banned word per rule ${MOCK_BANNED_RULE_ID ?? 'rulebook'}`,
      target: MOCK_BANNED_WORD,
    };
  }
  return { action: 'allow', reason: 'mock: nothing flagged' };
}

function requireKey(): string {
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new Error('MODEL_API_KEY is not set');
  return key;
}

async function liveJudge(input: JudgeInput): Promise<{ verdict: JudgeVerdict; costUsd: number }> {
  const client = new OpenAI({ baseURL: 'https://api.meta.ai/v1', apiKey: requireKey() });
  const t = startTimeout();
  let res: Awaited<ReturnType<typeof client.chat.completions.create>>;
  try {
    res = await client.chat.completions.create(
      {
        model: SPARK_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              'You are the comedy-aware moderation judge for Comedically Online, a stand-up streaming stage.',
              'Decide if flagged speech is a joke/satire/self-deprecation (allow) or a real attack on a person or group (bleep).',
              'Enforce ONLY the platform rulebook below: bleep speech matching an audio/text rule, allow everything else. There are no comedian-supplied rules.',
              'Actions: allow | bleep (one spoken word/phrase) | warn (borderline whole chunk). Never choose blur (visuals are separate).',
              'Reply with JSON only: {"action":"allow|bleep|warn","reason":"<=140 chars","target":"exact offending word or phrase, bleep only"}.',
              'Omit target unless action is bleep. target must appear verbatim in the chunk transcript.',
            ].join(' '),
          },
          {
            role: 'user',
            content: JSON.stringify({
              rulebook: RULEBOOK_RULES.filter((r) => r.modality !== 'video').map((r) => ({
                id: r.id,
                match: r.match,
                action: r.action,
                description: r.description,
              })),
              recentTranscript: input.recentTranscript.slice(-2000),
              chunkTranscript: input.chunkTranscript,
            }),
          },
        ],
      },
      { signal: t.signal },
    );
  } finally {
    t.cancel();
  }
  const content = res.choices[0]?.message?.content ?? '';
  const usage = res.usage;
  const costUsd = usage
    ? (usage.prompt_tokens / 1_000_000) * PRICING.sparkInputPerMillionTokensUsd +
      (usage.completion_tokens / 1_000_000) * PRICING.sparkOutputPerMillionTokensUsd
    : (content.length / 4 / 1_000_000) * PRICING.sparkOutputPerMillionTokensUsd;
  try {
    const parsed = JSON.parse(content) as { action?: string; reason?: string; target?: string };
    const action: ModerationAction =
      parsed.action === 'bleep' || parsed.action === 'warn' ? parsed.action : 'allow';
    return {
      verdict: {
        action,
        reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 140) : 'judge gave no reason',
        target: action === 'bleep' && typeof parsed.target === 'string' ? parsed.target : undefined,
      },
      costUsd,
    };
  } catch {
    return { verdict: { action: 'warn', reason: 'judge returned non-JSON; held for review' }, costUsd };
  }
}
