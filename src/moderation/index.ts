import type {
  ChunkDebug,
  Decision,
  ModerationAction,
  ModerationLogEntry,
  ModerationMode,
  SamBreakdown,
  VisualFlag,
} from './types';
import type { TranscriptTurn } from './types';
import { transcribeChunk } from './transcribe';
import { detectVisual } from './detect-visual';
import { judgeContext } from './judge';
import { audioRuleForTarget, audioRulesMatching, ruleById } from './rulebook';
import type { SpendTracker } from './cost';

export function moderationMode(): ModerationMode {
  return process.env.MODERATION_MODE === 'live' ? 'live' : 'mock';
}

export interface ModerateArgs {
  seq: number;
  video: Buffer | null;
  wav: Buffer | null;
  recentTranscript: string;
  tracker: SpendTracker;
  /** Server receipt time (Date.now()) for queue-wait measurement. Omit when unknown. */
  receivedAtMs?: number;
}

export interface ModerationResult {
  decisions: Decision[];
  entry: ModerationLogEntry;
  transcriptText: string;
  costUsd: number;
  mode: ModerationMode;
  debug: ChunkDebug;
}

/**
 * What a failed visual check does in live mode. Closed (default) blurs the
 * frame in full; open releases it unblurred with a warning, for demo testing.
 * Audio always fails closed; this switch never affects it.
 */
export function visualFailMode(): 'closed' | 'open' {
  return process.env.VISUAL_FAIL_MODE === 'open' ? 'open' : 'closed';
}

/**
 * Short safe error detail for logs: message plus one level of cause
 * (network errors hide the reason there), truncated, never secrets.
 */
export function errorDetail(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const cause =
    e instanceof Error && e.cause instanceof Error && e.cause.message !== msg
      ? ` (${e.cause.message})`
      : '';
  return `${msg}${cause}`.slice(0, 300);
}

const SEVERITY: ModerationAction[] = ['bleep', 'blur', 'warn', 'allow'];

/**
 * Map an offending word/phrase onto chunk-relative bleep windows.
 * Voice gives turn-level times, so the window is the word's proportional
 * slice of its turn (±100ms padding, clamped to the turn).
 */
export function bleepWindowsForTarget(turns: TranscriptTurn[], target: string): Array<{ startMs: number; endMs: number }> {
  const needle = target.toLowerCase();
  if (!needle) return [{ startMs: 0, endMs: 2000 }];
  const windows: Array<{ startMs: number; endMs: number }> = [];
  for (const turn of turns) {
    const hay = turn.transcript.toLowerCase();
    const idx = hay.indexOf(needle);
    if (idx < 0 || turn.transcript.length === 0) continue;
    const dur = turn.endMs - turn.startMs;
    const start = turn.startMs + (idx / turn.transcript.length) * dur - 100;
    const end = turn.startMs + ((idx + needle.length) / turn.transcript.length) * dur + 100;
    windows.push({
      startMs: Math.max(turn.startMs, Math.round(start)),
      endMs: Math.min(turn.endMs, Math.round(end)),
    });
  }
  return windows.length > 0 ? windows : [{ startMs: 0, endMs: 2000 }];
}

