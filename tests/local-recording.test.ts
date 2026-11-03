import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { localRecording } from '../src/lib/local-recording';

describe('localRecording store', () => {
  it('builds the full recording from pushed blobs', () => {
    localRecording.start();
    for (const seq of [0, 1, 2, 3]) {
      localRecording.push(seq, new Blob([`chunk-${seq}`], { type: 'video/webm' }));
    }
    assert.equal(localRecording.count, 4);
    assert.equal(localRecording.hasRecording, true);
    const full = localRecording.full();
    assert.ok(full?.url.startsWith('blob:'));
    assert.equal(full?.seconds, 8);
    localRecording.start(); // fresh broadcast drops everything
    assert.equal(localRecording.hasRecording, false);
    assert.equal(localRecording.full(), null);
  });

  it('rebuilds the full recording when blobs land after first build (recap tail)', () => {
    localRecording.start();
    localRecording.push(0, new Blob(['a'], { type: 'video/webm' }));
    localRecording.push(1, new Blob(['b'], { type: 'video/webm' }));
    const first = localRecording.full();
    assert.equal(first?.seconds, 4);
    // Final MediaRecorder flush lands late: recap must include it.
    localRecording.push(2, new Blob(['c'], { type: 'video/webm' }));
    const rebuilt = localRecording.full();
    assert.equal(rebuilt?.seconds, 6);
    assert.notEqual(rebuilt?.url, first?.url);
    localRecording.start();
  });

  it('dedupes pushes by seq', () => {
    localRecording.start();
    localRecording.push(0, new Blob(['a']));
    localRecording.push(0, new Blob(['b']));
    assert.equal(localRecording.count, 1);
    localRecording.start();
  });

  it('bumps generation on every start so panels can wipe history', () => {
    const before = localRecording.generation;
    localRecording.start();
    assert.equal(localRecording.generation, before + 1);
  });
});
