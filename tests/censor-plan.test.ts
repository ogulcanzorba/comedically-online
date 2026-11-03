import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Decision } from '../src/moderation/types';
import { activeBlursAt, formatSceneRange, isBleepedAt, planForBroadcast, sceneRangeS } from '../src/lib/censor-plan';

const BLEEP: Decision = { action: 'bleep', reason: 'r', startMs: 500, endMs: 900 };
const BLUR: Decision = {
  action: 'blur',
  reason: 'r',
  startMs: 0,
  endMs: 2000,
  box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
};
const WARN: Decision = { action: 'warn', reason: 'r' };

describe('planForBroadcast', () => {
  it('maps each flagged chunk onto scene seconds', () => {
    // Chunk 5 covers scene [10s,12s].
    const plan = planForBroadcast([{ seq: 5, decisions: [BLEEP, BLUR, WARN] }], 60);
    assert.deepEqual(plan.bleeps, [{ startS: 10.5, endS: 10.9 }]);
    assert.deepEqual(plan.blurs, [{ startS: 10, endS: 12, box: BLUR.box }]);
    assert.equal(plan.durationS, 60);
  });

  it('merges decisions across chunks and defaults missing windows', () => {
    const plan = planForBroadcast(
      [
        { seq: 0, decisions: [{ action: 'bleep', reason: 'r' }] },
        { seq: 3, decisions: [{ action: 'blur', reason: 'r' }] },
      ],
      10,
    );
    assert.deepEqual(plan.bleeps, [{ startS: 0, endS: 2 }]);
    assert.deepEqual(plan.blurs, [{ startS: 6, endS: 8, box: { x: 0, y: 0, w: 1, h: 1 } }]);
  });

  it('ignores warn/allow decisions', () => {
    const plan = planForBroadcast(
      [{ seq: 1, decisions: [WARN, { action: 'allow', reason: 'r' }] }],
      10,
    );
    assert.deepEqual(plan.bleeps, []);
    assert.deepEqual(plan.blurs, []);
  });
});

describe('censor windows', () => {
  const plan = planForBroadcast([{ seq: 5, decisions: [BLEEP, BLUR] }], 60);

  it('detects bleeped moments with half-open edges', () => {
    assert.equal(isBleepedAt(plan, 10.49), false);
    assert.equal(isBleepedAt(plan, 10.5), true);
    assert.equal(isBleepedAt(plan, 10.89), true);
    assert.equal(isBleepedAt(plan, 10.9), false);
  });

  it('returns active blur boxes per moment', () => {
    assert.deepEqual(activeBlursAt(plan, 9.99), []);
    assert.deepEqual(activeBlursAt(plan, 11), [BLUR.box]);
    assert.deepEqual(activeBlursAt(plan, 12), []);
  });
});

describe('scene ranges', () => {
  it('maps chunk-relative windows onto scene seconds', () => {
    assert.deepEqual(sceneRangeS(12, 960, 2000), { startS: 24.96, endS: 26 });
    assert.deepEqual(sceneRangeS(0, undefined, undefined), { startS: 0, endS: 2 });
  });

  it('formats sub-chunk ranges with tenths, whole chunks plain', () => {
    assert.equal(formatSceneRange(12, 960, 2000), '0:24.9\u20130:26');
    assert.equal(formatSceneRange(0, 0, 2000), '0:00\u20130:02');
    assert.equal(formatSceneRange(31, 500, 1500), '1:02.5\u20131:03.5');
  });
});