export async function moderateChunk(args: ModerateArgs): Promise<ModerationResult> {
  const requested = moderationMode();
  // Hard cap: over budget always falls back to mock, even when live is requested.
  const mode: ModerationMode = args.tracker.capped ? 'mock' : requested;
  const fellBack = mode !== requested;
  let costUsd = 0;
  const queueMs = args.receivedAtMs ? Math.max(0, Date.now() - args.receivedAtMs) : 0;

  // Transcription and visual detection run concurrently; the judge still needs
  // the transcript, so it runs after. Each stage fails independently, keeping
  // its error detail and duration for the debug payload.
  async function runTranscribe(): Promise<{
    text: string;
    turns: TranscriptTurn[];
    language: string;
    costUsd: number;
    ms: number;
    error: string | null;
  }> {
    const start = Date.now();
    try {
      const t = await transcribeChunk(args.wav, args.seq, mode);
      return {
        text: t.transcript.text,
        turns: t.transcript.turns,
        language: t.transcript.language ?? 'unknown',
        costUsd: t.costUsd,
        ms: Date.now() - start,
        error: null,
      };
    } catch (e) {
      return { text: '', turns: [], language: 'unknown', costUsd: 0, ms: Date.now() - start, error: errorDetail(e) };
    }
  }
  async function runDetect(): Promise<{
    flags: VisualFlag[];
    costUsd: number;
    ms: number;
    error: string | null;
    detail?: SamBreakdown;
  }> {
    const start = Date.now();
    try {
      const v = await detectVisual(args.video, args.seq, mode);
      return {
        flags: v.flags,
        costUsd: v.costUsd,
        ms: Date.now() - start,
        error: null,
        ...(v.detail ? { detail: v.detail } : {}),
      };
    } catch (e) {
      return { flags: [], costUsd: 0, ms: Date.now() - start, error: errorDetail(e) };
    }
  }
  const [tx, det] = await Promise.all([runTranscribe(), runDetect()]);
  costUsd += tx.costUsd + det.costUsd;
  const transcriptText = tx.text;
  const turns = tx.turns;

  const decisions: Decision[] = [];
  // Fail closed in live mode: a dead stage censors the whole chunk instead of
  // releasing it unmodified. Mock mode never fails, so it is unchanged.
  // Audio always fails closed; only visuals honor VISUAL_FAIL_MODE=open.
  if (tx.error && mode === 'live') {
    decisions.push({
      action: 'bleep',
      reason: `moderation unavailable: transcription failed (${tx.error}); audio muted in full`,
      startMs: 0,
      endMs: 2000,
    });
  }
  if (det.error && mode === 'live') {
    if (visualFailMode() === 'open') {
      decisions.push({
        action: 'warn',
        reason: `visual check failed (${det.error}); released unblurred (VISUAL_FAIL_MODE=open)`,
      });
    } else {
      decisions.push({
        action: 'blur',
        reason: `moderation unavailable: visual detection failed (${det.error}); frame blurred in full`,
        startMs: 0,
        endMs: 2000,
        box: { x: 0, y: 0, w: 1, h: 1 },
        label: 'full frame (moderation unavailable)',
      });
    }
  }
  for (const flag of det.flags) {
    const rule = flag.ruleId ? ruleById(flag.ruleId) : undefined;
    decisions.push({
      action: 'blur' as const,
      reason: rule ? `rule ${rule.id}: ${rule.title}` : `visual match "${flag.label}"`,
      startMs: flag.startMs,
      endMs: flag.endMs,
      box: flag.box,
      label: flag.label,
      ...(flag.ruleId ? { ruleId: flag.ruleId } : {}),
      ...(rule ? { explanation: rule.explanation } : {}),
    });
  }

  let judgeReason = mode === 'mock' ? 'mock: nothing flagged' : 'nothing flagged';
  let judgeAction: ModerationAction = 'allow';
  let judgeMs = 0;
  let judgeError: string | null = null;
  let judgeSkipped = false;
  if (transcriptText.trim().length > 0) {
    // The judge only acts on rulebook matches, so a transcript with no rule
    // candidate needs no call at all (saves ~7s and the Spark tokens).
    if (audioRulesMatching(transcriptText).length === 0) {
      judgeSkipped = true;
    } else {
      const judgeStart = Date.now();
      try {
        const j = await judgeContext(
          { recentTranscript: args.recentTranscript, chunkTranscript: transcriptText },
          mode,
        );
        judgeMs = Date.now() - judgeStart;
        costUsd += j.costUsd;
        judgeAction = j.verdict.action;
        judgeReason = j.verdict.reason;
        if (j.verdict.action === 'bleep') {
          const rule = audioRuleForTarget(j.verdict.target ?? '');
          for (const w of bleepWindowsForTarget(turns, j.verdict.target ?? '')) {
            decisions.push({
              action: 'bleep',
              reason: rule ? `rule ${rule.id}: ${judgeReason}` : judgeReason,
              startMs: w.startMs,
              endMs: w.endMs,
              ...(rule ? { ruleId: rule.id, explanation: rule.explanation } : {}),
            });
          }
        } else if (j.verdict.action === 'warn') {
          decisions.push({ action: 'warn', reason: judgeReason });
        }
      } catch (e) {
        judgeMs = Date.now() - judgeStart;
        judgeError = errorDetail(e);
        judgeAction = 'allow';
        judgeReason = 'judge unavailable; released after delay';
      }
    }
  }

  args.tracker.add(costUsd);

  const actions = new Set(decisions.map((d) => d.action));
  actions.add(judgeAction);
  const entryAction = SEVERITY.find((a) => actions.has(a)) ?? 'allow';
  const reasonParts: string[] = [];
  if (fellBack) reasonParts.push('spend cap reached; mock fallback.');
  if (tx.error && mode === 'live') {
    reasonParts.push(`moderation unavailable: transcription failed (${tx.error}), bleeped in full.`);
  }
  if (det.error && mode === 'live') {
    if (visualFailMode() === 'open') {
      reasonParts.push(`visual check failed (${det.error}); released unblurred (VISUAL_FAIL_MODE=open).`);
    } else {
      reasonParts.push(
        `moderation unavailable: visual detection failed (${det.error}), blurred in full.`,
      );
    }
  }
  if (!det.error && decisions.some((d) => d.action === 'blur')) {
    reasonParts.push('blur: visual match.');
  }
  reasonParts.push(judgeReason);
  if (transcriptText.trim().length === 0 && decisions.length === 0) {
    reasonParts.push('(no speech detected)');
  }

  const primary = SEVERITY.flatMap((a) => decisions.filter((d) => d.action === a))[0];
  const errors: ChunkDebug['errors'] = {};
  if (tx.error) errors.voice = tx.error;
  if (det.error) errors.sam = det.error;
  if (judgeError) errors.judge = judgeError;
  return {
    decisions,
    entry: {
      seq: args.seq,
      at: new Date().toISOString(),
      action: entryAction,
      reason: reasonParts.join(' '),
      ...(primary?.ruleId ? { ruleId: primary.ruleId } : {}),
      ...(primary?.explanation ? { explanation: primary.explanation } : {}),
    },
    transcriptText,
    costUsd,
    mode,
    debug: {
      transcript: transcriptText,
      language: tx.language,
      matchedRule: primary?.ruleId ?? null,
      judgeSkipped,
      timingsMs: { queueMs, voiceMs: tx.ms, samMs: det.ms, judgeMs },
      errors,
      ...(det.detail ? { samBreakdown: det.detail } : {}),
      ...(args.receivedAtMs ? { receivedAtMs: args.receivedAtMs } : {}),
    },
  };
}
