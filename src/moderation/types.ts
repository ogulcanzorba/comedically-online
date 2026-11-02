export type ModerationAction = 'allow' | 'bleep' | 'blur' | 'warn';

export type ModerationMode = 'mock' | 'live';

export interface TranscriptWord {
  word: string;
  startMs: number;
  endMs: number;
}

/** One speech turn (Voice ENDPOINTING gives turn-level, not word-level, times). */
export interface TranscriptTurn {
  startMs: number;
  endMs: number;
  transcript: string;
}

/** Normalized 0..1 box relative to the video frame. */
export interface NormBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Decision {
  action: ModerationAction;
  reason: string;
  /** Chunk-relative ms window for bleep/blur; omit for whole-chunk warn. */
  startMs?: number;
  endMs?: number;
  box?: NormBox;
  label?: string;
  /** Rulebook rule behind this decision, when one applies. */
  ruleId?: string;
  /** User-facing explanation of why (from the rulebook). */
  explanation?: string;
}

export interface VisualFlag {
  startMs: number;
  endMs: number;
  box: NormBox;
  label: string;
  ruleId?: string;
}

export interface ModerationLogEntry {
  seq: number;
  at: string;
  action: ModerationAction;
  reason: string;
  ruleId?: string;
  explanation?: string;
}

/** Per-stage durations for one chunk (voice and sam run concurrently). */
export interface ChunkTimings {
  voiceMs: number;
  samMs: number;
  judgeMs: number;
}

/** Per-chunk debug detail: what the models saw, matched, and cost in time. */
export interface ChunkDebug {
  transcript: string;
  /** Detected language tag, or 'unknown' when the API reports none. */
  language: string;
  /** Rulebook rule behind the primary decision, when one applies. */
  matchedRule: string | null;
  timingsMs: ChunkTimings;
  /** Raw stage errors (sanitized, truncated, never secrets). Omitted when empty. */
  errors: { voice?: string; sam?: string; judge?: string };
}
