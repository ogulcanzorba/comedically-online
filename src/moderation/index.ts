import type {
  Decision,
  ModerationAction,
  ModerationLogEntry,
  ModerationMode,
  VisualFlag,
} from './types';
import type { TranscriptTurn } from './types';
import { transcribeChunk } from './transcribe';
import { detectVisual } from './detect-visual';
import { judgeContext } from './judge';
import { audioBleepRules, ruleById } from './rulebook';
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
}

export interface ModerationResult {
  decisions: Decision[];
  entry: ModerationLogEntry;
  transcriptText: string;
  costUsd: number;
  mode: ModerationMode;
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

  // Transcription and visual detection run concurrently; the judge still needs
  // the transcript, so it runs after. Each stage fails independently.
  async function runTranscribe(): Promise<{
    text: string;
    turns: TranscriptTurn[];
    costUsd: number;
    failed: boolean;
  }> {
    try {
      const t = await transcribeChunk(args.wav, args.seq, mode);
      return { text: t.transcript.text, turns: t.transcript.turns, costUsd: t.costUsd, failed: false };
    } catch {
      return { text: '', turns: [], costUsd: 0, failed: true };
    }
  }
  async function runDetect(): Promise<{ flags: VisualFlag[]; costUsd: number; failed: boolean }> {
    try {
      const v = await detectVisual(args.video, args.seq, mode);
      return { flags: v.flags, costUsd: v.costUsd, failed: false };
    } catch {
      return { flags: [], costUsd: 0, failed: true };
    }
  }
  const [tx, det] = await Promise.all([runTranscribe(), runDetect()]);
  costUsd += tx.costUsd + det.costUsd;
  const transcriptText = tx.text;
  const turns = tx.turns;

  const decisions: Decision[] = [];
  // Fail closed in live mode: a dead stage censors the whole chunk instead of
  // releasing it unmodified. Mock mode never fails, so it is unchanged.
  if (tx.failed && mode === 'live') {
    decisions.push({
      action: 'bleep',
      reason: 'moderation unavailable: transcription failed; audio muted in full',
      startMs: 0,
      endMs: 2000,
    });
  }
  if (det.failed && mode === 'live') {
    decisions.push({
      action: 'blur',
      reason: 'moderation unavailable: visual detection failed; frame blurred in full',
      startMs: 0,
      endMs: 2000,
      box: { x: 0, y: 0, w: 1, h: 1 },
      label: 'full frame (moderation unavailable)',
    });
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
  if (transcriptText.trim().length > 0) {
    try {
      const j = await judgeContext(
        { recentTranscript: args.recentTranscript, chunkTranscript: transcriptText },
        mode,
      );
      costUsd += j.costUsd;
      judgeAction = j.verdict.action;
      judgeReason = j.verdict.reason;
      if (j.verdict.action === 'bleep') {
        const target = (j.verdict.target ?? '').toLowerCase();
        const rule = audioBleepRules().find((r) => r.match.toLowerCase() === target);
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
    } catch {
      judgeAction = 'allow';
      judgeReason = 'judge unavailable; released after delay';
    }
  }

  args.tracker.add(costUsd);

  const actions = new Set(decisions.map((d) => d.action));
  actions.add(judgeAction);
  const entryAction = SEVERITY.find((a) => actions.has(a)) ?? 'allow';
  const reasonParts: string[] = [];
  if (fellBack) reasonParts.push('spend cap reached; mock fallback.');
  if (tx.failed && mode === 'live') {
    reasonParts.push('moderation unavailable: transcription failed, bleeped in full.');
  }
  if (det.failed && mode === 'live') {
    reasonParts.push('moderation unavailable: visual detection failed, blurred in full.');
  }
  if (!det.failed && decisions.some((d) => d.action === 'blur')) {
    reasonParts.push('blur: visual match.');
  }
  reasonParts.push(judgeReason);
  if (transcriptText.trim().length === 0 && decisions.length === 0) {
    reasonParts.push('(no speech detected)');
  }

  const primary = SEVERITY.flatMap((a) => decisions.filter((d) => d.action === a))[0];
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
  };
}
