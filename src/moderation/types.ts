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
  /** Receipt to moderation start (audio wait + pool queue). */
  queueMs: number;
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
  /** True when the judge call was skipped (transcript held no rule candidate). */
  judgeSkipped: boolean;
  timingsMs: ChunkTimings;
  /** Raw stage errors (sanitized, truncated, never secrets). Omitted when empty. */
  errors: { voice?: string; sam?: string; judge?: string };
  /** Per-concept SAM breakdown (live visual checks only). */
  samBreakdown?: SamBreakdown;
  /** Server receipt time (Date.now()); queueMs is measured from this. */
  receivedAtMs?: number;
}

/** One concept's SAM image result inside a chunk. */
export interface SamConceptDebug {
  ruleId: string;
  /** Sampled frames the concept ran on (1, or 2 with SAM_FRAMES_PER_CHUNK=2). */
  frames: number;
  boxes: number;
  /** Mean box confidence when the model reports it, else null. */
  confidence: number | null;
  /** Time to first response token (server queue + compute + network). */
  ttfbMs: number;
  ms: number;
  /** HTTP attempts behind this concept (SDK retries on 408/409/429/5xx). */
  attempts: number;
  /** True when a video confirm call refined this concept's flags. */
  confirmed: boolean;
  /** Confirm video call duration, when one ran. */
  confirmMs: number | null;
}

/** Where one chunk's visual time went: JPEG extract plus per-concept calls. */
export interface SamBreakdown {
  extractMs: number;
  /** 'client' when the studio's canvas frame was used, else server extract. */
  source: 'client' | 'server';
  concepts: SamConceptDebug[];
}
