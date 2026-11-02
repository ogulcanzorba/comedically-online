/**
 * End-to-end relay proof: publisher -> StreamHost -> viewer.
 * Uses the REAL default 20s delay. Exits non-zero on any failed assertion.
 */
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { StreamHost } from '../src/server/stream-host';
import { DEFAULT_PLAYBACK_DELAY_MS } from '../src/lib/delay-buffer';
import type { ChunkMetaMessage } from '../src/lib/ws-protocol';

const TOLERANCE_MS = 3_000;

function fail(msg: string): never {
  console.error(`PROOF FAILED: ${msg}`);
  process.exit(1);
}

function assert(cond: boolean, msg: string): void {
  if (!cond) fail(msg);
  console.log(`  ok: ${msg}`);
}

async function main(): Promise<void> {
  assert(DEFAULT_PLAYBACK_DELAY_MS === 20_000, 'default delay is exactly 20s');

  const host = new StreamHost(); // real 20s delay
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => {
    const role = (req.url ?? '').includes('role=publisher') ? 'publisher' : 'viewer';
    host.handleConnection(ws, role);
  });
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') fail('no listen address');
  const port = (address as { port: number }).port;

  const viewer = new WebSocket(`ws://127.0.0.1:${port}/ws?role=viewer`);
  const publisher = new WebSocket(`ws://127.0.0.1:${port}/ws?role=publisher`);
  await Promise.all([
    new Promise<void>((resolve) => viewer.on('open', () => resolve())),
    new Promise<void>((resolve) => publisher.on('open', () => resolve())),
  ]);

  interface Received {
    meta: ChunkMetaMessage;
    bytes: Buffer;
    atMs: number;
  }
  const received: Received[] = [];
  let pendingMeta: ChunkMetaMessage | null = null;
  viewer.on('message', (data, isBinary) => {
    if (!isBinary) {
      pendingMeta = JSON.parse(data.toString()) as ChunkMetaMessage;
      return;
    }
    if (pendingMeta) {
      received.push({ meta: pendingMeta, bytes: Buffer.from(data as Buffer), atMs: Date.now() });
      pendingMeta = null;
    }
  });
  const viewerLogs: string[] = [];
  publisher.on('message', (data) => viewerLogs.push(data.toString()));

  const t0 = Date.now();
  publisher.send(Buffer.from('fake-init-segment-bytes'));
  await new Promise((r) => setTimeout(r, 1_000));
  const t1 = Date.now();
  publisher.send(Buffer.from('fake-chunk-1-bytes'));

  // Wait for both chunks: last publish + 20s delay + tolerance.
  await new Promise((r) => setTimeout(r, 20_000 + TOLERANCE_MS));
  assert(received.length === 2, `viewer received 2 chunks (got ${received.length})`);

  const [first, second] = received;
  assert(first.meta.init === true, 'first chunk flagged as init segment');
  assert(first.bytes.toString() === 'fake-init-segment-bytes', 'first chunk bytes intact');
  assert(second.meta.init === false, 'second chunk not flagged as init');
  assert(second.bytes.toString() === 'fake-chunk-1-bytes', 'second chunk bytes intact');
  assert(first.meta.seq === 0 && second.meta.seq === 1, 'chunks arrive in publish order');

  const d0 = first.atMs - t0;
  const d1 = second.atMs - t1;
  console.log(`  info: chunk0 delay ${d0}ms, chunk1 delay ${d1}ms`);
  assert(d0 >= 20_000 && d0 < 20_000 + TOLERANCE_MS, `chunk0 delayed ~20s (got ${d0}ms)`);
  assert(d1 >= 20_000 && d1 < 20_000 + TOLERANCE_MS, `chunk1 delayed ~20s (got ${d1}ms)`);
  assert(Array.isArray(first.meta.decisions), 'chunk meta carries decisions array');

  // Moderation log reaches the studio.
  assert(viewerLogs.length >= 2, `publisher got log entries (got ${viewerLogs.length})`);

  // Late joiner gets the init segment immediately, not after 20s.
  // Attach the handler before open: the server sends init on connection.
  const late = new WebSocket(`ws://127.0.0.1:${port}/ws?role=viewer`);
  const lateGotPromise = new Promise<ChunkMetaMessage>((resolve) => {
    let meta: ChunkMetaMessage | null = null;
    late.on('message', (data, isBinary) => {
      if (!isBinary) {
        meta = JSON.parse(data.toString()) as ChunkMetaMessage;
        return;
      }
      if (meta) resolve(meta);
    });
  });
  await new Promise<void>((resolve) => late.on('open', () => resolve()));
  const lateAt = Date.now();
  const lateGot = await lateGotPromise;
  assert(lateGot.init === true, 'late joiner receives init segment first');
  assert(Date.now() - lateAt < 2_000, 'late joiner init arrives immediately (<2s)');

  viewer.close();
  publisher.close();
  late.close();
  host.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  console.log('RELAY PROOF PASSED: 20s delay, order, init-first, log, late-join all verified.');
}

void main();
