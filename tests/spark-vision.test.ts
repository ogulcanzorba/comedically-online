import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVisionPrompt,
  decideVision,
  definedVisionRuleIds,
  hysteresisHold,
  hysteresisNext,
  initialHysteresis,
  parseVisionOutput,
  sparkVisionEffort,
  sparkVisionModel,
  visionBlurRange,
  visionHit,
  visionRuleDefs,
  visionSchema,
  visionUnsure,
} from '../src/moderation/spark-vision';
import { visionBackend } from '../src/moderation/detect-visual';
import { frameWidth } from '../src/moderation/transcode';
import { sparkVisionTimeoutMs } from '../src/moderation/timeout';
import { sparkPricingMode, sparkUsdForTokens } from '../src/moderation/cost';
import { videoBlurRules } from '../src/moderation/rulebook';

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k] as string;
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
  }
}

describe('spark vision env', () => {
  it('defaults model/effort/thresholds, honors overrides', () => {
    withEnv(
      { SPARK_VISION_MODEL: undefined, SPARK_VISION_EFFORT: undefined, VISION_HIT: undefined, VISION_UNSURE: undefined },
      () => {
        assert.equal(sparkVisionModel(), 'muse-spark-1.3');
        assert.equal(sparkVisionEffort(), 'minimal');
        assert.equal(visionHit(), 0.5);
        assert.equal(visionUnsure(), 0.3);
      },
    );
    withEnv({ SPARK_VISION_MODEL: 'x', SPARK_VISION_EFFORT: 'LOW', VISION_HIT: '0.7', VISION_UNSURE: '0.4' }, () => {
      assert.equal(sparkVisionModel(), 'x');
      assert.equal(sparkVisionEffort(), 'low');
      assert.equal(visionHit(), 0.7);
      assert.equal(visionUnsure(), 0.4);
    });
  });

  it('clamps bogus thresholds into range', () => {
    withEnv({ VISION_HIT: 'junk', VISION_UNSURE: undefined }, () => assert.equal(visionHit(), 0.5));
    withEnv({ VISION_HIT: '0', VISION_UNSURE: undefined }, () => assert.equal(visionHit(), 0.5));
    // unsure must stay below hit
    withEnv({ VISION_HIT: '0.5', VISION_UNSURE: '0.9' }, () => {
      assert.ok(visionUnsure() < 0.5);
    });
  });

  it('gives vision calls their own 8s timeout (not MAX_HOLD)', () => {
    withEnv({ VISION_TIMEOUT_MS: undefined, MAX_HOLD_MS: '4000' }, () => {
      assert.equal(sparkVisionTimeoutMs(), 8000);
    });
    withEnv({ VISION_TIMEOUT_MS: '12000' }, () => {
      assert.equal(sparkVisionTimeoutMs(), 12000);
    });
  });

  it('defaults frames to 640px and clamps to 160..1280', () => {
    withEnv({ FRAME_WIDTH: undefined }, () => assert.equal(frameWidth(), 640));
    withEnv({ FRAME_WIDTH: '320' }, () => assert.equal(frameWidth(), 320));
    withEnv({ FRAME_WIDTH: '99' }, () => assert.equal(frameWidth(), 640));
    withEnv({ FRAME_WIDTH: '4000' }, () => assert.equal(frameWidth(), 640));
  });
});

describe('visionBackend', () => {
  it('defaults to spark, honors explicit values, bogus falls back to spark', () => {
    withEnv({ VISION_BACKEND: undefined, VISUAL_STRATEGY: undefined }, () => {
      assert.equal(visionBackend(), 'spark');
    });
    withEnv({ VISION_BACKEND: 'sam', VISUAL_STRATEGY: undefined }, () => {
      assert.equal(visionBackend(), 'sam');
    });
    withEnv({ VISION_BACKEND: 'gate', VISUAL_STRATEGY: undefined }, () => {
      assert.equal(visionBackend(), 'gate');
    });
    withEnv({ VISION_BACKEND: 'bogus', VISUAL_STRATEGY: undefined }, () => {
      assert.equal(visionBackend(), 'spark');
    });
  });

  it('honors the legacy VISUAL_STRATEGY alias when VISION_BACKEND is unset', () => {
    withEnv({ VISION_BACKEND: undefined, VISUAL_STRATEGY: 'sam' }, () => {
      assert.equal(visionBackend(), 'sam');
    });
    withEnv({ VISION_BACKEND: 'spark', VISUAL_STRATEGY: 'sam' }, () => {
      assert.equal(visionBackend(), 'spark');
    });
  });
});

