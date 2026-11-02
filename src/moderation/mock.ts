import type { TranscriptTurn } from './types';
import { audioBleepRules } from './rulebook';

/**
 * Harmless demo stand-ins, driven by the rulebook file.
 * The demo never uses real explicit content.
 */
export const MOCK_BANNED_WORD: string = audioBleepRules()[0]?.match ?? 'waffle';
export const MOCK_BANNED_RULE_ID: string | undefined = audioBleepRules()[0]?.id;

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
