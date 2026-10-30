import type { TranscriptTurn } from './types';

/**
 * Harmless demo stand-ins. The demo never uses real explicit content:
 * an invented banned word, a fixed phone-screen box, and clean bits.
 */
export const MOCK_BANNED_WORD = 'blorpt';

const FAMILY_BIT = 'My mom calls every show. She says my jokes about our family are her favorite part.';
const CLEAN_BITS = [
  'I told the barista my name is Decaf. Now my cup just says disappointed.',
  'Airports are the only place where buying a $9 water feels like self-care.',
];

export interface MockTranscript {
  text: string;
  turns: TranscriptTurn[];
}

/** Deterministic per-chunk script so the demo is reproducible. */
export function mockTranscriptFor(seq: number): MockTranscript {
  let text: string;
  if (seq % 4 === 2) {
    text = `So my ex, ${MOCK_BANNED_WORD}, texted me during the show. Anyway.`;
  } else if (seq % 4 === 0) {
    text = FAMILY_BIT;
  } else {
    text = CLEAN_BITS[seq % CLEAN_BITS.length];
  }
  return { text, turns: [{ startMs: 0, endMs: 2000, transcript: text }] };
}

/** Every 5th chunk carries a fake phone-screen detection. */
export function mockVisualFlagFor(seq: number): boolean {
  return seq % 5 === 3;
}
