import type { Decision, ModerationLogEntry, ModerationMode } from './types';

export function moderationMode(): ModerationMode {
  return process.env.MODERATION_MODE === 'live' ? 'live' : 'mock';
}

export interface ModerateArgs {
  seq: number;
  /** Raw 2s WebM chunk. Day 2 splits this into audio/video for the adapters. */
  audio: Buffer;
  rules: string[];
}

export interface ModerationResult {
  decisions: Decision[];
  entry: ModerationLogEntry;
}

/** Day 1: passthrough so the 10s-delay relay can be proven first. */
export async function moderateChunk(args: ModerateArgs): Promise<ModerationResult> {
  return {
    decisions: [],
    entry: {
      seq: args.seq,
      at: new Date().toISOString(),
      action: 'allow',
      reason: 'passthrough (Day 1: moderation adapters land on Day 2)',
    },
  };
}
