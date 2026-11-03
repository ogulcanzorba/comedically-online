import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAM_VIDEO_MIN_BILLABLE_FRAMES,
  SpendTracker,
  maxSpendUsd,
  projectedHourlyUsd,
  samUsdForFrames,
  samUsdForImages,
  sparkUsdForTokens,
  voiceUsdForMs,
} from '../src/moderation/cost';

describe('SAM cost accounting', () => {
  function approx(actual: number, expected: number): void {
    assert.ok(Math.abs(actual - expected) < 1e-9, `expected ~$${expected}, got $${actual}`);
  }

  it('bills the 50-frame minimum for short video clips', () => {
    assert.equal(SAM_VIDEO_MIN_BILLABLE_FRAMES, 50);
    approx(samUsdForFrames(20), 0.01);
    approx(samUsdForFrames(0), 0.01);
  });

  it('bills actual frames past the minimum', () => {
    approx(samUsdForFrames(60), 0.012);
    approx(samUsdForFrames(1000), 0.2);
  });

  it('prices images at $0.0025 each', () => {
    approx(samUsdForImages(1), 0.0025);
    approx(samUsdForImages(2), 0.005);
    assert.equal(samUsdForImages(0), 0);
  });

  it('keeps the other pricers intact', () => {
    approx(voiceUsdForMs(3_600_000), 0.18);
    approx(sparkUsdForTokens(1_000_000, 0), 1.25);
    approx(sparkUsdForTokens(0, 1_000_000), 4.25);
  });
});

describe('spend cap', () => {
  it('trips at $5 of corrected spend (image sampling + confirms)', () => {
    const saved = process.env.MAX_SPEND_USD;
    delete process.env.MAX_SPEND_USD;
    try {
      assert.equal(maxSpendUsd(), 5);
      const tracker = new SpendTracker();
      // One hour of clean traffic: 2 image calls per chunk, 30 chunks/min.
      for (let i = 0; i < 30 * 60; i++) tracker.add(samUsdForImages(2));
      assert.ok(Math.abs(tracker.totalUsd - 9) < 1e-9, `total=$${tracker.totalUsd}`);
      assert.ok(tracker.capped, 'corrected spend must trip the cap');
    } finally {
      if (saved !== undefined) process.env.MAX_SPEND_USD = saved;
    }
  });

  it('projects the hourly rate from spend so far', () => {
    assert.equal(projectedHourlyUsd(0.15, 60_000), 9);
    assert.equal(projectedHourlyUsd(1, 0), 0);
  });
});