describe('rulebook-driven prompt', () => {
  it('covers every video rule with a precise definition', () => {
    const defs = visionRuleDefs();
    assert.deepEqual(
      defs.map((d) => d.id).sort(),
      videoBlurRules().map((r) => r.id).sort(),
    );
    for (const id of videoBlurRules().map((r) => r.id)) {
      assert.ok(definedVisionRuleIds().includes(id), `missing definition for ${id}`);
    }
  });

  it('names rules, counts, and the conservative instruction', () => {
    const prompt = buildVisionPrompt(visionRuleDefs(), 6, 2);
    assert.ok(prompt.includes('6 frames'));
    assert.ok(prompt.includes('frames 1-2 are the previous chunk'));
    assert.ok(prompt.includes('hand-gesture-three'));
    assert.ok(prompt.includes('exactly three fingers'));
    assert.ok(prompt.includes('within ~1 cm'));
    assert.ok(prompt.includes('conservative'));
    assert.ok(prompt.includes('single frame'));
    const noPrev = buildVisionPrompt(visionRuleDefs(), 4, 0);
    assert.ok(!noPrev.includes('previous chunk'));
  });

  it('builds a strict schema over the rule ids', () => {
    const schema = visionSchema(['a', 'b']);
    const text = JSON.stringify(schema);
    assert.ok(text.includes('"a"'));
    assert.ok(text.includes('frame_indices'));
    assert.ok(text.includes('additionalProperties'));
  });
});

describe('parseVisionOutput', () => {
  const ids = new Set(['hand-gesture-three', 'touching-nose']);

  it('parses a valid verdict', () => {
    const out = parseVisionOutput(
      JSON.stringify({
        rules: [
          { id: 'hand-gesture-three', present: true, confidence: 0.92, frame_indices: [2, 5] },
          { id: 'touching-nose', present: false, confidence: 0.05, frame_indices: [] },
        ],
      }),
      ids,
      6,
    );
    assert.deepEqual(out, [
      { id: 'hand-gesture-three', present: true, confidence: 0.92, frameIndices: [2, 5] },
      { id: 'touching-nose', present: false, confidence: 0.05, frameIndices: [] },
    ]);
  });

  it('rejects invalid JSON, bad shapes, and unknown ids', () => {
    assert.equal(parseVisionOutput('nope', ids, 6), null);
    assert.equal(parseVisionOutput('{"rules":[]}x', ids, 6), null);
    assert.equal(parseVisionOutput('[]', ids, 6), null);
    assert.equal(parseVisionOutput('{"rules":[{}]}', ids, 6), null);
    assert.equal(
      parseVisionOutput(
        JSON.stringify({ rules: [{ id: 'nope', present: true, confidence: 0.9, frame_indices: [] }] }),
        ids,
        6,
      ),
      null,
    );
    assert.equal(
      parseVisionOutput(
        JSON.stringify({ rules: [{ id: 'hand-gesture-three', present: 'yes', confidence: 0.9, frame_indices: [] }] }),
        ids,
        6,
      ),
      null,
    );
  });

  it('drops out-of-range indices and clamps confidence', () => {
    const out = parseVisionOutput(
      JSON.stringify({
        rules: [{ id: 'hand-gesture-three', present: true, confidence: 1.7, frame_indices: [0, 6, -1] }],
      }),
      ids,
      6,
    );
    assert.deepEqual(out, [
      { id: 'hand-gesture-three', present: true, confidence: 1, frameIndices: [0] },
    ]);
  });
});

describe('decideVision', () => {
  it('thresholds hit/clean/unsure on the top present rule', () => {
    const hit = decideVision(
      [{ id: 'a', present: true, confidence: 0.9, frameIndices: [1] }],
      0.5,
      0.3,
    );
    assert.deepEqual(hit, { decision: 'hit', topRuleId: 'a', maxConfidence: 0.9 });
    const clean = decideVision(
      [{ id: 'a', present: true, confidence: 0.1, frameIndices: [] }],
      0.5,
      0.3,
    );
    assert.equal(clean.decision, 'clean');
    const unsure = decideVision(
      [{ id: 'a', present: true, confidence: 0.4, frameIndices: [0] }],
      0.5,
      0.3,
    );
    assert.deepEqual(unsure, { decision: 'unsure', topRuleId: 'a', maxConfidence: 0.4 });
  });

  it('ignores confidence on absent rules', () => {
    const d = decideVision(
      [{ id: 'a', present: false, confidence: 0.99, frameIndices: [] }],
      0.5,
      0.3,
    );
    assert.equal(d.decision, 'clean');
    assert.equal(d.topRuleId, null);
  });
});

