import { createHash } from 'node:crypto';
import data from './rulebook.json';

/**
 * Rulebook loader (server-only: uses node:crypto).
 * Client components that need rule titles import rulebook.json directly.
 */
export type RuleModality = 'text' | 'video' | 'audio';
export type RuleAction = 'bleep' | 'blur' | 'block';
export type RuleSeverity = 'low' | 'medium' | 'high';

export interface RulebookRule {
  id: string;
  modality: RuleModality;
  title: string;
  description: string;
  match: string;
  /** Alternate spellings/transcriptions that match the same rule (e.g. Turkish variants). */
  aliases?: string[];
  action: RuleAction;
  severity: RuleSeverity;
  explanation: string;
  examples: string[];
}

export const RULEBOOK_VERSION: string = data.version;
export const RULEBOOK_RULES: RulebookRule[] = data.rules as RulebookRule[];

/** Short hash of the rulebook file. Acceptance is stale when this changes. */
export const RULEBOOK_VERSION_HASH: string = createHash('sha256')
  .update(JSON.stringify(data))
  .digest('hex')
  .slice(0, 12);

export function ruleById(id: string): RulebookRule | undefined {
  return RULEBOOK_RULES.find((r) => r.id === id);
}

/** Audio bleep rules (spoken/transcribed words). */
export function audioBleepRules(): RulebookRule[] {
  return RULEBOOK_RULES.filter((r) => r.action === 'bleep');
}

/** Video blur rules (visual concepts). */
export function videoBlurRules(): RulebookRule[] {
  return RULEBOOK_RULES.filter((r) => r.modality === 'video' && r.action === 'blur');
}

/**
 * Normalize speech for rule matching: case-insensitive, punctuation-tolerant.
 * Letters/numbers survive (unicode-aware, so Turkish dotted letters work);
 * punctuation becomes a space so "waffle!" and "waffle" match alike.
 */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface AudioRuleMatch {
  rule: RulebookRule;
  /** The rule spelling that matched (canonical match or alias). */
  variant: string;
}

/**
 * Single-word variants match at a word START, tolerating trailing suffixes
 * (Turkish agglutination: "vaffle" matches "vafflelar"; English plurals:
 * "waffle" matches "waffles"). Mid-word hits ("xywaffle") do not match.
 * Multi-word variants fall back to substring matching.
 */
function variantMatches(words: string[], joined: string, variant: string): boolean {
  const norm = normalizeForMatch(variant);
  if (!norm) return false;
  if (!norm.includes(' ')) return words.some((w) => w.startsWith(norm));
  return joined.includes(norm);
}

/** Audio bleep rules matching the transcript, including aliases and suffixes. */
export function audioRulesMatching(transcript: string): AudioRuleMatch[] {
  const joined = normalizeForMatch(transcript);
  const words = joined.split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const hits: AudioRuleMatch[] = [];
  for (const rule of audioBleepRules()) {
    const variant = [rule.match, ...(rule.aliases ?? [])].find((m) =>
      variantMatches(words, joined, m),
    );
    if (variant !== undefined) hits.push({ rule, variant });
  }
  return hits;
}

/** Find the audio rule a judge target belongs to (normalized, aliases, suffixes). */
export function audioRuleForTarget(target: string): RulebookRule | undefined {
  const joined = normalizeForMatch(target);
  const words = joined.split(' ').filter(Boolean);
  return audioBleepRules().find((r) =>
    [r.match, ...(r.aliases ?? [])].some((m) => variantMatches(words, joined, m)),
  );
}
