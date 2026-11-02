import type { Decision, ModerationLogEntry } from '../moderation/types';

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
 * each binary frame. `seq` is the studio's chunk counter; webm and wav
 * frames sharing a seq belong to the same 2s window.
 */
export interface MediaMetaMessage {
  type: 'media';
  kind: 'webm' | 'wav';
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
}

/** Server -> publisher: one moderation log entry per chunk (or rule update). */
export interface LogBroadcast {
  type: 'log';
  entry: ModerationLogEntry;
}

export type ServerMessage = ChunkMetaMessage | LogBroadcast;
