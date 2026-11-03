import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fuzzyThreshold,
  levenshtein,
  matchBanned,
  normalizeTrToken,
  OccurrenceTracker,
  tokenizeTr,
} from '../src/moderation/fuzzy';

describe('normalizeTrToken', () => {
  it('folds Turkish letters to ASCII and collapses repeats', () => {
    assert.equal(normalizeTrToken('Çağıl'), 'cagil');
    assert.equal(normalizeTrToken('ŞÖYLE'), 'soyle');
    assert.equal(normalizeTrToken('waffle'), 'wafle');
    assert.equal(normalizeTrToken('vvaaffıl'), 'vafil');
    assert.equal(normalizeTrToken('IĞDIR'), 'igdir'); // dotless I -> i
    assert.equal(normalizeTrToken('İSTANBUL'), 'istanbul');
    assert.equal(normalizeTrToken('waffle!'), 'wafle');
    assert.equal(normalizeTrToken('123'), '123');
  });
});

describe('tokenizeTr', () => {
  it('splits on punctuation and whitespace, drops empties', () => {
    assert.deepEqual(tokenizeTr('Merhaba,  dünya!'), ['merhaba', 'dunya']);
    assert.deepEqual(tokenizeTr('  '), []);
    assert.deepEqual(tokenizeTr('bir-iki_üç'), ['bir', 'iki', 'uc']);
  });
});

describe('levenshtein', () => {
  it('counts edits and caps early', () => {
    assert.equal(levenshtein('wafle', 'wafle', 2), 0);
    assert.equal(levenshtein('wafle', 'vafle', 2), 1);
    assert.equal(levenshtein('wafle', 'vafile', 2), 2);
    assert.ok(levenshtein('wafle', 'vafil', 2) > 2);
    assert.ok(levenshtein('wafle', 'xyzabc', 2) > 2);
    assert.ok(levenshtein('ab', 'abcdefgh', 2) > 2);
  });
});

describe('fuzzyThreshold', () => {
  it('allows 1 edit up to 5 chars, 2 beyond', () => {
    assert.equal(fuzzyThreshold('wafle'), 1);
    assert.equal(fuzzyThreshold('vafil'), 1);
    assert.equal(fuzzyThreshold('vafli'), 1);
    assert.equal(fuzzyThreshold('vaflinda'), 2);
  });
});

describe('matchBanned', () => {
  const banned = [
    { ruleId: 'banned-word-waffle', spelling: 'waffle' },
    { ruleId: 'banned-word-waffle', spelling: 'vafıl' },
  ];

  it('matches verbatim and suffix inflections as exact', () => {
    const hits = matchBanned(['so', 'wafle'], banned);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].exact, true);
    assert.equal(hits[0].distance, 0);
    const plural = matchBanned(['wafles'], banned);
    assert.equal(plural.length, 1);
    assert.equal(plural[0].exact, true); // suffix inflection
  });

  it('matches Turkish spellings after folding', () => {
    const hits = matchBanned(tokenizeTr('VAFIL yedim'), banned);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].token, 'vafil');
    assert.equal(hits[0].exact, true);
  });

  it('matches near-misses as fuzzy within budget, rejects beyond', () => {
    const near = matchBanned(['vafle'], banned); // 1 edit from wafle
    assert.equal(near.length, 1);
    assert.equal(near[0].exact, false);
    assert.equal(near[0].distance, 1);
    assert.deepEqual(matchBanned(['xyzabc'], banned), []);
  });

  it('catches ASR word splits via joined bigrams', () => {
    const hits = matchBanned(['waf', 'le'], banned);
    const bigram = hits.find((h) => h.token === 'wafle');
    assert.ok(bigram);
    assert.equal(bigram.exact, true);
    assert.equal(bigram.tokenIndex, 0);
  });

  it('numbers ordinals per rule+token for cumulative dedupe', () => {
    const hits = matchBanned(['wafle', 'x', 'wafle'], banned);
    assert.equal(hits.length, 2);
    assert.equal(hits[0].ordinal, 0);
    assert.equal(hits[1].ordinal, 1);
  });
});

describe('OccurrenceTracker', () => {
  it('suppresses repeats within a turn, resets on a new turn', () => {
    const t = new OccurrenceTracker();
    t.beginTurn('3');
    assert.equal(t.isClaimed('r', 'wafle', 0), false);
    t.claim('r', 'wafle', 0);
    assert.equal(t.isClaimed('r', 'wafle', 0), true);
    assert.equal(t.isClaimed('r', 'wafle', 1), false);
    t.beginTurn('3'); // same turn: no reset
    assert.equal(t.isClaimed('r', 'wafle', 0), true);
    t.beginTurn('4'); // new turn: reset
    assert.equal(t.isClaimed('r', 'wafle', 0), false);
  });
});
