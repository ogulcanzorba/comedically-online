export type ModerationAction = 'allow' | 'bleep' | 'blur' | 'warn';

export type ModerationMode = 'mock' | 'live';

export interface TranscriptWord {
  word: string;
  startMs: number;
  endMs: number;
}

/** Normalized 0..1 box relative to the video frame. */
export interface NormBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VisualFlag {
  startMs: number;
  endMs: number;
  box: NormBox;
  label: string;
}

export interface Decision {
  action: ModerationAction;
  reason: string;
  /** Chunk-relative ms window for bleep/blur; omit for whole-chunk warn. */
  startMs?: number;
  endMs?: number;
  box?: NormBox;
  label?: string;
}

export interface ModerationLogEntry {
  seq: number;
  at: string;
  action: ModerationAction;
  reason: string;
}
