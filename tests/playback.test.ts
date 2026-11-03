import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { teardownPlayback } from '../src/lib/playback';

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
