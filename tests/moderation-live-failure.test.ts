import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WebSocket } from 'ws';
import { errorDetail, moderateChunk, visualFailMode } from '../src/moderation/index';
import { SpendTracker } from '../src/moderation/cost';
import { samTimeoutMs, sparkTimeoutMs, startTimeout, voiceTimeoutMs } from '../src/moderation/timeout';
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
      assert.match(res.entry.reason, /MODEL_API_KEY is not set/); // real error, no secrets
      assert.equal(res.costUsd, 0);
      assert.equal(res.debug.transcript, '');
      assert.equal(res.debug.language, 'unknown');
      assert.equal(res.debug.matchedRule, null);
      assert.ok(res.debug.timingsMs.voiceMs >= 0 && res.debug.timingsMs.samMs >= 0);
      assert.match(res.debug.errors.voice ?? '', /MODEL_API_KEY/);
      assert.match(res.debug.errors.sam ?? '', /MODEL_API_KEY/);
    } finally {
      if (prevMode === undefined) delete process.env.MODERATION_MODE;
      else process.env.MODERATION_MODE = prevMode;
      if (prevKey === undefined) delete process.env.MODEL_API_KEY;
      else process.env.MODEL_API_KEY = prevKey;
    }
  });
});

describe('errorDetail', () => {
  it('includes message plus one level of cause, truncated', () => {
    const err = new Error('Connection error.', { cause: new Error('getaddrinfo EAI_AGAIN api.meta.ai') });
    assert.equal(errorDetail(err), 'Connection error. (getaddrinfo EAI_AGAIN api.meta.ai)');
    assert.equal(errorDetail(new Error('x')), 'x');
    assert.equal(errorDetail('plain').length > 0, true);
    const clipped = errorDetail(new Error('y'.repeat(500)));
    assert.ok(clipped.length <= 300);
  });
});

describe('VISUAL_FAIL_MODE', () => {
  it('defaults to closed', () => {
    const saved = process.env.VISUAL_FAIL_MODE;
    delete process.env.VISUAL_FAIL_MODE;
    try {
      assert.equal(visualFailMode(), 'closed');
    } finally {
      if (saved !== undefined) process.env.VISUAL_FAIL_MODE = saved;
    }
  });

  it('open releases visuals unblurred with a warning, audio still fails closed', async () => {
    const prevMode = process.env.MODERATION_MODE;
    const prevKey = process.env.MODEL_API_KEY;
    const prevFail = process.env.VISUAL_FAIL_MODE;
    process.env.MODERATION_MODE = 'live';
    delete process.env.MODEL_API_KEY;
    process.env.VISUAL_FAIL_MODE = 'open';
    try {
      const res = await moderateChunk({
        seq: 1,
        video: Buffer.from('fake-video'),
        wav: Buffer.from('fake-wav'),
        recentTranscript: '',
        tracker: new SpendTracker(),
      });
      const actions = res.decisions.map((d) => d.action).sort();
      assert.deepEqual(actions, ['bleep', 'warn']); // full bleep, no blur
      assert.match(res.entry.reason, /released unblurred \(VISUAL_FAIL_MODE=open\)/);
    } finally {
      if (prevMode === undefined) delete process.env.MODERATION_MODE;
      else process.env.MODERATION_MODE = prevMode;
      if (prevKey === undefined) delete process.env.MODEL_API_KEY;
      else process.env.MODEL_API_KEY = prevKey;
      if (prevFail === undefined) delete process.env.VISUAL_FAIL_MODE;
      else process.env.VISUAL_FAIL_MODE = prevFail;
    }
  });
});

describe('transcode failure', () => {
  it('routes into visual fail handling (warn under open, no network used)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ffail-'));
    const shim = join(dir, 'ffmpeg-fail.sh');
    writeFileSync(shim, '#!/bin/sh\necho \'shim: bad clip\' >&2\nexit 1\n');
    chmodSync(shim, 0o755);
    const prevMode = process.env.MODERATION_MODE;
    const prevKey = process.env.MODEL_API_KEY;
    const prevFail = process.env.VISUAL_FAIL_MODE;
    const prevBin = process.env.FFMPEG_PATH;
    process.env.MODERATION_MODE = 'live';
    process.env.MODEL_API_KEY = 'fake-key-for-transcode-test';
    process.env.VISUAL_FAIL_MODE = 'open';
    process.env.FFMPEG_PATH = shim;
    try {
      const res = await moderateChunk({
        seq: 1,
        video: Buffer.from('untranscodable'),
        wav: null, // null wav never touches the network, even in live mode
        recentTranscript: '',
        tracker: new SpendTracker(),
      });
      assert.deepEqual(res.decisions.map((d) => d.action), ['warn']);
      assert.match(res.decisions[0].reason, /bad clip/);
      assert.match(res.decisions[0].reason, /VISUAL_FAIL_MODE=open/);
      assert.equal(res.entry.action, 'warn');
    } finally {
      if (prevMode === undefined) delete process.env.MODERATION_MODE;
      else process.env.MODERATION_MODE = prevMode;
      if (prevKey === undefined) delete process.env.MODEL_API_KEY;
      else process.env.MODEL_API_KEY = prevKey;
      if (prevFail === undefined) delete process.env.VISUAL_FAIL_MODE;
      else process.env.VISUAL_FAIL_MODE = prevFail;
      if (prevBin === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = prevBin;
    }
  });
});

describe('model timeout', () => {
  it('defaults to 8s voice, 20s sam, 8s spark', () => {
    const saved = {
      voice: process.env.VOICE_TIMEOUT_MS,
      sam: process.env.SAM_TIMEOUT_MS,
      spark: process.env.SPARK_TIMEOUT_MS,
    };
    delete process.env.VOICE_TIMEOUT_MS;
    delete process.env.SAM_TIMEOUT_MS;
    delete process.env.SPARK_TIMEOUT_MS;
    try {
      assert.equal(voiceTimeoutMs(), 8000);
      assert.equal(samTimeoutMs(), 20000);
      assert.equal(sparkTimeoutMs(), 8000);
    } finally {
      if (saved.voice !== undefined) process.env.VOICE_TIMEOUT_MS = saved.voice;
      if (saved.sam !== undefined) process.env.SAM_TIMEOUT_MS = saved.sam;
      if (saved.spark !== undefined) process.env.SPARK_TIMEOUT_MS = saved.spark;
    }
  });

  it('honors env overrides and ignores garbage', () => {
    const saved = process.env.SAM_TIMEOUT_MS;
    try {
      process.env.SAM_TIMEOUT_MS = '1000';
      assert.equal(samTimeoutMs(), 1000);
      process.env.SAM_TIMEOUT_MS = 'nope';
      assert.equal(samTimeoutMs(), 20000);
      process.env.SAM_TIMEOUT_MS = '-5';
      assert.equal(samTimeoutMs(), 20000);
    } finally {
      if (saved === undefined) delete process.env.SAM_TIMEOUT_MS;
      else process.env.SAM_TIMEOUT_MS = saved;
    }
  });

  it('aborts after the configured delay', async () => {
    const t = startTimeout(20);
    assert.equal(t.signal.aborted, false);
    await sleep(200); // generous margin: loaded CI runners stall timers
    assert.equal(t.signal.aborted, true);
    assert.throws(() => t.throwIfAborted('probe'), /probe timed out after 20ms/);
  });

  it('cancel prevents the abort', async () => {
    const t = startTimeout(20);
    t.cancel();
    await sleep(200);
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
