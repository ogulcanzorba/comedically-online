import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  flagForVerdict,
  gateFrames,
  gateRuleIds,
  parseGateVerdict,
  pickGateIndices,
} from '../src/moderation/gate';
import { ruleById } from '../src/moderation/rulebook';
import { visualStrategy } from '../src/moderation/detect-visual';

describe('parseGateVerdict', () => {
  it('accepts the three strict enum values, rejects everything else', () => {
    assert.equal(parseGateVerdict('{"verdict":"clean"}'), 'clean');
    assert.equal(parseGateVerdict('{"verdict": "three-fingers"}'), 'three-fingers');
    assert.equal(parseGateVerdict('{"verdict":"nose-touch"}'), 'nose-touch');
    assert.equal(parseGateVerdict('YES'), null);
    assert.equal(parseGateVerdict('{"verdict":"maybe"}'), null);
    assert.equal(parseGateVerdict('{"verdict":null}'), null);
    assert.equal(parseGateVerdict('not json'), null);
    assert.equal(parseGateVerdict(''), null);
  });
});

describe('pickGateIndices', () => {
  it('spreads evenly: 4 frames want 2 -> middle pair', () => {
    assert.deepEqual(pickGateIndices(4, 2), [1, 2]);
  });

  it('clamps to available frames and keeps order', () => {
    assert.deepEqual(pickGateIndices(2, 4), [0, 1]);
    assert.deepEqual(pickGateIndices(1, 1), [0]);
    assert.deepEqual(pickGateIndices(0, 2), []);
    assert.deepEqual(pickGateIndices(4, 1), [1]);
    const idx = pickGateIndices(4, 3);
    assert.equal(idx.length, 3);
    assert.deepEqual([...idx].sort((a, b) => a - b), idx);
    assert.ok(idx.every((i) => i >= 0 && i < 4));
  });
});

describe('flagForVerdict', () => {
  it('maps verdicts to rulebook rules with whole-frame boxes', () => {
    const fingers = flagForVerdict('three-fingers', 750);
    assert.equal(fingers.ruleId, 'hand-gesture-three');
    assert.deepEqual(fingers.box, { x: 0, y: 0, w: 1, h: 1 });
    assert.equal(fingers.startMs, 0);
    assert.equal(fingers.endMs, 1750);
    const nose = flagForVerdict('nose-touch', 1250);
    assert.equal(nose.ruleId, 'touching-nose');
    assert.equal(nose.startMs, 250);
    assert.equal(nose.endMs, 2000);
  });
});

describe('gate rulebook wiring', () => {
  it('every gate verdict maps to a live rulebook rule', () => {
    for (const id of gateRuleIds()) {
      assert.ok(ruleById(id), `rulebook must contain gate rule ${id}`);
    }
    assert.deepEqual(gateRuleIds().sort(), ['hand-gesture-three', 'touching-nose']);
  });
});

describe('gate env', () => {
  it('defaults to the gate strategy and 2 gate frames', () => {
    const savedStrategy = process.env.VISUAL_STRATEGY;
    const savedFrames = process.env.GATE_FRAMES;
    delete process.env.VISUAL_STRATEGY;
    delete process.env.GATE_FRAMES;
    try {
      assert.equal(visualStrategy(), 'gate');
      assert.equal(gateFrames(), 2);
      process.env.VISUAL_STRATEGY = 'sam';
      assert.equal(visualStrategy(), 'sam');
      process.env.VISUAL_STRATEGY = 'bogus';
      assert.equal(visualStrategy(), 'gate');
      process.env.GATE_FRAMES = '4';
      assert.equal(gateFrames(), 4);
      process.env.GATE_FRAMES = '9';
      assert.equal(gateFrames(), 2);
    } finally {
      if (savedStrategy === undefined) delete process.env.VISUAL_STRATEGY;
      else process.env.VISUAL_STRATEGY = savedStrategy;
      if (savedFrames === undefined) delete process.env.GATE_FRAMES;
      else process.env.GATE_FRAMES = savedFrames;
    }
  });
});
