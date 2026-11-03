/**
 * Turkish-aware fuzzy matching for realtime transcripts. Normalization and
 * distance thresholds follow the moderation spec: Turkish lowercase, ASCII
 * folding, repeated-letter collapse, Levenshtein <= 1 (<= 5 chars) or <= 2
 * (longer), plus bigrams joined without space (catches ASR word splits).
 */

/** Turkish-aware lowercase: dotted/dotless I handled before folding. */
export function normalizeTrToken(raw: string): string {
  return raw
    .replace(/I/g, 'ı')
    .replace(/İ/g, 'i')
    .toLowerCase()
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/[^a-z0-9]/g, '')
    .replace(/(.)\1+/g, '$1');
}

/** Split text into normalized tokens, dropping empties. */
export function tokenizeTr(text: string): string[] {
  return text
    .replace(/I/g, 'ı')
    .replace(/İ/g, 'i')
    .toLowerCase()
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .split(/[^a-z0-9]+/g)
    .map((t) => t.replace(/(.)\1+/g, '$1'))
    .filter((t) => t.length > 0);
}

/**
 * Capped Levenshtein distance. Returns a value > cap when the true distance
 * exceeds it (early exit, no full matrix needed past the cap).
 */
export function levenshtein(a: string, b: string, cap: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let rowMin = i;
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, next[j - 1] + 1, prev[j - 1] + cost);
      next.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > cap) return cap + 1;
    prev = next;
  }
  return prev[b.length];
}

/** Max edit distance for a banned spelling of this length. */
export function fuzzyThreshold(normalizedBanned: string): number {
  return normalizedBanned.length <= 5 ? 1 : 2;
}

export interface BannedSpelling {
  ruleId: string;
  /** Canonical match or alias, raw (normalized internally). */
  spelling: string;
}

export interface FuzzyHit {
  ruleId: string;
  spelling: string;
  /** Matched surface token(s), normalized. */
  token: string;
  /** Token index of the hit (bigram: index of the first token). */
  tokenIndex: number;
  /** Ordinal of this (rule, token) occurrence in the scanned text. */
  ordinal: number;
  distance: number;
  /** True for verbatim/prefix matches (bleep at once, no judge). */
  exact: boolean;
}

/**
 * Match normalized tokens against banned spellings. Exact when the token
 * equals the spelling or extends it (suffix inflection: "waffles"); fuzzy
 * within the length-based edit budget otherwise. Bigrams joined without
 * space catch ASR splits ("waf fle"). Each hit carries its occurrence
 * ordinal so cumulative partials can dedupe downstream.
 */
export function matchBanned(
  tokens: string[],
  banned: BannedSpelling[],
): FuzzyHit[] {
  const norm = banned
    .map((b) => ({ ...b, spelling: normalizeTrToken(b.spelling) }))
    .filter((b) => b.spelling.length > 0);
  const hits: FuzzyHit[] = [];
  const ordinals = new Map<string, number>();
  const push = (ruleId: string, spelling: string, token: string, tokenIndex: number, distance: number, exact: boolean) => {
    const key = `${ruleId} ${token}`;
    const ordinal = ordinals.get(key) ?? 0;
    ordinals.set(key, ordinal + 1);
    hits.push({ ruleId, spelling, token, tokenIndex, ordinal, distance, exact });
  };
  const test = (token: string, tokenIndex: number, allowPrefix: boolean) => {
    for (const b of norm) {
      if (token === b.spelling) {
        push(b.ruleId, b.spelling, token, tokenIndex, 0, true);
        continue;
      }
      // Suffix inflection ("waffles") counts as exact on single tokens; on
      // joined bigrams ("wafilyedim") it would duplicate the token hit, so
      // bigrams only match by edit distance.
      if (allowPrefix && token.length > b.spelling.length && token.startsWith(b.spelling)) {
        push(b.ruleId, b.spelling, token, tokenIndex, 0, true);
        continue;
      }
      const d = levenshtein(token, b.spelling, fuzzyThreshold(b.spelling));
      if (d <= fuzzyThreshold(b.spelling)) {
        push(b.ruleId, b.spelling, token, tokenIndex, d, d === 0);
      }
    }
  };
  tokens.forEach((t, i) => test(t, i, true));
  // Joined bigrams catch ASR splits ("waf fle"); skip pairs where either
  // part already matched exactly (avoids duplicate near-miss noise).
  const exactAt = new Set(hits.filter((h) => h.exact).map((h) => h.tokenIndex));
  for (let i = 0; i + 1 < tokens.length; i++) {
    if (exactAt.has(i) || exactAt.has(i + 1)) continue;
    test(tokens[i] + tokens[i + 1], i, false);
  }
  return hits;
}

/**
 * Dedupes cumulative-partial matches within a speech turn. Ordinals are
 * stable while the cumulative text only grows, so a repeated partial or a
 * final repeating the partial claims nothing new. A new turn id resets.
 */
export class OccurrenceTracker {
  private turn = '';
  private claimed = new Set<string>();

  beginTurn(turnId: string): void {
    if (turnId !== this.turn) {
      this.turn = turnId;
      this.claimed.clear();
    }
  }

  /** True when this occurrence was already flagged (skip it). */
  isClaimed(ruleId: string, token: string, ordinal: number): boolean {
    return this.claimed.has(`${ruleId} ${token} ${ordinal}`);
  }

  claim(ruleId: string, token: string, ordinal: number): void {
    this.claimed.add(`${ruleId} ${token} ${ordinal}`);
  }
}
