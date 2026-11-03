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
  /**
   * Frame-localized range (Spark frame indices): the pipeline blurs exactly
   * this window instead of the whole chunk. Absent for SAM/gate whole-chunk
   * flags.
   */
  precise?: boolean;
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
  /** Bleep-timing half-chunk re-transcription (audio positives only). */
  halvesMs?: number;
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
  errors: { voice?: string; vision?: string; judge?: string };
  /** Per-concept SAM breakdown (live visual checks only). */
  samBreakdown?: SamBreakdown;
  /** VLM gate breakdown (live visual checks via the gate strategy only). */
  gateBreakdown?: GateBreakdown;
  /** Spark classifier breakdown (live visual checks via spark only). */
  visionBreakdown?: VisionBreakdown;
  /** Fallback window hit the previous chunk's half: bleep it in full too. */
  fallbackHitPrev?: boolean;
  /** Rule behind a fallback whole-chunk bleep (for the relay's prev-chunk copy). */
  fallbackRuleId?: string;
  /** Server receipt time (Date.now()); queueMs is measured from this. */
  receivedAtMs?: number;
}

/** One concept's SAM image result inside a chunk. */
export interface SamConceptDebug {
  ruleId: string;
  /** Sampled frames the concept ran on (FRAMES_PER_CHUNK, default 4). */
  frames: number;
  boxes: number;
  /** Mean box confidence when the model reports it, else null. */
  confidence: number | null;
  /** Time to first response token (server queue + compute + network). */
  ttfbMs: number;
  ms: number;
  /** HTTP attempts behind this concept (image calls never retry: attempts == calls). */
  attempts: number;
  /** Frames whose call failed (a hit on any surviving frame still flags). */
  failedFrames: number;
}

/** Where one chunk's visual time went: JPEG extract plus per-concept calls. */
export interface SamBreakdown {
  extractMs: number;
  /** 'client' when the studio's canvas frame was used, else server extract. */
  source: 'client' | 'server';
  concepts: SamConceptDebug[];
}

/** One gated frame's verdict inside a chunk. */
export interface GateFrameDebug {
  /** Index into the chunk's sampled frames. */
  frame: number;
  frameMs: number;
  verdict: 'clean' | 'three-fingers' | 'nose-touch';
}

/** Where one chunk's gate time went: JPEG extract plus per-frame verdicts. */
export interface GateBreakdown {
  extractMs: number;
  /** 'client' when the studio's canvas frames were used, else server extract. */
  source: 'client' | 'server';
  frames: GateFrameDebug[];
  ms: number;
  failedFrames: number;
}

/** One rule's verdict from the Spark multi-frame classifier. */
export interface VisionRuleResult {
  id: string;
  present: boolean;
  confidence: number;
  /** 0-based indices into the call's labeled frames. */
  frameIndices: number[];
}

/** Where one chunk's Spark vision time/tokens went. */
export interface VisionBreakdown {
  model: string;
  effort: string;
  /** Frames in the call (prev overlap + current). */
  frames: number;
  prevFrames: number;
  results: VisionRuleResult[];
  decision: 'hit' | 'clean';
  topRuleId: string | null;
  maxConfidence: number;
  secondCall: boolean;
  ms: number;
  inputTokens: number;
  outputTokens: number;
}
