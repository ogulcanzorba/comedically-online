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
