import WebSocket from 'ws';

export const REALTIME_URL = 'wss://api.meta.ai/v1/asr/realtime';
export const REALTIME_MODEL = 'muse-voice-transcribe-1.0';
/** 80ms of 16-bit mono 16kHz PCM per binary frame. */
export const REALTIME_FRAME_BYTES = 2560;
/** Bytes per ms of 16kHz 16-bit mono PCM. */
export const PCM16_BYTES_PER_MS = 32;
/** Never stream more than this far ahead of server progress. */
const MAX_AHEAD_MS = 5000;
/** Rotate the session before the 60-minute server limit. */
const DEFAULT_ROTATE_MS = 55 * 60 * 1000;
const CONNECT_TIMEOUT_MS = 15_000;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000];

export interface RealtimeTranscript {
  text: string;
  final: boolean;
  audioProcessedMs: number;
  turnId: string;
}

export interface RealtimeHandlers {
  onTranscript: (ev: RealtimeTranscript) => void;
  onTurnComplete?: (turnId: string) => void;
  /** True once the handshake acks; false when the socket goes down. */
  onStateChange: (up: boolean) => void;
  onError: (detail: string) => void;
}

export interface RealtimeOptions {
  url?: string;
  model?: string;
  keywords?: string[];
  languageBias?: string[];
  /** Session rotation interval (default 55min; tests shorten it). */
  rotateMs?: number;
  /** Uncommented networks pass nothing; tests/sandbox may inject an agent. */
  agent?: unknown;
}

/**
 * One realtime transcription session: handshake, paced 80ms PCM frames,
 * transcript/progress events, rotation at 55min, backoff reconnect on
 * 1011/1013. Queued PCM survives reconnects; per-session offsets keep
 * audioProcessedMs mappable onto the stream timeline via
 * sessionStartStreamMs (stream ms of the session's first sent byte).
 */
export class RealtimeSession {
  private readonly apiKey: string;
  private readonly opts: RealtimeOptions;
  private readonly handlers: RealtimeHandlers;
  private sock: WebSocket | null = null;
  private live = false;
  private closed = false;
  private acked = false;
  private ending = false;
  private rotating = false;
  private backoffStep = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private rotateTimer: NodeJS.Timeout | null = null;
  private connectTimer: NodeJS.Timeout | null = null;
  private queue: Buffer[] = [];
  private queueTimes: number[] = [];
  private queueBytes = 0;
  private headConsumed = 0;
  private fedSessionMs = 0;
  private processedMs = 0;
  private startStreamMs: number | null = null;

  constructor(apiKey: string, opts: RealtimeOptions, handlers: RealtimeHandlers) {
    this.apiKey = apiKey;
    this.opts = opts;
    this.handlers = handlers;
  }

  get up(): boolean {
    return this.live;
  }

  /** Stream ms of this session's first sent byte (null until audio flows). */
  get sessionStartStreamMs(): number | null {
    return this.startStreamMs;
  }

  /** Queue PCM (16-bit LE mono 16kHz) stamped with its stream start ms. */
  feedPcm(pcm: Buffer, streamStartMs: number): void {
    if (this.closed || pcm.length === 0) return;
    this.queue.push(pcm);
    this.queueTimes.push(streamStartMs);
    this.queueBytes += pcm.length;
    this.pump();
  }