describe('hysteresisNext', () => {
  it('blurs the hit plus the next hold clean chunks, then disarms', () => {
    let s = initialHysteresis();
    let r = hysteresisNext(s, true, 'hand-gesture-three', 2);
    assert.equal(r.blur, true);
    s = r.state;
    r = hysteresisNext(s, false, null, 2);
    assert.equal(r.blur, true);
    s = r.state;
    assert.equal(s.armed, true);
    r = hysteresisNext(s, false, null, 2);
    assert.equal(r.blur, true);
    s = r.state;
    r = hysteresisNext(s, false, null, 2);
    assert.equal(r.blur, false);
    assert.equal(r.state.armed, false);
  });

  it('defaults to holding one clean chunk (HYSTERESIS_CHUNKS)', () => {
    withEnv({ HYSTERESIS_CHUNKS: undefined }, () => {
      let s = initialHysteresis();
      s = hysteresisNext(s, true, 'a').state;
      const first = hysteresisNext(s, false, null);
      assert.equal(first.blur, true);
      const second = hysteresisNext(first.state, false, null);
      assert.equal(second.blur, false);
      assert.equal(second.state.armed, false);
    });
    withEnv({ HYSTERESIS_CHUNKS: 'bogus' }, () => {
      assert.equal(hysteresisHold(), 1);
    });
    withEnv({ HYSTERESIS_CHUNKS: '3' }, () => {
      assert.equal(hysteresisHold(), 3);
    });
  });

  it('a fresh hit resets the streak and rule', () => {
    let s = initialHysteresis();
    s = hysteresisNext(s, true, 'a', 2).state;
    s = hysteresisNext(s, false, null, 2).state;
    const r = hysteresisNext(s, true, 'b', 2);
    assert.equal(r.blur, true);
    assert.deepEqual(r.state, { armed: true, cleanStreak: 0, lastRuleId: 'b' });
  });

  it('stays idle without hits', () => {
    const r = hysteresisNext(initialHysteresis(), false, null);
    assert.equal(r.blur, false);
    assert.equal(r.state.armed, false);
  });
});

describe('visionBlurRange', () => {
  it('spans first-to-last positive current frame ± margin', () => {
    // 4 current frames at 250/750/1250/1750; gesture on the last two.
    assert.deepEqual(visionBlurRange([2, 3], 0, 4), { startMs: 1000, endMs: 2000 });
    assert.deepEqual(visionBlurRange([5], 2, 4), { startMs: 1500, endMs: 2000 });
    assert.deepEqual(visionBlurRange([2], 2, 4), { startMs: 0, endMs: 500 });
  });

  it('treats prev-chunk positives as context (head sliver only)', () => {
    assert.deepEqual(visionBlurRange([0, 1], 2, 4), { startMs: 0, endMs: 250 });
    assert.deepEqual(visionBlurRange([0, 4], 2, 4), { startMs: 1000, endMs: 1500 });
  });
});

describe('spark pricing tiers', () => {
  it('bills standard by default and contributor when set', () => {
    withEnv({ SPARK_PRICING_MODE: undefined }, () => {
      assert.equal(sparkPricingMode(), 'standard');
      assert.equal(sparkUsdForTokens(1_000_000, 0), 1.25);
      assert.equal(sparkUsdForTokens(0, 1_000_000), 4.25);
    });
    withEnv({ SPARK_PRICING_MODE: 'contributor' }, () => {
      assert.equal(sparkPricingMode(), 'contributor');
      assert.equal(sparkUsdForTokens(1_000_000, 0), 0.1);
      assert.equal(sparkUsdForTokens(0, 1_000_000), 0.2);
    });
    withEnv({ SPARK_PRICING_MODE: 'bogus' }, () => {
      assert.equal(sparkPricingMode(), 'standard');
    });
  });
});
