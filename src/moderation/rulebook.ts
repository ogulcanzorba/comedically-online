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

/** Audio bleep rules matching the transcript, including aliases. */
export function audioRulesMatching(transcript: string): AudioRuleMatch[] {
  const norm = normalizeForMatch(transcript);
  if (!norm) return [];
  const hits: AudioRuleMatch[] = [];
  for (const rule of audioBleepRules()) {
    const variant = [rule.match, ...(rule.aliases ?? [])].find((m) =>
      norm.includes(normalizeForMatch(m)),
    );
    if (variant !== undefined) hits.push({ rule, variant });
  }
  return hits;
}

/** Find the audio rule a judge target belongs to (normalized, aliases included). */
export function audioRuleForTarget(target: string): RulebookRule | undefined {
  const norm = normalizeForMatch(target);
  return audioBleepRules().find((r) =>
    [r.match, ...(r.aliases ?? [])].some((m) => normalizeForMatch(m) === norm),
  );
}
