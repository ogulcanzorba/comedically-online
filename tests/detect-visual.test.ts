import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FRAMES_PER_CHUNK,
  conceptsFromRulebook,
  debugFramesDir,
  flagsForImageHit,
  framesPerChunk,
  meanConfidence,
  parseSamOutput,
  sampleTimesMs,
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

  it('captures confidence when the model reports it', () => {
    const records = parseSamOutput(
      '<0f>0<|box;x1=137;y1=168;x2=155;y2=188;w=320;h=414;c=0.6012461185455322|>',
    );
    assert.equal(records.length, 1);
    assert.ok(Math.abs((records[0].confidence ?? 0) - 0.6012461185455322) < 1e-12);
  });
});

describe('meanConfidence', () => {
  it('averages reported confidences and nulls out when absent', () => {
    const box = { x: 0, y: 0, w: 0.1, h: 0.1 };
    assert.ok(
      Math.abs(
        (meanConfidence([
          { frame: 0, id: 0, box, confidence: 0.6 },
          { frame: 0, id: 1, box, confidence: 0.8 },
        ]) ?? 0) - 0.7,
      ) < 1e-12,
    );
    assert.equal(meanConfidence([{ frame: 0, id: 0, box }]), null);
    assert.equal(meanConfidence([]), null);
  });
});

describe('sampling env', () => {
  it('defaults to 4 frames per chunk, honors FRAMES_PER_CHUNK 1..8', () => {
    assert.equal(DEFAULT_FRAMES_PER_CHUNK, 4);
    const saved = process.env.FRAMES_PER_CHUNK;
    delete process.env.FRAMES_PER_CHUNK;
    try {
      assert.equal(framesPerChunk(), 4);
      process.env.FRAMES_PER_CHUNK = '2';
      assert.equal(framesPerChunk(), 2);
      process.env.FRAMES_PER_CHUNK = '8';
      assert.equal(framesPerChunk(), 8);
      process.env.FRAMES_PER_CHUNK = '0';
      assert.equal(framesPerChunk(), 4);
      process.env.FRAMES_PER_CHUNK = '9';
      assert.equal(framesPerChunk(), 4);
      process.env.FRAMES_PER_CHUNK = 'junk';
      assert.equal(framesPerChunk(), 4);
    } finally {
      if (saved === undefined) delete process.env.FRAMES_PER_CHUNK;
      else process.env.FRAMES_PER_CHUNK = saved;
    }
  });

  it('spaces sample times evenly across the 2s chunk', () => {
    assert.deepEqual(sampleTimesMs(4), [250, 750, 1250, 1750]);
    assert.deepEqual(sampleTimesMs(1), [1000]);
    assert.deepEqual(sampleTimesMs(2), [500, 1500]);
  });

  it('exposes the debug frames dir only on opt-in', () => {
    const saved = process.env.DEBUG_FRAMES;
    delete process.env.DEBUG_FRAMES;
    assert.equal(debugFramesDir(), null);
    process.env.DEBUG_FRAMES = '1';
    assert.ok(debugFramesDir()?.endsWith('debug-frames'));
    if (saved === undefined) delete process.env.DEBUG_FRAMES;
    else process.env.DEBUG_FRAMES = saved;
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

  it('centers the ±1s window on the sampled frame time', () => {
    const early = flagsForImageHit('c', 'r', [{ frame: 0, id: 0, box }], 500);
    assert.deepEqual([early[0].startMs, early[0].endMs], [0, 1500]);
    const late = flagsForImageHit('c', 'r', [{ frame: 0, id: 0, box }], 1500);
    assert.deepEqual([late[0].startMs, late[0].endMs], [500, 2000]);
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