  /** Half-close: flush leftover audio, then end the input stream. */
  endInput(): void {
    if (this.closed) return;
    this.ending = true;
    this.flushRemainder();
    if (this.sock && this.sock.readyState === WebSocket.OPEN && this.acked) {
      try {
        this.sock.send(JSON.stringify({ type: 'endStream' }));
      } catch {
        // socket already gone; nothing more to half-close
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    this.setLive(false);
    try {
      this.sock?.close(1000, 'client close');
    } catch {
      // ignore close errors on teardown
    }
    this.sock = null;
  }

  /** Open (or re-open) the socket. Idempotent while one is in flight. */
  connect(): void {
    if (this.closed || this.sock) return;
    this.acked = false;
    this.ending = false;
    this.rotating = false;
    this.fedSessionMs = 0;
    this.processedMs = 0;
    this.startStreamMs = null;
    const url = this.opts.url ?? REALTIME_URL;
    const sock = new WebSocket(
      url,
      this.opts.agent ? { agent: this.opts.agent as never } : undefined,
    );
    this.sock = sock;
    this.connectTimer = setTimeout(() => this.onConnectTimeout(), CONNECT_TIMEOUT_MS);
    if (typeof this.connectTimer.unref === 'function') this.connectTimer.unref();
    sock.on('open', () => this.onOpen());
    sock.on('message', (data, isBinary) => this.onMessage(data, isBinary));
    sock.on('close', (code: number, reason: Buffer) => this.onClose(sock, code, reason.toString()));
    sock.on('error', () => {
      // Errors surface via close/handshake paths with actionable detail.
    });
  }

  private onOpen(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
    if (!this.sock || this.closed) return;
    // First frame within 10s: the credential travels here, not in headers.
    try {
      this.sock.send(
        JSON.stringify({
          authorization: { accessToken: `Bearer ${this.apiKey}` },
          model: this.opts.model ?? REALTIME_MODEL,
          mode: 'ENDPOINTING',
          audioEncoding: 'PCM_16KHZ',
          ...(this.opts.keywords?.length ? { keywords: this.opts.keywords } : {}),
          ...(this.opts.languageBias?.length ? { languageBias: this.opts.languageBias } : {}),
          partialMode: 'CUMULATIVE',
        }),
      );
    } catch (e) {
      this.handlers.onError(`realtime handshake send failed: ${detail(e)}`);
      if (this.sock) this.onClose(this.sock, 1011, 'handshake send failed');
    }
  }

  private onConnectTimeout(): void {
    this.connectTimer = null;
    const sock = this.sock;
    try {
      sock?.terminate();
    } catch {
      // terminate is best-effort
    }
    // Treat like a backend failure: backoff and retry while active.
    if (sock) this.onClose(sock, 1011, 'connect timeout');
  }

  private onMessage(data: WebSocket.RawData, isBinary: boolean): void {
    if (isBinary) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data.toString()) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof msg.type !== 'string') {
      // The handshake ack is the only server frame without a type field.
      if (typeof msg.sessionId === 'string' && !this.acked) this.onAck();
      return;
    }
    switch (msg.type) {
      case 'transcript': {
        const ms = typeof msg.audioProcessedMs === 'number' ? msg.audioProcessedMs : 0;
        this.processedMs = Math.max(this.processedMs, ms);
        this.handlers.onTranscript({
          text: typeof msg.transcript === 'string' ? msg.transcript : '',
          final: msg.final === true,
          audioProcessedMs: ms,
          turnId: typeof msg.turnId === 'string' || typeof msg.turnId === 'number' ? String(msg.turnId) : '',
        });
        this.pump();
        break;
      }
      case 'audioProgress': {
        const ms = typeof msg.audioProcessedMs === 'number' ? msg.audioProcessedMs : 0;
        this.processedMs = Math.max(this.processedMs, ms);
        this.pump();
        break;
      }
      case 'speechComplete': {
        const turnId =
          typeof msg.turnId === 'string' || typeof msg.turnId === 'number' ? String(msg.turnId) : '';
        this.handlers.onTurnComplete?.(turnId);
        break;
      }
      case 'error': {
        const message =
          typeof msg.message === 'string' && msg.message.length > 0
            ? msg.message
            : typeof msg.errorCode === 'string'
              ? msg.errorCode
              : 'unknown server error';
        this.handlers.onError(`realtime server error: ${message.slice(0, 200)}`);
        break;
      }
      default:
        // speechStart/speechEnd/speaker/progress variants: nothing to do.
        break;
    }
  }

  private onAck(): void {
    this.acked = true;
    this.backoffStep = 0;
    this.setLive(true);
    const rotateMs = this.opts.rotateMs ?? DEFAULT_ROTATE_MS;
    if (rotateMs > 0) {
      this.rotateTimer = setTimeout(() => this.rotate(), rotateMs);
      if (typeof this.rotateTimer.unref === 'function') this.rotateTimer.unref();
    }
    this.pump();
  }

