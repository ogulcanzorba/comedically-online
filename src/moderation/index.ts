import type {
  ChunkDebug,
  Decision,
  GateBreakdown,
  ModerationAction,
  ModerationLogEntry,
  ModerationMode,
  SamBreakdown,
  VisionBreakdown,
  VisualFlag,
} from './types';
import type { TranscriptTurn } from './types';
import { transcribeChunk, transcribeHalves, wavHalfBoundaryMs } from './transcribe';
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
  /** Studio canvas captures; skips server ffmpeg when any arrive. */
  frameJpgs?: Buffer[];
  /** Previous chunk's canvas captures (Spark overlap input). */
  prevFrameJpgs?: Buffer[];
  /**
   * Duration (ms) of the previous chunk's audio prepended to `wav`, forming
   * the 4s overlapping fallback window (0 when the window holds only this
   * chunk). Live mode only; mock ignores it.
   */
  wavPrevMs?: number;
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

/** Label on whole-chunk fallback bleeps (skipped when realtime covers the chunk). */
export const FALLBACK_LABEL = 'fallback';

/** Bleep gaps below this merge into one window (avoids stutter mute). */
export const BLEEP_MERGE_GAP_MS = 200;

/**
 * Add a bleep to a chunk's decisions, merging with same-rule bleeps whose
 * windows overlap or nearly touch (one occurrence = one window, no matter
 * which source — exact, fuzzy, judge, fallback — scheduled it). The merged
 * window is the union; label/reason stay with the earliest decision.
 */
