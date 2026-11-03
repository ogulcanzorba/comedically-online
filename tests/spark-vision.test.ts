import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVisionPrompt,
  callFrameTimesMs,
  computeBlurWindows,
  decideVision,
  definedVisionRuleIds,
  mergeFrameVerdicts,
  parseVisionOutput,
  releaseCleanFrames,
  sliceWindowsToChunk,
  sparkVisionEffort,
  sparkVisionModel,
  verdictsForRule,
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
    assert.ok(prompt.includes('IN CONTACT WITH'));
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

describe('releaseCleanFrames', () => {
  it('defaults to 2 frames (~1s at 4 frames per chunk)', () => {
    withEnv({ RELEASE_CLEAN_FRAMES: undefined }, () => {
      assert.equal(releaseCleanFrames(), 2);
    });
  });

  it('rejects out-of-range values', () => {
    withEnv({ RELEASE_CLEAN_FRAMES: 'bogus' }, () => {
      assert.equal(releaseCleanFrames(), 2);
    });
    withEnv({ RELEASE_CLEAN_FRAMES: '0' }, () => {
      assert.equal(releaseCleanFrames(), 2);
    });
    withEnv({ RELEASE_CLEAN_FRAMES: '3' }, () => {
      assert.equal(releaseCleanFrames(), 3);
    });
  });
});

/** Synthetic frame sequence: frames every 500ms, positives in the given spans. */
function frameFlags(totalMs: number, ...positiveSpans: Array<[number, number]>) {
  const out: Array<{ tMs: number; positive: boolean }> = [];
  for (let t = 250; t < totalMs; t += 500) {
    out.push({ tMs: t, positive: positiveSpans.some(([a, b]) => t >= a && t <= b) });
  }
  return out;
}

describe('computeBlurWindows', () => {
  const MARGIN = 250;

  it('holds a 1s gesture as one window with margins', () => {
    const w = computeBlurWindows(frameFlags(4000, [1000, 2000]), 'r', 2, MARGIN);
    assert.equal(w.length, 1);
    assert.deepEqual(w[0], { ruleId: 'r', startMs: 1000, endMs: 2000, open: false });
  });

  it('holds a 6s gesture as one continuous window across chunks', () => {
    const w = computeBlurWindows(frameFlags(10000, [1000, 7000]), 'r', 2, MARGIN);
    assert.equal(w.length, 1);
    assert.equal(w[0].startMs, 1000);
    assert.equal(w[0].endMs, 7000);
    assert.equal(w[0].open, false);
  });

  it('rides out a single flickering clean frame', () => {
    const v = frameFlags(6000, [1000, 3000]);
    const gap = v.find((f) => f.tMs === 2250);
    assert.ok(gap);
    gap.positive = false;
    const w = computeBlurWindows(v, 'r', 2, MARGIN);
    assert.equal(w.length, 1);
    assert.equal(w[0].startMs, 1000);
    assert.equal(w[0].endMs, 3000);
  });

  it('releases ~1s after the last positive frame (K=2 clean frames)', () => {
    const w = computeBlurWindows(frameFlags(8000, [1000, 2000]), 'r', 2, MARGIN);
    assert.equal(w.length, 1);
    // Last positive frame at 1750 covers to 2000; blur ends at 2000 (margin).
    assert.equal(w[0].endMs, 2000);
  });

  it('straddling a chunk boundary stays one window', () => {
    const w = computeBlurWindows(frameFlags(6000, [1500, 2500]), 'r', 2, MARGIN);
    assert.equal(w.length, 1);
    assert.equal(w[0].startMs, 1500);
    assert.equal(w[0].endMs, 2500);
  });

  it('two separate gestures make two windows', () => {
    const w = computeBlurWindows(frameFlags(10000, [1000, 1500], [5000, 5500]), 'r', 2, MARGIN);
    assert.equal(w.length, 2);
    assert.deepEqual(
      w.map((x) => [x.startMs, x.endMs]),
      [
        [1000, 1500],
        [5000, 5500],
      ],
    );
  });

  it('stays open while positives continue at the last observed frame', () => {
    const w = computeBlurWindows(frameFlags(3000, [1000, 3000]), 'r', 2, MARGIN);
    assert.equal(w.length, 1);
    assert.equal(w[0].open, true);
    assert.equal(w[0].startMs, 1000);
  });

  it('emits no windows without positives', () => {
    assert.deepEqual(computeBlurWindows(frameFlags(4000), 'r', 2, MARGIN), []);
  });
});

describe('verdictsForRule', () => {
  const times = [1250, 1750];

  it('maps frame indices to per-frame verdicts', () => {
    const v = verdictsForRule(
      { id: 'r', present: true, confidence: 0.9, frameIndices: [1] },
      times,
    );
    assert.deepEqual(v, [
      { tMs: 1250, positive: false },
      { tMs: 1750, positive: true },
    ]);
  });

  it('fail-closed: present with empty indices marks every frame positive', () => {
    const v = verdictsForRule(
      { id: 'r', present: true, confidence: 0.9, frameIndices: [] },
      times,
    );
    assert.ok(v.every((f) => f.positive));
  });

  it('an omitted rule counts as clean', () => {
    const v = verdictsForRule(undefined, times);
    assert.ok(v.every((f) => !f.positive));
  });
});

describe('mergeFrameVerdicts', () => {
  it('ORs duplicate overlap frames and prunes old ones', () => {
    const merged = mergeFrameVerdicts(
      [
        { tMs: 500, positive: false },
        { tMs: 1000, positive: false },
      ],
      [
        { tMs: 1000, positive: true },
        { tMs: 1500, positive: false },
      ],
      800,
    );
    assert.deepEqual(merged, [
      { tMs: 1000, positive: true },
      { tMs: 1500, positive: false },
    ]);
  });
});

describe('sliceWindowsToChunk', () => {
  it('slices a straddling window to each chunk', () => {
    const w = [{ ruleId: 'r', startMs: 1500, endMs: 2500, open: false }];
    assert.deepEqual(sliceWindowsToChunk(w, 0), [{ ruleId: 'r', startMs: 1500, endMs: 2000 }]);
    assert.deepEqual(sliceWindowsToChunk(w, 2000), [{ ruleId: 'r', startMs: 0, endMs: 500 }]);
    assert.deepEqual(sliceWindowsToChunk(w, 4000), []);
  });

  it('extends open windows to the chunk end', () => {
    const w = [{ ruleId: 'r', startMs: 1500, endMs: 3000, open: true }];
    assert.deepEqual(sliceWindowsToChunk(w, 2000), [{ ruleId: 'r', startMs: 0, endMs: 1000 }]);
  });
});

describe('callFrameTimesMs', () => {
  it('places prev and current frame centers on the stream timeline', () => {
    assert.deepEqual(callFrameTimesMs(1, 2, 4), [-750, -250, 250, 750, 1250, 1750].map((t) => t + 2000));
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
