import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clipRange, localRecording } from '../src/lib/local-recording';

describe('clipRange', () => {
  it('takes the flagged chunk plus one on each side', () => {
    assert.deepEqual(clipRange(5, [0, 1, 2, 3, 4, 5, 6, 7]), [4, 5, 6]);
  });

  it('clamps at the start and end of the recording', () => {
    assert.deepEqual(clipRange(0, [0, 1, 2]), [0, 1]);
    assert.deepEqual(clipRange(2, [0, 1, 2]), [1, 2]);
    assert.deepEqual(clipRange(0, [0]), [0]);
  });

  it('skips missing seqs and returns empty when nothing overlaps', () => {
    assert.deepEqual(clipRange(5, [3, 4, 6, 7]), [4, 6]);
    assert.deepEqual(clipRange(5, [0, 1]), []);
  });
});

describe('localRecording store', () => {
  it('builds clips and the full recording from pushed blobs', () => {
    localRecording.start();
    for (const seq of [0, 1, 2, 3]) {
      localRecording.push(seq, new Blob([`chunk-${seq}`], { type: 'video/webm' }));
    }
    assert.equal(localRecording.count, 4);
    assert.equal(localRecording.hasRecording, true);
    const clip = localRecording.clipFor(2);
    assert.ok(clip);
    assert.ok(clip.url.startsWith('blob:'));
    assert.equal(clip.centerSeq, 2);
    assert.deepEqual([clip.startS, clip.endS], [2, 8]);
    const full = localRecording.full();
    assert.ok(full?.url.startsWith('blob:'));
    assert.equal(full?.seconds, 8);
    localRecording.start(); // fresh broadcast drops everything
    assert.equal(localRecording.hasRecording, false);
    assert.equal(localRecording.clipFor(2), null);
  });

  it('dedupes pushes by seq', () => {
    localRecording.start();
    localRecording.push(0, new Blob(['a']));
    localRecording.push(0, new Blob(['b']));
    assert.equal(localRecording.count, 1);
    localRecording.start();
  });
});