export function mergeBleepWindow(existing: Decision[], incoming: Decision): Decision[] {
  if (incoming.action !== 'bleep' || !incoming.ruleId) return [...existing, incoming];
  const s = incoming.startMs ?? 0;
  const e = incoming.endMs ?? 2000;
  const overlapping = existing.filter(
    (d) =>
      d.action === 'bleep' &&
      d.ruleId === incoming.ruleId &&
      (d.startMs ?? 0) <= e + BLEEP_MERGE_GAP_MS &&
      (d.endMs ?? 2000) >= s - BLEEP_MERGE_GAP_MS,
  );
  if (overlapping.length === 0) return [...existing, incoming];
  const rest = existing.filter((d) => !overlapping.includes(d));
  const first = overlapping[0];
  const startMs = Math.min(s, ...overlapping.map((d) => d.startMs ?? 0));
  const endMs = Math.max(e, ...overlapping.map((d) => d.endMs ?? 2000));
  const merged: Decision = { ...first, startMs, endMs };
  // Keep chronological order by window start for stable rendering.
  const out = [...rest, merged];
  out.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
  return out;
}

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
      // Half-chunk turn offsets can be fractional; the player wants integer ms.
      startMs: Math.max(Math.round(turn.startMs), Math.round(start)),
      endMs: Math.min(Math.round(turn.endMs), Math.round(end)),
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
    gateDetail?: GateBreakdown;
    visionDetail?: VisionBreakdown;
  }> {
    const start = Date.now();
    try {
      const v = await detectVisual(
        args.video,
        args.seq,
        mode,
        args.frameJpgs ?? [],
        args.prevFrameJpgs ?? [],
      );
      return {
        flags: v.flags,
        costUsd: v.costUsd,
        ms: Date.now() - start,
        error: null,
        ...(v.detail ? { detail: v.detail } : {}),
        ...(v.gateDetail ? { gateDetail: v.gateDetail } : {}),
        ...(v.visionDetail ? { visionDetail: v.visionDetail } : {}),
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
  // Video-rule flags censor the whole frame; frame-localized (precise)
  // flags blur only their positive-frame range, the rest the whole chunk.
  // Spark precise flags are superseded by the relay's gesture tracker (which
  // rebuilds windows from frameVerdicts across chunks), so they map to no
  // decision here; mock precise windows still map (no visionDetail in mock).
  const tracked = det.visionDetail !== undefined;
  for (const flag of det.flags) {
    if (tracked && flag.precise === true) continue;
    const rule = flag.ruleId ? ruleById(flag.ruleId) : undefined;
    const precise = flag.precise === true;
    const startMs = precise ? Math.max(0, Math.min(2000, Math.round(flag.startMs))) : 0;
    const endMs = precise ? Math.max(startMs, Math.min(2000, Math.round(flag.endMs))) : 2000;
    decisions.push({
      action: 'blur' as const,
      reason:
        (rule ? `rule ${rule.id}: ${rule.title}` : `visual match "${flag.label}"`) +
        (precise ? ` (${startMs}–${endMs}ms)` : ''),
      startMs,
      endMs,
      box: { x: 0, y: 0, w: 1, h: 1 },
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
  let halvesMs: number | undefined;
  let fallbackHitPrev = false;
  let fallbackRuleId: string | undefined;
  if (transcriptText.trim().length > 0) {
    // The judge only acts on rulebook matches, so a transcript with no rule
    // candidate needs no call at all (saves ~2s and the Spark tokens).
    if (audioRulesMatching(transcriptText).length === 0) {
      judgeSkipped = true;
    } else {
      const judgeStart = Date.now();
      try {
        // Judge and timing refinement run together: halves re-transcription
        // only feeds the bleep window, so its failure must not lose the
        // verdict (falls back to full-chunk turns below).
        const [j, halves] = await Promise.all([
          judgeContext(
            { recentTranscript: args.recentTranscript, chunkTranscript: transcriptText },
            mode,
          ),
          transcribeHalves(args.wav, args.seq, mode).catch(
            (): { turns: TranscriptTurn[]; costUsd: number; ms: number } => ({
              turns: [],
              costUsd: 0,
              ms: -1,
            }),
          ),
        ]);
        judgeMs = Date.now() - judgeStart;
        halvesMs = halves.ms >= 0 ? halves.ms : judgeMs;
        costUsd += j.costUsd + halves.costUsd;
        judgeAction = j.verdict.action;
        judgeReason = j.verdict.reason;
        if (j.verdict.action === 'bleep') {
          const target = j.verdict.target ?? '';
          const rule = audioRuleForTarget(target);
          if (mode === 'live') {
            // 4s overlapping fallback window (prev + current chunk): the
            // halves are the two 2s parts, so they decide WHICH overlapping
            // chunk(s) bleep in full. Boundary-split or unknown placement
            // bleeps both (fail-closed); the relay skips chunks a realtime
            // bleep already covers.
            const needle = target.toLowerCase();
            const boundary = args.wav ? wavHalfBoundaryMs(args.wav) : 2000;
            const halfText = (first: boolean): string =>
              halves.turns
                .filter((t) => (t.startMs < boundary) === first)
                .map((t) => t.transcript.toLowerCase())
                .join(' ');
            const hitFirst = needle.trim().length > 0 && halfText(true).includes(needle);
            const hitSecond = needle.trim().length > 0 && halfText(false).includes(needle);
            const unknown = !hitFirst && !hitSecond;
            const hasPrev = (args.wavPrevMs ?? 0) > 0;
            if (hitSecond || unknown || (!hasPrev && hitFirst)) {
              decisions.push({
                action: 'bleep',
                reason: rule ? `rule ${rule.id}: ${judgeReason} (fallback window)` : `${judgeReason} (fallback window)`,
                startMs: 0,
                endMs: 2000,
                label: FALLBACK_LABEL,
                ...(rule ? { ruleId: rule.id, explanation: rule.explanation } : {}),
              });
            }
            if (hasPrev && (hitFirst || unknown)) {
              fallbackHitPrev = true;
              fallbackRuleId = rule?.id;
            }
          } else {
            // Mock keeps the scripted precise windows (covered by mock tests).
            const timingTurns =
              target.trim().length > 0 &&
              halves.turns.some((t) => t.transcript.toLowerCase().includes(target.toLowerCase()))
                ? halves.turns
                : turns;
            for (const w of bleepWindowsForTarget(timingTurns, target)) {
              decisions.push({
                action: 'bleep',
                reason: rule ? `rule ${rule.id}: ${judgeReason}` : judgeReason,
                startMs: w.startMs,
                endMs: w.endMs,
                ...(rule ? { ruleId: rule.id, explanation: rule.explanation } : {}),
              });
            }
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
  if (det.error) errors.vision = det.error;
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
      timingsMs: {
        queueMs,
        voiceMs: tx.ms,
        samMs: det.ms,
        judgeMs,
        ...(halvesMs !== undefined ? { halvesMs } : {}),
      },
      errors,
      ...(det.detail ? { samBreakdown: det.detail } : {}),
      ...(det.gateDetail ? { gateBreakdown: det.gateDetail } : {}),
      ...(det.visionDetail ? { visionBreakdown: det.visionDetail } : {}),
      ...(fallbackHitPrev ? { fallbackHitPrev: true as const } : {}),
      ...(fallbackRuleId ? { fallbackRuleId } : {}),
      ...(args.receivedAtMs ? { receivedAtMs: args.receivedAtMs } : {}),
    },
  };
}
