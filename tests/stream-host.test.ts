import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import { StreamHost } from '../src/server/stream-host';

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

  it('logs force-releases and late completions instead of going silent', async () => {
    const lines = await capture(async () => {
      const host = new StreamHost({ delayMs: 20, tickMs: 5, audioWaitMs: 60_000, maxOverdueMs: 30 });
      try {
        const pub = fakeSocket([]);
        host.handleConnection(pub, 'publisher');
        pub.emit('message', JSON.stringify({ type: 'media', kind: 'webm', seq: 0 }), false);
        pub.emit('message', Buffer.from('webm-orphan'), true);
        await sleep(150); // past delay + maxOverdue: force-released without moderation
        pub.emit('message', JSON.stringify({ type: 'media', kind: 'wav', seq: 0 }), false);
        pub.emit('message', Buffer.from('wav-late'), true); // moderation now completes late
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
      lines.some((l) => l.startsWith('[debug] chunk #0 LATE')),
      'late completion debug line',
    );
  });
});
