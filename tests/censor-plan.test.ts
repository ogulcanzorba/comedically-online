import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Decision } from '../src/moderation/types';
import { activeBlursAt, isBleepedAt, planForClip } from '../src/lib/censor-plan';

const BLEEP: Decision = { action: 'bleep', reason: 'r', startMs: 500, endMs: 900 };
const BLUR: Decision = {
  action: 'blur',
  reason: 'r',
  startMs: 0,
  endMs: 2000,
  box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
};
const WARN: Decision = { action: 'warn', reason: 'r' };

describe('planForClip', () => {
  it('maps chunk-relative decisions onto clip seconds', () => {
    // Flagged chunk 5 ([10s,12s]) inside a [8s,14s] clip: offset 2s.
    const plan = planForClip([BLEEP, BLUR, WARN], 8, 5, 14);
    assert.deepEqual(plan.bleeps, [{ startS: 2.5, endS: 2.9 }]);
    assert.deepEqual(plan.blurs, [{ startS: 2, endS: 4, box: BLUR.box }]);
    assert.equal(plan.durationS, 6);
  });

  it('defaults missing windows to the flagged chunk and missing boxes to full frame', () => {
    const plan = planForClip(
      [
        { action: 'bleep', reason: 'r' },
        { action: 'blur', reason: 'r' },
      ],
      0,
      0,
      4,
    );
    assert.deepEqual(plan.bleeps, [{ startS: 0, endS: 2 }]);
    assert.deepEqual(plan.blurs[0].box, { x: 0, y: 0, w: 1, h: 1 });
  });
});

describe('censor windows', () => {
  const plan = planForClip([BLEEP, BLUR], 8, 5, 14);

  it('detects bleeped moments with half-open edges', () => {
    assert.equal(isBleepedAt(plan, 2.49), false);
    assert.equal(isBleepedAt(plan, 2.5), true);
    assert.equal(isBleepedAt(plan, 2.89), true);
    assert.equal(isBleepedAt(plan, 2.9), false);
  });

  it('returns active blur boxes per moment', () => {
    assert.deepEqual(activeBlursAt(plan, 1.99), []);
    assert.deepEqual(activeBlursAt(plan, 3), [BLUR.box]);
    assert.deepEqual(activeBlursAt(plan, 4), []);
  });
});
