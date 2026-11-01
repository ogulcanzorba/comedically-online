import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { revenueFor, suggestedRange } from '../src/lib/pricing';

describe('pricing helper', () => {
  it('splits gross, fee, and payout', () => {
    assert.deepEqual(revenueFor(100, 1000, 10), { grossCents: 100000, feeCents: 10000, payoutCents: 90000 });
    assert.deepEqual(revenueFor(25, 500, 0), { grossCents: 12500, feeCents: 0, payoutCents: 12500 });
  });

  it('suggests ranges by duration with a weekend bump', () => {
    assert.deepEqual(suggestedRange(60, false), { low: 900, high: 1500 });
    assert.deepEqual(suggestedRange(60, true), { low: 1100, high: 1800 });
    assert.deepEqual(suggestedRange(25, false), { low: 500, high: 800 });
    assert.deepEqual(suggestedRange(120, false), { low: 1500, high: 2500 });
  });
});
