import type { Decision, ModerationLogEntry } from '../moderation/types';

export const WS_PATH = '/ws';

export type ClientRole = 'publisher' | 'viewer';

/** Publisher -> server: moderation rules in plain language. */
export interface RulesMessage {
  type: 'rules';
  rules: string[];
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
