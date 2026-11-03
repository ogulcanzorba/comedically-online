import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WebSocket } from 'ws';
import {
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_MAX_OVERDUE_MS,
  StreamHost,
  captureDir,
  maxConcurrent,
  maxHoldMs,
} from '../src/server/stream-host';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function fakeSocket(sent: unknown[]): WebSocket {
  const sock = new EventEmitter() as unknown as WebSocket & { readyState: number };
  sock.readyState = 1;
  (sock as unknown as { send: (d: unknown) => void }).send = (d: unknown) => {
    sent.push(d);
  };
  return sock as WebSocket;
}

/** Capture console.log lines while fn runs; always restores. */
async function capture(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    await fn();
  } finally {
    console.log = orig;
  }
  return lines;
}

describe('maxHoldMs', () => {
  it('defaults to 4000ms past the delay and honors MAX_HOLD_MS', () => {
    assert.equal(DEFAULT_MAX_OVERDUE_MS, 4000);
    const saved = process.env.MAX_HOLD_MS;
    delete process.env.MAX_HOLD_MS;
    try {
      assert.equal(maxHoldMs(), 4000);
      process.env.MAX_HOLD_MS = '8000';
      assert.equal(maxHoldMs(), 8000);
      process.env.MAX_HOLD_MS = 'junk';
      assert.equal(maxHoldMs(), 4000);
    } finally {
      if (saved === undefined) delete process.env.MAX_HOLD_MS;
      else process.env.MAX_HOLD_MS = saved;
    }
  });
});

describe('maxConcurrent', () => {
  it('defaults to 8 and honors MOD_POOL', () => {
    assert.equal(DEFAULT_MAX_CONCURRENT, 8);
    const saved = process.env.MOD_POOL;
    delete process.env.MOD_POOL;
    try {
      assert.equal(maxConcurrent(), 8);
      process.env.MOD_POOL = '2';
      assert.equal(maxConcurrent(), 2);
      process.env.MOD_POOL = 'junk';
      assert.equal(maxConcurrent(), 8);
      process.env.MOD_POOL = '0';
      assert.equal(maxConcurrent(), 8);
    } finally {
      if (saved === undefined) delete process.env.MOD_POOL;
      else process.env.MOD_POOL = saved;
    }
  });
});

describe('jpg frame pairing', () => {
  it('accepts studio canvas frames and logs their pairing state', async () => {
    const lines = await capture(async () => {
      const host = new StreamHost({ delayMs: 30, tickMs: 10, audioWaitMs: 20 });
      try {
        const pub = fakeSocket([]);
        host.handleConnection(pub, 'publisher');
        pub.emit('message', JSON.stringify({ type: 'media', kind: 'jpg', seq: 0 }), false);
        pub.emit('message', Buffer.from('jpg-bytes'), true);
        pub.emit('message', JSON.stringify({ type: 'media', kind: 'webm', seq: 0 }), false);
        pub.emit('message', Buffer.from('webm-bytes'), true);
        await sleep(150);
      } finally {
        host.close();
      }
    });
    assert.ok(
      lines.some((l) => l.includes('[rx] jpg studio=0 (early')),
      'jpg arriving before its webm logs as early',
    );
    assert.ok(
      lines.some((l) => l.startsWith('[debug] chunk #0 ')),
      'moderation still runs with the frame attached',
    );
  });
});

describe('captureDir', () => {
  it('is off by default, /tmp/chunks on opt-in, overridable for tests', () => {
    const savedCap = process.env.DEBUG_CAPTURE;
    const savedDir = process.env.CHUNKS_DIR;
    delete process.env.DEBUG_CAPTURE;
    delete process.env.CHUNKS_DIR;
    try {
      assert.equal(captureDir(), null);
      process.env.DEBUG_CAPTURE = '1';
      assert.equal(captureDir(), '/tmp/chunks');
      process.env.CHUNKS_DIR = '/tmp/custom-chunks';
      assert.equal(captureDir(), '/tmp/custom-chunks');
    } finally {
      if (savedCap === undefined) delete process.env.DEBUG_CAPTURE;
      else process.env.DEBUG_CAPTURE = savedCap;
      if (savedDir === undefined) delete process.env.CHUNKS_DIR;
      else process.env.CHUNKS_DIR = savedDir;
    }
  });
});

