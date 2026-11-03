import type { ChunkDebug, Decision, ModerationLogEntry } from '../moderation/types';

export const WS_PATH = '/ws';

export type ClientRole = 'publisher' | 'viewer';

/**
 * Publisher -> server: legacy free-text moderation rules.
 * @deprecated Rules come only from the platform rulebook now. The server
 * accepts this message for backward compatibility but ignores its contents.
 */
export interface RulesMessage {
  type: 'rules';
  rules: string[];
}

/**
 * Publisher -> server: header sent as a JSON text frame immediately before
 * each binary frame. `seq` is the studio's chunk counter; webm, wav, and jpg
 * frames sharing a seq belong to the same 2s window. The jpg is the studio's
 * canvas capture at ~t=1.0s (320px JPEG); without it the server extracts the
 * sample frame from the webm itself.
 */
export interface MediaMetaMessage {
  type: 'media';
  kind: 'webm' | 'wav' | 'jpg';
  seq: number;
}

/**
 * Server -> viewer: metadata sent as a JSON text frame immediately before
 * the chunk's binary frame. Pair them in arrival order.
 */
export interface ChunkMetaMessage {
  type: 'chunk';
  seq: number;
  /** True when these bytes carry the WebM init segment (first bytes a viewer needs). */
  init: boolean;
  decisions: Decision[];
  receiptTimeMs: number;
  /** Per-chunk debug detail (transcript, language, rule, timings, errors). Absent for init sends. */
  debug?: ChunkDebug;
}

/** Server -> publisher: one moderation log entry per chunk (or rule update). */
export interface LogBroadcast {
  type: 'log';
  entry: ModerationLogEntry;
}

/** Publisher -> server: broadcast over; drain the buffer, then end the stream. */
export interface EndBroadcastMessage {
  type: 'end-broadcast';
}

/** Server -> publisher: drain progress while ending (chunks still held). */
export interface DrainProgressMessage {
  type: 'drain';
  pending: number;
}

/** Server -> publisher: drain complete, stream over. */
export interface StreamEndedMessage {
  type: 'ended';
}

/** Server -> viewer: the delayed stream has fully played out. */
export interface EndOfStreamMessage {
  type: 'end';
}

export type ServerMessage = ChunkMetaMessage | LogBroadcast;