  private onClose(sock: WebSocket, code: number, reason: string): void {
    if (sock !== this.sock) return; // stale socket after a forced rotation
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
    if (this.rotateTimer) clearTimeout(this.rotateTimer);
    this.rotateTimer = null;
    const wasLive = this.live;
    this.setLive(false);
    this.sock = null;
    if (this.closed) return;
    if (this.rotating && (code === 1000 || code === 1005 || code === 1006)) {
      this.rotating = false;
      this.connect();
      return;
    }
    if (this.ending && (code === 1000 || code === 1005)) return; // clean half-close drain
    if (code === 1011 || code === 1013) {
      const wait = BACKOFF_MS[Math.min(this.backoffStep, BACKOFF_MS.length - 1)];
      this.backoffStep += 1;
      this.handlers.onError(`realtime closed ${code} (${reason.slice(0, 120)}); retry in ${wait}ms`);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        if (!this.closed) this.connect();
      }, wait);
      if (typeof this.retryTimer.unref === 'function') this.retryTimer.unref();
      return;
    }
    if (wasLive || this.acked) {
      this.handlers.onError(`realtime closed ${code} (${reason.slice(0, 120)}); fallback only`);
    }
    // Other codes: stay down; the chunk fallback covers moderation.
  }

  /** Rotation: end input, then reconnect once the server closes. */
  private rotate(): void {
    this.rotateTimer = null;
    if (this.closed || !this.live) return;
    this.rotating = true;
    this.flushRemainder();
    try {
      this.sock?.send(JSON.stringify({ type: 'endStream' }));
    } catch {
      // fall through to a fresh socket below
    }
    // If the server never closes, force a fresh session shortly after.
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.closed) return;
      const sock = this.sock;
      try {
        sock?.terminate();
      } catch {
        // best effort
      }
      // The terminate close (1006) reconnects via onClose; only force one
      // here when the socket already vanished.
      if (!this.sock) {
        this.rotating = false;
        this.connect();
      }
    }, 5000);
    if (typeof this.retryTimer.unref === 'function') this.retryTimer.unref();
  }

  private setLive(up: boolean): void {
    if (this.live === up) return;
    this.live = up;
    if (!up && this.retryTimer) {
      // A pending rotation retry must not fire after an unrelated close.
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.handlers.onStateChange(up);
  }

  /** Send full 80ms frames while live and within the 5s ahead cap. */
  private pump(): void {
    while (
      this.live &&
      this.sock &&
      this.sock.readyState === WebSocket.OPEN &&
      this.queueBytes >= REALTIME_FRAME_BYTES &&
      this.fedSessionMs - this.processedMs < MAX_AHEAD_MS
    ) {
      const head = this.queue[0];
      const headTime = this.queueTimes[0];
      const slice = head.subarray(this.headConsumed, this.headConsumed + REALTIME_FRAME_BYTES);
      if (slice.length < REALTIME_FRAME_BYTES) break;
      try {
        this.sock.send(slice);
      } catch {
        return; // close handler owns the reconnect
      }
      if (this.startStreamMs === null) {
        this.startStreamMs = headTime + this.headConsumed / PCM16_BYTES_PER_MS;
      }
      this.headConsumed += REALTIME_FRAME_BYTES;
      this.queueBytes -= REALTIME_FRAME_BYTES;
      this.fedSessionMs += REALTIME_FRAME_BYTES / PCM16_BYTES_PER_MS;
      if (this.headConsumed >= head.length) {
        this.queue.shift();
        this.queueTimes.shift();
        this.headConsumed = 0;
      }
    }
  }

  /** Send a trailing partial frame as-is (used before endStream). */
  private flushRemainder(): void {
    if (!this.live || !this.sock || this.sock.readyState !== WebSocket.OPEN) return;
    if (this.queueBytes <= 0) return;
    const parts: Buffer[] = [];
    this.queue.forEach((q, i) => {
      parts.push(i === 0 ? q.subarray(this.headConsumed) : q);
    });
    const rest = Buffer.concat(parts);
    if (rest.length === 0) return;
    if (this.startStreamMs === null) {
      this.startStreamMs = this.queueTimes[0] + this.headConsumed / PCM16_BYTES_PER_MS;
    }
    try {
      this.sock.send(rest);
    } catch {
      return;
    }
    this.fedSessionMs += rest.length / PCM16_BYTES_PER_MS;
    this.queue = [];
    this.queueTimes = [];
    this.queueBytes = 0;
    this.headConsumed = 0;
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.rotateTimer) clearTimeout(this.rotateTimer);
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.retryTimer = this.rotateTimer = this.connectTimer = null;
  }
}

function detail(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200);
}

/**
 * Emission lag: how far the ASR frontier (audioProcessedMs at the first
 * matching partial) runs past the matched word's true end. Measured 232ms
 * stable over 3 trials on a word at known position; the +250ms end guard
 * absorbs framing/lookahead variance.
 */
export function realtimeLagMs(): number {
  const raw = Number(process.env.REALTIME_LAG_MS ?? 250);
  return Number.isFinite(raw) && raw >= 0 && raw <= 5000 ? raw : 250;
}

/** Guard around the estimated word edges (word start-250 .. word end+250). */
export const WORD_GUARD_MS = 250;

/** Rough spoken-word duration from token length, clamped to 300..1000ms. */
export function estimateWordMs(tokenChars: number): number {
  if (!Number.isFinite(tokenChars) || tokenChars <= 0) return 600;
  return Math.max(300, Math.min(1000, Math.round(tokenChars * 90)));
}

/**
 * Bleep window for a match at stream ms t: lag-corrected word end, minus
 * the estimated word length, ±250ms guards. Sub-chunk, not whole chunks.
 */
export function realtimeBleepWindow(tMs: number, tokenChars: number): { startMs: number; endMs: number } {
  const wordEnd = tMs - realtimeLagMs();
  const wordStart = wordEnd - estimateWordMs(tokenChars);
  return {
    startMs: Math.max(0, Math.round(wordStart - WORD_GUARD_MS)),
    endMs: Math.round(wordEnd + WORD_GUARD_MS),
  };
}

export interface ChunkSlice {
  seq: number;
  startMs: number;
  endMs: number;
}

/** Split a stream-ms range into per-2s-chunk slices (negative head clamped). */
export function mapRangeToChunks(startMs: number, endMs: number, chunkMs = 2000): ChunkSlice[] {
  const out: ChunkSlice[] = [];
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= 0 || chunkMs <= 0) return out;
  const from = Math.max(0, startMs);
  if (from >= endMs) return out;
  const firstSeq = Math.floor(from / chunkMs);
  for (let seq = firstSeq; seq * chunkMs < endMs; seq++) {
    out.push({
      seq,
      startMs: seq === firstSeq ? Math.round(from - seq * chunkMs) : 0,
      endMs: Math.min(chunkMs, Math.round(endMs - seq * chunkMs)),
    });
  }
  return out;
}
