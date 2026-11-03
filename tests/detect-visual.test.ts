import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  conceptsFromRulebook,
  flagsForImageHit,
  parseSamOutput,
} from '../src/moderation/detect-visual';

describe('parseSamOutput image shape', () => {
  it('parses a single-frame image response', () => {
    const records = parseSamOutput('<0f>0<|box;x1=80;y1=70;x2=129;y2=119;w=320;h=180|>');
    assert.equal(records.length, 1);
    assert.deepEqual(records[0], {
      frame: 0,
      id: 0,
      box: { x: 80 / 320, y: 70 / 180, w: 49 / 320, h: 49 / 180 },
    });
  });
});

describe('flagsForImageHit', () => {
  const box = { x: 0.25, y: 0.4, w: 0.15, h: 0.27 };

  it('blurs the returned box over the frame time ±1s', () => {
    const flags = flagsForImageHit('hand showing three fingers', 'hand-gesture-three', [
      { frame: 0, id: 0, box },
    ]);
    assert.deepEqual(flags, [
      {
        startMs: 0,
        endMs: 2000,
        box,
        label: 'hand showing three fingers',
        ruleId: 'hand-gesture-three',
      },
    ]);
  });

  it('keeps one flag per object id', () => {
    const other = { x: 0.6, y: 0.1, w: 0.1, h: 0.1 };
    const flags = flagsForImageHit('concept', 'rule', [
      { frame: 0, id: 0, box },
      { frame: 0, id: 1, box: other },
    ]);
    assert.equal(flags.length, 2);
    assert.deepEqual(flags[1].box, other);
  });

  it('returns no flags without records', () => {
    assert.deepEqual(flagsForImageHit('concept', 'rule', []), []);
  });
});

describe('conceptsFromRulebook', () => {
  it('draws one concept per video rule with its rule id', () => {
    const concepts = conceptsFromRulebook();
    assert.equal(concepts.length, 2);
    for (const c of concepts) {
      assert.ok(c.concept.length > 0);
      assert.ok(typeof c.ruleId === 'string' && c.ruleId.length > 0);
    }
  });
});
