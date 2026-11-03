import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import {
  estimateWordMs,
  mapRangeToChunks,
  realtimeBleepWindow,
  realtimeLagMs,
  RealtimeSession,
  REALTIME_FRAME_BYTES,
  WORD_GUARD_MS,
} from '../src/moderation/realtime';

describe('realtime bleep window', () => {
  it('lags, guards, and word estimates have sane defaults', () => {
    const saved = process.env.REALTIME_LAG_MS;
    delete process.env.REALTIME_LAG_MS;
    try {
      assert.equal(REALTIME_FRAME_BYTES, 2560);
      assert.equal(realtimeLagMs(), 250);
      assert.equal(WORD_GUARD_MS, 250);
      assert.equal(estimateWordMs(6), 540);
      assert.equal(estimateWordMs(1), 300);
      assert.equal(estimateWordMs(40), 1000);
      process.env.REALTIME_LAG_MS = '400';
      assert.equal(realtimeLagMs(), 400);
      process.env.REALTIME_LAG_MS = 'junk';
      assert.equal(realtimeLagMs(), 250);
    } finally {
      if (saved === undefined) delete process.env.REALTIME_LAG_MS;
      else process.env.REALTIME_LAG_MS = saved;
    }
  });

  it('centers word start-250 .. word end+250 on the lag-corrected frontier', () => {
    const saved = process.env.REALTIME_LAG_MS;
    delete process.env.REALTIME_LAG_MS;
    try {
      // Measured: word [1266,1768], first matching partial at t=2000.
      const w = realtimeBleepWindow(2000, 6);
      assert.deepEqual(w, { startMs: 960, endMs: 2000 });
      assert.ok(w.startMs <= 1266 && w.endMs >= 1768, 'covers the true word');
    } finally {
      if (saved === undefined) delete process.env.REALTIME_LAG_MS;
      else process.env.REALTIME_LAG_MS = saved;
    }
  });

  it('clamps negative heads to zero', () => {
    const w = realtimeBleepWindow(100, 6);
    assert.equal(w.startMs, 0);
    assert.ok(w.endMs > 0);
  });
});

describe('mapRangeToChunks', () => {
  it('splits a same-chunk range into one slice', () => {
    assert.deepEqual(mapRangeToChunks(2500, 2800), [{ seq: 1, startMs: 500, endMs: 800 }]);
  });

  it('splits a straddling realtime window across chunks', () => {
    // t=2000 -> [500, 2300]
    assert.deepEqual(mapRangeToChunks(500, 2300), [
      { seq: 0, startMs: 500, endMs: 2000 },
      { seq: 1, startMs: 0, endMs: 300 },
    ]);
  });

  it('clamps a negative head to zero and drops empty ranges', () => {
    assert.deepEqual(mapRangeToChunks(-1500, 300), [{ seq: 0, startMs: 0, endMs: 300 }]);
    assert.deepEqual(mapRangeToChunks(-500, -100), []);
    assert.deepEqual(mapRangeToChunks(100, 100), []);
  });
});

describe('RealtimeSession protocol', () => {
  it('handshakes, streams 80ms frames, and surfaces transcripts', async () => {
    const seen: { handshake: Record<string, unknown> | null; binary: number[]; texts: string[] } = {
      handshake: null,
      binary: [],
      texts: [],
    };
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((r) => server.on('listening', r));
    const port = (server.address() as { port: number }).port;
    server.on('connection', (sock) => {
      sock.on('message', (data, isBinary) => {
        if (isBinary) {
          seen.binary.push((data as Buffer).length);
          return;
        }
        const text = data.toString();
        if (!seen.handshake) {
          seen.handshake = JSON.parse(text) as Record<string, unknown>;
          sock.send(JSON.stringify({ sessionId: 'test-1' }));
          sock.send(
            JSON.stringify({ type: 'transcript', transcript: 'hello waffle', final: false, audioProcessedMs: 160, turnId: 7 }),
          );
        } else {
          seen.texts.push(text);
        }
      });
    });
    const transcripts: Array<{ text: string; final: boolean; audioProcessedMs: number; turnId: string }> = [];
    const states: boolean[] = [];
    const session = new RealtimeSession(
      'key-for-test',
      { url: `ws://127.0.0.1:${port}`, keywords: ['waffle'], languageBias: ['Turkish', 'English'] },
      {
        onTranscript: (ev) => transcripts.push(ev),
        onStateChange: (up) => states.push(up),
        onError: () => {},
      },
    );
    session.connect();
    // Wait for the ack, then feed 160ms of PCM and end input.
    await new Promise<void>((resolve, reject) => {
      const t0 = Date.now();
      const poll = (): void => {
        if (transcripts.length > 0) return resolve();
        if (Date.now() - t0 > 5000) return reject(new Error('no transcript in 5s'));
        setTimeout(poll, 25);
      };
      poll();
    });
    session.feedPcm(Buffer.alloc(5120), 4000);
    await new Promise((r) => setTimeout(r, 150));
    session.endInput();
    await new Promise((r) => setTimeout(r, 150));
    session.close();
    server.close();
    await new Promise((r) => setTimeout(r, 50));

    assert.deepEqual((seen.handshake as { authorization: object }).authorization, { accessToken: 'Bearer key-for-test' });
    assert.equal((seen.handshake as { mode: string }).mode, 'ENDPOINTING');
    assert.equal((seen.handshake as { audioEncoding: string }).audioEncoding, 'PCM_16KHZ');
    assert.deepEqual((seen.handshake as { keywords: string[] }).keywords, ['waffle']);
    assert.deepEqual((seen.handshake as { languageBias: string[] }).languageBias, ['Turkish', 'English']);
    assert.equal((seen.handshake as { partialMode: string }).partialMode, 'CUMULATIVE');
    assert.deepEqual(seen.binary, [2560, 2560]);
    assert.ok(seen.texts.includes(JSON.stringify({ type: 'endStream' })));
    assert.deepEqual(transcripts, [{ text: 'hello waffle', final: false, audioProcessedMs: 160, turnId: '7' }]);
    assert.deepEqual(states[0], true);
    assert.equal(session.sessionStartStreamMs, 4000);
  });

  it('reconnects with backoff after close 1011', async () => {
    let connections = 0;
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((r) => server.on('listening', r));
    const port = (server.address() as { port: number }).port;
    server.on('connection', (sock) => {
      connections += 1;
      sock.on('message', () => {
        if (connections === 1) {
          sock.send(JSON.stringify({ sessionId: 's1' }));
          setTimeout(() => sock.close(1011, 'backend failure'), 20);
        } else {
          sock.send(JSON.stringify({ sessionId: 's2' }));
        }
      });
    });
    const states: boolean[] = [];
    const session = new RealtimeSession(
      'k',
      { url: `ws://127.0.0.1:${port}` },
      { onTranscript: () => {}, onStateChange: (up) => states.push(up), onError: () => {} },
    );
    session.connect();
    await new Promise<void>((resolve, reject) => {
      const t0 = Date.now();
      const poll = (): void => {
        if (connections >= 2 && states.filter(Boolean).length >= 2) return resolve();
        if (Date.now() - t0 > 8000) return reject(new Error('no reconnect in 8s'));
        setTimeout(poll, 50);
      };
      poll();
    });
    session.close();
    server.close();
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(connections >= 2);
    assert.deepEqual(states.slice(0, 3), [true, false, true]);
  });
});
