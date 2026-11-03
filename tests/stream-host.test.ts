import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WebSocket } from 'ws';
import {
  DEFAULT_BLUR_PAD_CHUNKS,
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_MAX_OVERDUE_MS,
  StreamHost,
  blurPadChunks,
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

describe('blurPadChunks', () => {
  it('defaults to 1 and honors BLUR_PAD_CHUNKS', () => {
    assert.equal(DEFAULT_BLUR_PAD_CHUNKS, 1);
    const saved = process.env.BLUR_PAD_CHUNKS;
    delete process.env.BLUR_PAD_CHUNKS;
    try {
      assert.equal(blurPadChunks(), 1);
      process.env.BLUR_PAD_CHUNKS = '0';
      assert.equal(blurPadChunks(), 0);
      process.env.BLUR_PAD_CHUNKS = '2';
      assert.equal(blurPadChunks(), 2);
      process.env.BLUR_PAD_CHUNKS = '-1';
      assert.equal(blurPadChunks(), 1);
      process.env.BLUR_PAD_CHUNKS = 'junk';
      assert.equal(blurPadChunks(), 1);
    } finally {
      if (saved === undefined) delete process.env.BLUR_PAD_CHUNKS;
      else process.env.BLUR_PAD_CHUNKS = saved;
    }
  });
});

describe('safety-margin blur padding', () => {
  function strings(sent: unknown[]): Array<Record<string, unknown>> {
    return sent
      .filter((d): d is string => typeof d === 'string')
      .map((s) => JSON.parse(s) as Record<string, unknown>);
  }

  function publishPair(pub: { emit: (e: string, ...a: unknown[]) => void }, seq: number): void {
    pub.emit('message', JSON.stringify({ type: 'media', kind: 'webm', seq }), false);
    pub.emit('message', Buffer.from(`webm-${seq}`), true);
    pub.emit('message', JSON.stringify({ type: 'media', kind: 'wav', seq }), false);
    pub.emit('message', Buffer.from(`wav-${seq}`), true);
  }

  it('pads the chunks around a flagged chunk with whole-frame blurs', async () => {
    const saved = process.env.BLUR_PAD_CHUNKS;
    delete process.env.BLUR_PAD_CHUNKS;
    const viewerSent: unknown[] = [];
    const pubSent: unknown[] = [];
    try {
      await capture(async () => {
        const host = new StreamHost({ delayMs: 30, tickMs: 5, audioWaitMs: 10 });
        try {
          const pub = fakeSocket(pubSent);
          host.handleConnection(pub, 'publisher');
          host.handleConnection(fakeSocket(viewerSent), 'viewer');
          // Server seqs 0..3; mock slot 3 flags a video rule on server seq 3.
          for (const s of [0, 1, 2, 3]) publishPair(pub, s);
          await sleep(300);
        } finally {
          host.close();
        }
      });
    } finally {
      if (saved === undefined) delete process.env.BLUR_PAD_CHUNKS;
      else process.env.BLUR_PAD_CHUNKS = saved;
    }
    const metas = strings(viewerSent).filter((m) => m.type === 'chunk') as Array<{
      seq: number;
      decisions: Array<Record<string, unknown>>;
    }>;
    const bySeq = new Map(metas.map((m) => [m.seq, m.decisions]));
    // Flagging chunk keeps its direct whole-frame blur.
    const direct = (bySeq.get(3) ?? []).filter((d) => d.action === 'blur');
    assert.equal(direct.length, 1);
    assert.deepEqual(direct[0].box, { x: 0, y: 0, w: 1, h: 1 });
    assert.ok(direct[0].ruleId, 'direct flag keeps its rule id');
    // Previous chunk carries the safety-margin pad.
    const pads = (bySeq.get(2) ?? []).filter((d) => d.label === 'safety margin');
    assert.equal(pads.length, 1);
    assert.deepEqual(pads[0].box, { x: 0, y: 0, w: 1, h: 1 });
    assert.match(String(pads[0].reason), /safety margin for .* \(flagged at chunk #3\)/);
    assert.equal(pads[0].ruleId, direct[0].ruleId);
    // Chunks outside the margin stay clean.
    assert.deepEqual(bySeq.get(0) ?? [], []);
    assert.deepEqual(bySeq.get(1) ?? [], []);
    // The flagging chunk's log entry notes the margin.
    const entries = strings(pubSent).filter((m) => m.type === 'log') as Array<{
      entry: { seq: number; reason: string };
    }>;
    const flagged = entries.find((m) => m.entry.seq === 3);
    assert.match(flagged?.entry.reason ?? '', /safety margin ±1 chunk/);
  });

  it('pads nothing with BLUR_PAD_CHUNKS=0', async () => {
    const saved = process.env.BLUR_PAD_CHUNKS;
    process.env.BLUR_PAD_CHUNKS = '0';
    const viewerSent: unknown[] = [];
    try {
      await capture(async () => {
        const host = new StreamHost({ delayMs: 30, tickMs: 5, audioWaitMs: 10 });
        try {
          const pub = fakeSocket([]);
          host.handleConnection(pub, 'publisher');
          host.handleConnection(fakeSocket(viewerSent), 'viewer');
          for (const s of [0, 1, 2, 3]) publishPair(pub, s);
          await sleep(300);
        } finally {
          host.close();
        }
      });
    } finally {
      if (saved === undefined) delete process.env.BLUR_PAD_CHUNKS;
      else process.env.BLUR_PAD_CHUNKS = saved;
    }
    const metas = strings(viewerSent).filter((m) => m.type === 'chunk') as Array<{
      seq: number;
      decisions: Array<Record<string, unknown>>;
    }>;
    const bySeq = new Map(metas.map((m) => [m.seq, m.decisions]));
    // (Server seq 2 keeps its audio bleep; only blur pads are disabled.)
    assert.equal((bySeq.get(2) ?? []).filter((d) => d.action === 'blur').length, 0);
    assert.equal((bySeq.get(3) ?? []).filter((d) => d.action === 'blur').length, 1);
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
      lines.some((l) => l.includes('[rx] jpg studio=0 frame#1 (early')),
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
          for (const tag of ['jpg-0', 'jpg-1']) {
            pub.emit('message', JSON.stringify({ type: 'media', kind: 'jpg', seq: 0 }), false);
            pub.emit('message', Buffer.from(tag), true);
          }
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
        'chunk0-f0.jpg',
        'chunk0-f1.jpg',
        'chunk0.wav',
        'chunk0.webm',
        'manifest.jsonl',
      ]);
      assert.equal(readFileSync(join(dir, 'chunk0.webm'), 'utf8'), 'webm-bytes');
      assert.equal(readFileSync(join(dir, 'chunk0.wav'), 'utf8'), 'wav-bytes');
      assert.equal(readFileSync(join(dir, 'chunk0-f0.jpg'), 'utf8'), 'jpg-0');
      assert.equal(readFileSync(join(dir, 'chunk0-f1.jpg'), 'utf8'), 'jpg-1');
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

describe('graceful end-of-broadcast drain', () => {
  function publishPair(pub: WebSocket, seq: number): void {
    (pub as unknown as { emit: (e: string, ...a: unknown[]) => void }).emit(
      'message',
      JSON.stringify({ type: 'media', kind: 'webm', seq }),
      false,
    );
    (pub as unknown as { emit: (e: string, ...a: unknown[]) => void }).emit(
      'message',
      Buffer.from(`webm-${seq}`),
      true,
    );
    (pub as unknown as { emit: (e: string, ...a: unknown[]) => void }).emit(
      'message',
      JSON.stringify({ type: 'media', kind: 'wav', seq }),
      false,
    );
    (pub as unknown as { emit: (e: string, ...a: unknown[]) => void }).emit(
      'message',
      Buffer.from(`wav-${seq}`),
      true,
    );
  }

  function strings(sent: unknown[]): Array<Record<string, unknown>> {
    return sent
      .filter((d): d is string => typeof d === 'string')
      .map((s) => JSON.parse(s) as Record<string, unknown>);
  }

  it('plays out buffered chunks to viewers before end-of-stream', async () => {
    const viewerSent: unknown[] = [];
    await capture(async () => {
      const host = new StreamHost({ delayMs: 30, tickMs: 5, audioWaitMs: 10 });
      try {
        const pub = fakeSocket([]);
        host.handleConnection(pub, 'publisher');
        host.handleConnection(fakeSocket(viewerSent), 'viewer');
        publishPair(pub, 0);
        publishPair(pub, 1);
        (pub as unknown as { emit: (e: string, ...a: unknown[]) => void }).emit(
          'message',
          JSON.stringify({ type: 'end-broadcast' }),
          false,
        );
        await sleep(250);
      } finally {
        host.close();
      }
    });
    const msgs = strings(viewerSent);
    const chunks = msgs.filter((m) => m.type === 'chunk');
    const ends = msgs.filter((m) => m.type === 'end');
    assert.deepEqual(
      chunks.map((m) => m.seq),
      [0, 1],
      'both delayed chunks reach the viewer',
    );
    assert.equal(ends.length, 1, 'exactly one end-of-stream');
    assert.ok(
      msgs.indexOf(ends[0]) > msgs.indexOf(chunks[chunks.length - 1]),
      'end-of-stream arrives only after the last chunk bytes',
    );
  });

  it('reports drain progress to the publisher, then ended', async () => {
    const pubSent: unknown[] = [];
    await capture(async () => {
      const host = new StreamHost({ delayMs: 60, tickMs: 5, audioWaitMs: 10 });
      try {
        const pub = fakeSocket(pubSent);
        host.handleConnection(pub, 'publisher');
        publishPair(pub, 0);
        publishPair(pub, 1);
        (pub as unknown as { emit: (e: string, ...a: unknown[]) => void }).emit(
          'message',
          JSON.stringify({ type: 'end-broadcast' }),
          false,
        );
        await sleep(300);
      } finally {
        host.close();
      }
    });
    const msgs = strings(pubSent);
    const drains = msgs.filter((m) => m.type === 'drain');
    const ended = msgs.filter((m) => m.type === 'ended');
    assert.ok(drains.length >= 1, 'at least one drain progress update');
    assert.ok(
      drains.every((m) => typeof m.pending === 'number' && (m.pending as number) >= 0),
      'drain carries a non-negative pending count',
    );
    assert.equal(ended.length, 1, 'exactly one ended notification');
    assert.ok(
      msgs.indexOf(ended[0]) > msgs.indexOf(drains[drains.length - 1]),
      'ended arrives after the last drain update',
    );
  });

  it('still ends viewers cleanly when the publisher vanishes without end-broadcast', async () => {
    const viewerSent: unknown[] = [];
    await capture(async () => {
      const host = new StreamHost({ delayMs: 30, tickMs: 5, audioWaitMs: 10 });
      try {
        const pub = fakeSocket([]);
        host.handleConnection(pub, 'publisher');
        host.handleConnection(fakeSocket(viewerSent), 'viewer');
        publishPair(pub, 0);
        (pub as unknown as { emit: (e: string, ...a: unknown[]) => void }).emit('close');
        await sleep(250);
      } finally {
        host.close();
      }
    });
    const msgs = strings(viewerSent);
    assert.ok(msgs.some((m) => m.type === 'chunk' && m.seq === 0), 'buffered chunk plays out');
    assert.equal(msgs.filter((m) => m.type === 'end').length, 1, 'viewer gets end-of-stream');
  });

  it('tells post-end joiners the stream is over immediately', async () => {
    const lateSent: unknown[] = [];
    await capture(async () => {
      const host = new StreamHost({ delayMs: 30, tickMs: 5, audioWaitMs: 10 });
      try {
        const pub = fakeSocket([]);
        host.handleConnection(pub, 'publisher');
        publishPair(pub, 0);
        (pub as unknown as { emit: (e: string, ...a: unknown[]) => void }).emit(
          'message',
          JSON.stringify({ type: 'end-broadcast' }),
          false,
        );
        await sleep(250);
        host.handleConnection(fakeSocket(lateSent), 'viewer');
        await sleep(50);
      } finally {
        host.close();
      }
    });
    const msgs = strings(lateSent);
    assert.deepEqual(
      msgs.map((m) => m.type),
      ['end'],
      'late joiner gets only end-of-stream, no stale media',
    );
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
