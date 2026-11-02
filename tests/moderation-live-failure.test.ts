import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import { moderateChunk } from '../src/moderation/index';
import { SpendTracker } from '../src/moderation/cost';
import { MODEL_TIMEOUT_MS, startTimeout } from '../src/moderation/timeout';
import { StreamHost } from '../src/server/stream-host';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('live fail-closed', () => {
  it('bleeps audio and blurs video in full when both stages error', async () => {
    const prevMode = process.env.MODERATION_MODE;
    const prevKey = process.env.MODEL_API_KEY;
    process.env.MODERATION_MODE = 'live';
    delete process.env.MODEL_API_KEY; // live adapters throw before any network use
    try {
      const res = await moderateChunk({
        seq: 1,
        video: Buffer.from('fake-video'),
        wav: Buffer.from('fake-wav'),
        recentTranscript: '',
        tracker: new SpendTracker(),
      });
      assert.equal(res.mode, 'live');
      assert.equal(res.decisions.length, 2);
      const bleep = res.decisions.find((d) => d.action === 'bleep');
      const blur = res.decisions.find((d) => d.action === 'blur');
      assert.ok(bleep);
      assert.deepEqual([bleep.startMs, bleep.endMs], [0, 2000]);
      assert.ok(blur);
      assert.deepEqual([blur.startMs, blur.endMs], [0, 2000]);
      assert.deepEqual(blur.box, { x: 0, y: 0, w: 1, h: 1 });
      assert.equal(res.entry.action, 'bleep');
      assert.match(res.entry.reason, /moderation unavailable/);
      assert.equal(res.costUsd, 0);
    } finally {
      if (prevMode === undefined) delete process.env.MODERATION_MODE;
      else process.env.MODERATION_MODE = prevMode;
      if (prevKey === undefined) delete process.env.MODEL_API_KEY;
      else process.env.MODEL_API_KEY = prevKey;
    }
  });
});

describe('model timeout', () => {
  it('aborts after the configured delay', async () => {
    assert.equal(MODEL_TIMEOUT_MS, 6000);
    const t = startTimeout(20);
    assert.equal(t.signal.aborted, false);
    await sleep(60);
    assert.equal(t.signal.aborted, true);
    assert.throws(() => t.throwIfAborted('probe'), /probe timed out after 20ms/);
  });

  it('cancel prevents the abort', async () => {
    const t = startTimeout(20);
    t.cancel();
    await sleep(60);
    assert.equal(t.signal.aborted, false);
  });
});

describe('max hold', () => {
  function fakeSocket(sent: unknown[]): WebSocket {
    const sock = new EventEmitter() as unknown as WebSocket & { readyState: number };
    sock.readyState = 1;
    (sock as unknown as { send: (d: unknown) => void }).send = (d: unknown) => {
      sent.push(d);
    };
    return sock as WebSocket;
  }

  it('releases an unmoderated chunk blurred+bleeped instead of blocking the queue', async () => {
    const host = new StreamHost({ delayMs: 20, tickMs: 5, audioWaitMs: 60_000, maxOverdueMs: 30 });
    try {
      const pubSent: unknown[] = [];
      const viewerSent: unknown[] = [];
      const pub = fakeSocket(pubSent);
      host.handleConnection(pub, 'publisher');
      // webm arrives but the wav never does and moderation never starts:
      // the chunk sits in pendingModeration until max hold trips.
      pub.emit('message', JSON.stringify({ type: 'media', kind: 'webm', seq: 0 }), false);
      pub.emit('message', Buffer.from('fake-webm-bytes'), true);
      host.handleConnection(fakeSocket(viewerSent), 'viewer');
      await sleep(250);
      const metas = viewerSent
        .filter((d): d is string => typeof d === 'string')
        .map((s) => JSON.parse(s) as { type: string; init?: boolean; decisions?: Array<{ action: string }> });
      const released = metas.filter((m) => m.type === 'chunk' && m.init === false);
      assert.equal(released.length, 1); // the queue was NOT blocked
      assert.deepEqual(
        released[0].decisions?.map((d) => d.action).sort(),
        ['bleep', 'blur'],
      );
      const logs = pubSent
        .filter((d): d is string => typeof d === 'string')
        .map((s) => JSON.parse(s) as { type: string; entry?: { action: string; reason: string } });
      const holdEntry = logs.find((l) => l.type === 'log' && /past the delay/.test(l.entry?.reason ?? ''));
      assert.ok(holdEntry);
      assert.equal(holdEntry?.entry?.action, 'bleep');
    } finally {
      host.close();
    }
  });
});
