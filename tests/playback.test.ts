import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { liveEdgeSeekMs, teardownPlayback, trimRangeMs } from '../src/lib/playback';

describe('teardownPlayback', () => {
  it('pauses, detaches, ends the source, revokes the URL, closes sockets', () => {
    const calls: string[] = [];
    teardownPlayback({
      video: {
        pause: () => calls.push('pause'),
        removeAttribute: (name) => calls.push(`remove:${name}`),
        load: () => calls.push('load'),
      },
      mediaSource: { readyState: 'open', endOfStream: () => calls.push('eos') },
      objectUrl: 'blob:show',
      revokeObjectUrl: (url) => calls.push(`revoke:${url}`),
      sockets: [{ close: () => calls.push('close') }],
    });
    assert.deepEqual(calls, ['pause', 'remove:src', 'load', 'eos', 'revoke:blob:show', 'close']);
  });

  it('skips endOfStream unless the source is open, tolerates missing parts', () => {
    const calls: string[] = [];
    teardownPlayback({
      video: { pause: () => calls.push('pause'), removeAttribute: () => calls.push('remove') },
      mediaSource: { readyState: 'ended', endOfStream: () => calls.push('eos') },
      objectUrl: null,
      revokeObjectUrl: () => calls.push('revoke'),
      sockets: [],
    });
    assert.deepEqual(calls, ['pause', 'remove']);
  });

  it('is best-effort: one throwing step cannot strand the rest', () => {
    const calls: string[] = [];
    teardownPlayback({
      video: {
        pause: () => {
          throw new Error('boom');
        },
        removeAttribute: () => calls.push('remove'),
      },
      mediaSource: null,
      objectUrl: 'blob:show',
      revokeObjectUrl: () => calls.push('revoke'),
      sockets: [
        {
          close: () => {
            throw new Error('boom');
          },
        },
      ],
    });
    assert.deepEqual(calls, ['remove', 'revoke']);
  });
});

describe('liveEdgeSeekMs', () => {
  it('leaves a playhead inside buffered data alone', () => {
    assert.equal(liveEdgeSeekMs(1.0, [[0, 12]]), null);
    assert.equal(liveEdgeSeekMs(11.9, [[0, 12]]), null);
  });

  it('skips the gap for a mid-show joiner ([0,2] + [10,12] stuck at 2s)', () => {
    assert.equal(liveEdgeSeekMs(2.0, [[0, 2], [10, 12]]), 10.05);
    assert.equal(liveEdgeSeekMs(2.3, [[0, 2], [10, 12]]), 10.05);
    assert.equal(liveEdgeSeekMs(5.0, [[0, 2], [10, 12]]), 10.05);
  });

  it('nudges an overrun playhead back into the last range', () => {
    assert.equal(liveEdgeSeekMs(15.0, [[0, 2], [10, 12]]), 11.8);
  });

  it('does nothing with no buffered data or at the live edge', () => {
    assert.equal(liveEdgeSeekMs(0, []), null);
    assert.equal(liveEdgeSeekMs(12.1, [[0, 12]]), null);
  });
});

describe('trimRangeMs', () => {
  it('trims old buffer behind the playhead', () => {
    assert.deepEqual(trimRangeMs(120, [[0, 120]]), [0, 75]);
  });

  it('leaves short shows and fresh buffers alone', () => {
    assert.equal(trimRangeMs(30, [[0, 30]]), null);
    assert.equal(trimRangeMs(120, [[100, 120]]), null);
    assert.equal(trimRangeMs(120, []), null);
  });
});
