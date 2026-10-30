import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { activeAt, pruneWindows } from '../src/lib/overlay-timing';

describe('overlay timing', () => {
  it('activates decisions only inside their anchored window', () => {
    const windows = [
      {
        t0: 100,
        decisions: [
          { action: 'bleep' as const, reason: 'x', startMs: 0, endMs: 500 },
          { action: 'blur' as const, reason: 'y', startMs: 1000, endMs: 2000 },
        ],
      },
    ];
    assert.equal(activeAt(windows, 99.9).length, 0);
    assert.deepEqual(
      activeAt(windows, 100.2).map((d) => d.action),
      ['bleep'],
    );
    assert.equal(activeAt(windows, 100.7).length, 0);
    assert.deepEqual(
      activeAt(windows, 101.5).map((d) => d.action),
      ['blur'],
    );
    assert.equal(activeAt(windows, 102.1).length, 0);
  });

  it('prunes windows behind the playhead', () => {
    const windows = [
      { t0: 10, decisions: [{ action: 'warn' as const, reason: 'old' }] },
      { t0: 100, decisions: [{ action: 'warn' as const, reason: 'new' }] },
    ];
    const kept = pruneWindows(windows, 100);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].decisions[0].reason, 'new');
  });
});
