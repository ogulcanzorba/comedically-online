import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DelayBuffer, DEFAULT_PLAYBACK_DELAY_MS } from '../src/lib/delay-buffer';

describe('DelayBuffer', () => {
  it('holds chunks for exactly 15s from server receipt by default', () => {
    assert.equal(DEFAULT_PLAYBACK_DELAY_MS, 15_000);
    const buf = new DelayBuffer<string>();
    buf.push('c0', 1_000, 0);
    assert.deepEqual(
      buf.popDue(1_000 + 14_999).map((c) => c.data),
      [],
    );
    assert.deepEqual(
      buf.popDue(1_000 + 15_000).map((c) => c.data),
      ['c0'],
    );
  });

  it('releases in receipt order', () => {
    const buf = new DelayBuffer<string>();
    buf.push('c0', 0, 0);
    buf.push('c1', 2_000, 1);
    assert.deepEqual(
      buf.popDue(15_000).map((c) => c.data),
      ['c0'],
    );
    assert.deepEqual(
      buf.popDue(17_000).map((c) => c.data),
      ['c1'],
    );
  });

  it('measures delay from server receipt time, not capture time', () => {
    const buf = new DelayBuffer<string>();
    // Captured at t=0 but received at t=500 (network lag) -> due at t=15_500.
    buf.push('late', 500, 0);
    assert.equal(buf.popDue(15_000).length, 0);
    assert.equal(buf.popDue(15_500).length, 1);
  });

  it('holds the head while its gate is closed, without skipping ahead', () => {
    const buf = new DelayBuffer<string>();
    buf.push('c0', 0, 0);
    buf.push('c1', 0, 1);
    // c0 not ready (moderation pending): nothing released even though c1 is due.
    assert.equal(buf.popDue(20_000, (c) => c.seq !== 0).length, 0);
    assert.deepEqual(
      buf.popDue(20_000).map((c) => c.data),
      ['c0', 'c1'],
    );
  });
});