describe('DEBUG_CAPTURE', () => {
  it('persists the exact moderation inputs plus a manifest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chunks-'));
    const savedCap = process.env.DEBUG_CAPTURE;
    const savedDir = process.env.CHUNKS_DIR;
    process.env.DEBUG_CAPTURE = '1';
    process.env.CHUNKS_DIR = dir;
    try {
      await capture(async () => {
        const host = new StreamHost({ delayMs: 30, tickMs: 10, audioWaitMs: 20 });
        try {
          const pub = fakeSocket([]);
          host.handleConnection(pub, 'publisher');
          pub.emit('message', JSON.stringify({ type: 'media', kind: 'jpg', seq: 0 }), false);
          pub.emit('message', Buffer.from('jpg-bytes'), true);
          pub.emit('message', JSON.stringify({ type: 'media', kind: 'webm', seq: 0 }), false);
          pub.emit('message', Buffer.from('webm-bytes'), true);
          pub.emit('message', JSON.stringify({ type: 'media', kind: 'wav', seq: 0 }), false);
          pub.emit('message', Buffer.from('wav-bytes'), true);
          await sleep(150);
        } finally {
          host.close();
        }
      });
      assert.deepEqual(readdirSync(dir).sort(), [
        'chunk0.jpg',
        'chunk0.wav',
        'chunk0.webm',
        'manifest.jsonl',
      ]);
      assert.equal(readFileSync(join(dir, 'chunk0.webm'), 'utf8'), 'webm-bytes');
      assert.equal(readFileSync(join(dir, 'chunk0.wav'), 'utf8'), 'wav-bytes');
      assert.equal(readFileSync(join(dir, 'chunk0.jpg'), 'utf8'), 'jpg-bytes');
      const row = JSON.parse(readFileSync(join(dir, 'manifest.jsonl'), 'utf8').trim()) as {
        seq: number;
        receivedAtMs: number;
        hasWav: boolean;
        hasJpg: boolean;
      };
      assert.equal(row.seq, 0);
      assert.equal(row.hasWav, true);
      assert.equal(row.hasJpg, true);
      assert.ok(row.receivedAtMs > 0);
    } finally {
      if (savedCap === undefined) delete process.env.DEBUG_CAPTURE;
      else process.env.DEBUG_CAPTURE = savedCap;
      if (savedDir === undefined) delete process.env.CHUNKS_DIR;
      else process.env.CHUNKS_DIR = savedDir;
    }
  });
});

describe('per-chunk lifecycle log', () => {
  it('logs received, moderated, and released seqs for every chunk', async () => {
    const lines = await capture(async () => {
      const host = new StreamHost({ delayMs: 30, tickMs: 10, audioWaitMs: 20 });
      try {
        const pub = fakeSocket([]);
        host.handleConnection(pub, 'publisher');
        host.handleConnection(fakeSocket([]), 'viewer');
        for (const seq of [0, 1]) {
          pub.emit('message', JSON.stringify({ type: 'media', kind: 'webm', seq }), false);
          pub.emit('message', Buffer.from(`webm-${seq}`), true);
          pub.emit('message', JSON.stringify({ type: 'media', kind: 'wav', seq }), false);
          pub.emit('message', Buffer.from(`wav-${seq}`), true);
        }
        await sleep(250);
      } finally {
        host.close();
      }
    });
    for (const seq of [0, 1]) {
      assert.ok(lines.some((l) => l.includes(`[rx] webm studio=${seq} -> server=${seq}`)), `rx webm ${seq}`);
      assert.ok(lines.some((l) => l.includes(`[rx] wav studio=${seq} (paired`)), `rx wav ${seq}`);
      assert.ok(lines.some((l) => l.includes(`[mod] start server=${seq}`)), `mod start ${seq}`);
      assert.ok(lines.some((l) => l.startsWith(`[debug] chunk #${seq} `)), `debug ${seq}`);
    }
    const tx = lines.filter((l) => l.startsWith('[tx]')).join(' ');
    assert.ok(tx.includes('0') && tx.includes('1'), `release lines cover both seqs: ${tx}`);
  });

  it('force-releases visibly and skips moderation that arrives after the hold', async () => {
    const viewerSent: unknown[] = [];
    const lines = await capture(async () => {
      const host = new StreamHost({ delayMs: 20, tickMs: 5, audioWaitMs: 60_000, maxOverdueMs: 30 });
      try {
        const pub = fakeSocket([]);
        host.handleConnection(pub, 'publisher');
        pub.emit('message', JSON.stringify({ type: 'media', kind: 'webm', seq: 0 }), false);
        pub.emit('message', Buffer.from('webm-orphan'), true);
        host.handleConnection(fakeSocket(viewerSent), 'viewer');
        await sleep(150); // past delay + maxOverdue: force-released without moderation
        pub.emit('message', JSON.stringify({ type: 'media', kind: 'wav', seq: 0 }), false);
        pub.emit('message', Buffer.from('wav-late'), true); // moderation would start now: skipped
        await sleep(150);
      } finally {
        host.close();
      }
    });
    assert.ok(
      lines.some((l) => l.startsWith('[hold] chunk #0') && l.includes('force-released censored')),
      'force-release console line',
    );
    assert.ok(
      !lines.some((l) => l.startsWith('[debug] chunk #0')),
      'no moderation ran after the hold, so no debug line and no wasted model calls',
    );
    const metas = viewerSent
      .filter((d): d is string => typeof d === 'string')
      .map((s) => JSON.parse(s) as { type: string; init?: boolean; decisions?: Array<{ action: string }> });
    const released = metas.find((m) => m.type === 'chunk' && m.init === false);
    assert.deepEqual(
      released?.decisions?.map((d) => d.action).sort(),
      ['bleep', 'blur'],
    );
  });
});
