import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadavg } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { WebSocket } from 'ws';
import { DelayBuffer } from '../lib/delay-buffer';
import { Semaphore } from '../lib/semaphore';
import { moderateChunk, moderationMode } from '../moderation/index';
import { ffmpegActiveChildren, preassembleChunk } from '../moderation/transcode';
import { SpendTracker, maxSpendUsd, projectedHourlyUsd } from '../moderation/cost';
import type { ChunkDebug, Decision, ModerationLogEntry } from '../moderation/types';
import type {
  ChunkMetaMessage,
  ClientRole,
  LogBroadcast,
  MediaMetaMessage,
  RulesMessage,
} from '../lib/ws-protocol';

export interface StreamHostOptions {
  delayMs?: number;
  tickMs?: number;
  /** How long to wait for a chunk's wav before moderating without it. */
  audioWaitMs?: number;
  /** Past delayMs + maxOverdueMs, an unmoderated chunk is released censored. */
  maxOverdueMs?: number;
  /** Max chunks moderating at once (bounded pool; release order stays by seq). */
  maxConcurrent?: number;
}

/** Max hold past the playback delay before a chunk is released censored. */
export const DEFAULT_MAX_OVERDUE_MS = 4_000;

/** Overridable via MAX_HOLD_MS (ms past the delay). */
export function maxHoldMs(): number {
  const raw = Number(process.env.MAX_HOLD_MS ?? DEFAULT_MAX_OVERDUE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_OVERDUE_MS;
}

/** Default moderation pool size. */
export const DEFAULT_MAX_CONCURRENT = 8;

/** Overridable via MOD_POOL (chunks moderating at once). Quota allows 8+. */
export function maxConcurrent(): number {
  const raw = Number(process.env.MOD_POOL ?? DEFAULT_MAX_CONCURRENT);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_CONCURRENT;
}

/**
 * Chunk capture dir for DEBUG_CAPTURE=1 (replayed by `npm run soak:live`).
 * CHUNKS_DIR overrides the default /tmp/chunks (tests use a temp dir).
 */
export function captureDir(): string | null {
  if (process.env.DEBUG_CAPTURE !== '1') return null;
  return process.env.CHUNKS_DIR ?? '/tmp/chunks';
}

/** How often the [stats] load line prints. */
const STATS_INTERVAL_MS = 5_000;

interface PendingMedia {
  webm: { data: Buffer; receiptTimeMs: number } | null;
  wav: Buffer | null;
  jpg: Buffer | null;
  serverSeq: number | null;
  studioSeq: number;
  timer: NodeJS.Timeout | null;
  started: boolean;
}

/**
 * Single-stream relay: buffers publisher chunks, moderates each one, and
 * releases chunk + decisions to viewers `delayMs` after server receipt.
 * The first chunk's bytes are retained as the init segment for late joiners.
 */
export class StreamHost {
  private buffer: DelayBuffer<Buffer>;
  private readonly decisions = new Map<number, Decision[]>();
  private readonly chunkDebug = new Map<number, ChunkDebug>();
  private readonly pendingModeration = new Set<number>();
  private readonly viewers = new Set<WebSocket>();
  private readonly startedViewers = new Set<WebSocket>();
  private publisher: WebSocket | null = null;
  private readonly forceReleased = new Set<number>();
  /** Studio seqs whose moderation already started (labels late/orphaned wavs). */
  private readonly startedStudio = new Set<number>();
  private readonly log: ModerationLogEntry[] = [];
  private readonly transcriptWindow: Array<{ atMs: number; text: string }> = [];
  private readonly tracker = new SpendTracker();
  private readonly streamStartMs = Date.now();
  private initSegment: Buffer | null = null;
  private nextSeq = 0;
  private pendingMeta: MediaMetaMessage | null = null;
  private readonly pendingMedia = new Map<number, PendingMedia>();
  private readonly audioWaitMs: number;
  private readonly maxOverdueMs: number;
  private readonly pool: Semaphore;
  private readonly poolMax: number;
  private readonly timer: NodeJS.Timeout;
  private readonly statsTimer: NodeJS.Timeout;
  private readonly loopDelay = monitorEventLoopDelay({ resolution: 20 });
  private lastCpu = process.cpuUsage();

  constructor(opts: StreamHostOptions = {}) {
    this.buffer = new DelayBuffer<Buffer>(opts.delayMs);
    this.audioWaitMs = opts.audioWaitMs ?? 750;
    this.maxOverdueMs = opts.maxOverdueMs ?? maxHoldMs();
    this.poolMax = opts.maxConcurrent ?? maxConcurrent();
    this.pool = new Semaphore(this.poolMax);
    this.timer = setInterval(() => {
      this.flush();
    }, opts.tickMs ?? 250);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.loopDelay.enable();
    if (typeof (this.loopDelay as unknown as { unref?: () => void }).unref === 'function') {
      (this.loopDelay as unknown as { unref: () => void }).unref();
    }
    this.statsTimer = setInterval(() => this.logStats(), STATS_INTERVAL_MS);
    if (typeof this.statsTimer.unref === 'function') this.statsTimer.unref();
  }

  get delayMs(): number {
    return this.buffer.delay;
  }

  get spendUsd(): number {
    return this.tracker.totalUsd;
  }

  handleConnection(ws: WebSocket, role: ClientRole): void {
    if (role === 'publisher') {
      this.attachPublisher(ws);
      return;
    }
    this.viewers.add(ws);
    if (this.initSegment) {
      // Late joiner: headers now (stale media), live-delayed chunks after.
      this.sendChunk(ws, { seq: 0, data: this.initSegment, init: true, decisions: [] });
      this.startedViewers.add(ws);
    }
    ws.on('close', () => {
      this.viewers.delete(ws);
      this.startedViewers.delete(ws);
    });
  }

  close(): void {
    clearInterval(this.timer);
    clearInterval(this.statsTimer);
    this.loopDelay.disable();
    for (const pending of this.pendingMedia.values()) {
      if (pending.timer) clearTimeout(pending.timer);
    }
    this.pendingMedia.clear();
    this.viewers.clear();
    this.startedViewers.clear();
    this.publisher = null;
  }

  private attachPublisher(ws: WebSocket): void {
    if (this.publisher && this.publisher !== ws) {
      try {
        this.publisher.close(1000, 'replaced by new publisher');
      } catch {
        // ignore close errors on a stale socket
      }
    }
    this.publisher = ws;
    this.resetStream();
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        this.onBinary(Buffer.from(data as Buffer));
        return;
      }
      this.onPublisherText(data.toString());
    });
    ws.on('close', () => {
      if (this.publisher === ws) this.publisher = null;
    });
  }

  private resetStream(): void {
    this.buffer.clear();
    this.decisions.clear();
    this.chunkDebug.clear();
    this.pendingModeration.clear();
    this.forceReleased.clear();
    this.startedStudio.clear();
    this.pendingMedia.clear();
    this.pendingMeta = null;
    this.initSegment = null;
    this.nextSeq = 0;
    this.startedViewers.clear();
  }

  private onPublisherText(text: string): void {
    let msg: RulesMessage | MediaMetaMessage | null = null;
    try {
      msg = JSON.parse(text) as RulesMessage | MediaMetaMessage;
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'rules') {
      // Legacy clients may still send free-text rules; they are ignored.
      // Moderation follows only the platform rulebook. No log entry: an
      // ignored message must not look like an applied rule change.
      return;
    }
    if (msg.type === 'media') {
      const meta = msg as MediaMetaMessage;
      if (
        (meta.kind === 'webm' || meta.kind === 'wav' || meta.kind === 'jpg') &&
        Number.isInteger(meta.seq)
      ) {
        this.pendingMeta = meta;
      }
    }
  }

  /** Binary with no preceding media header is treated as a webm chunk (back-compat). */
  private onBinary(data: Buffer): void {
    const meta = this.pendingMeta;
    this.pendingMeta = null;
    const kind = meta?.kind ?? 'webm';
    const studioSeq = meta?.seq ?? this.nextSeq;
    let pending = this.pendingMedia.get(studioSeq);
    if (!pending) {
      pending = {
        webm: null,
        wav: null,
        jpg: null,
        serverSeq: null,
        studioSeq,
        timer: null,
        started: false,
      };
      this.pendingMedia.set(studioSeq, pending);
    }
    if (kind === 'wav') {
      pending.wav = data;
      const state = this.startedStudio.has(studioSeq)
        ? 'late-orphan'
        : pending.webm
          ? 'paired'
          : 'early';
      console.log(`[rx] wav studio=${studioSeq} (${state}, ${data.length}B)`);
    } else if (kind === 'jpg') {
      pending.jpg = data;
      const state = this.startedStudio.has(studioSeq)
        ? 'late-orphan'
        : pending.webm
          ? 'paired'
          : 'early';
      console.log(`[rx] jpg studio=${studioSeq} (${state}, ${data.length}B)`);
    } else {
      const serverSeq = this.nextSeq;
      this.nextSeq += 1;
      const receiptTimeMs = Date.now();
      if (serverSeq === 0) this.initSegment = Buffer.from(data);
      this.buffer.push(data, receiptTimeMs, serverSeq);
      pending.webm = { data, receiptTimeMs };
      pending.serverSeq = serverSeq;
      this.pendingModeration.add(serverSeq);
      console.log(
        `[rx] webm studio=${studioSeq} -> server=${serverSeq} (${data.length}B) ` +
          `at=${new Date(receiptTimeMs).toISOString()}`,
      );
      pending.timer = setTimeout(() => this.startModeration(studioSeq), this.audioWaitMs);
      if (typeof pending.timer.unref === 'function') pending.timer.unref();
    }
    if (pending.webm && pending.wav) {
      this.startModeration(studioSeq);
    }
  }

  private startModeration(studioSeq: number): void {
    const pending = this.pendingMedia.get(studioSeq);
    if (!pending || pending.started || pending.serverSeq === null || !pending.webm) return;
    pending.started = true;
    if (pending.timer) clearTimeout(pending.timer);
    this.pendingMedia.delete(studioSeq);
    this.startedStudio.add(studioSeq);
    const seq = pending.serverSeq;
    // Detection input must be a standalone clip: later chunks are bare
    // clusters, so the retained init segment is prepended before transcoding.
    // Playback still uses the original WebM bytes from the delay buffer.
    const video = preassembleChunk(this.initSegment, pending.webm.data, seq === 0);
    const wav = pending.wav;
    const frameJpg = pending.jpg;
    const receiptTimeMs = pending.webm.receiptTimeMs;
    this.captureChunk(seq, video, wav, frameJpg, receiptTimeMs);
    const recentTranscript = this.recentTranscript();
    // Bounded pool: at most poolMax chunks moderate at once, so a pileup
    // queues instead of stampeding the model APIs. Release order still
    // follows seq (DelayBuffer FIFO + head-of-line gate).
    void this.pool.acquire().then((release) => {
      const queueWaitMs = Date.now() - receiptTimeMs;
      console.log(
        `[mod] start server=${seq} (studio=${studioSeq}, wav=${wav ? 'yes' : 'no'}, ` +
          `queue=${queueWaitMs}ms, pool=${this.pool.depth}/${this.poolMax})`,
      );
      if (this.forceReleased.has(seq)) {
        // Censored by max hold while queued: skip the wasted model calls.
        // (The [hold] line already printed and decisions are already set.)
        release();
        return;
      }
      moderateChunk({
        seq,
        video,
        wav,
        frameJpg,
        receivedAtMs: receiptTimeMs,
        recentTranscript,
        tracker: this.tracker,
      })
        .then((res) => {
          if (this.forceReleased.has(seq)) {
            // Already released censored by max hold: keep the transcript for
            // judge context but don't overwrite the decisions or the log.
            // Still print the debug line (marked late) so no chunk vanishes silently.
            this.forceReleased.delete(seq);
            if (res.transcriptText.trim().length > 0) {
              this.transcriptWindow.push({ atMs: Date.now(), text: res.transcriptText });
            }
            console.log(
              `[debug] chunk #${seq} LATE (force-released earlier) lang=${res.debug.language} ` +
                `rule=${res.debug.matchedRule ?? 'none'} voice=${res.debug.timingsMs.voiceMs}ms ` +
                `sam=${res.debug.timingsMs.samMs}ms judge=${res.debug.timingsMs.judgeMs}ms ` +
                `transcript=${JSON.stringify(res.debug.transcript)}`,
            );
            return;
          }
          this.decisions.set(seq, res.decisions);
          this.chunkDebug.set(seq, res.debug);
          if (res.transcriptText.trim().length > 0) {
            this.transcriptWindow.push({ atMs: Date.now(), text: res.transcriptText });
          }
          this.pushLog(res.entry);
          const hourly = projectedHourlyUsd(this.tracker.totalUsd, Date.now() - this.streamStartMs);
          console.log(
            `[cost] chunk #${seq} mode=${res.mode} +$${res.costUsd.toFixed(4)} ` +
              `total=$${this.tracker.totalUsd.toFixed(4)} ~$${hourly.toFixed(2)}/h ` +
              `(cap $${maxSpendUsd()}, ${moderationMode()})`,
          );
          const judgeShow = res.debug.judgeSkipped ? 'skipped' : `${res.debug.timingsMs.judgeMs}ms`;
          console.log(
            `[debug] chunk #${seq} lang=${res.debug.language} rule=${res.debug.matchedRule ?? 'none'} ` +
              `queue=${res.debug.timingsMs.queueMs}ms voice=${res.debug.timingsMs.voiceMs}ms ` +
              `sam=${res.debug.timingsMs.samMs}ms judge=${judgeShow} ` +
              `transcript=${JSON.stringify(res.debug.transcript)}` +
              (Object.keys(res.debug.errors).length > 0
                ? ` errors=${JSON.stringify(res.debug.errors)}`
                : ''),
          );
        })
        .catch(() => {
          if (this.forceReleased.has(seq)) {
            this.forceReleased.delete(seq);
            return;
          }
          this.decisions.set(seq, []);
          this.pushLog({
            seq,
            at: new Date().toISOString(),
            action: 'warn',
            reason: 'moderation error; released unmodified after delay',
          });
        })
        .finally(() => {
          this.pendingModeration.delete(seq);
          release();
        });
    });
  }

  /** DEBUG_CAPTURE=1: persist the exact moderation inputs for soak:live replay. */
  private captureChunk(
    seq: number,
    video: Buffer,
    wav: Buffer | null,
    frameJpg: Buffer | null,
    receiptTimeMs: number,
  ): void {
    const dir = captureDir();
    if (!dir) return;
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `chunk${seq}.webm`), video);
      if (wav) writeFileSync(join(dir, `chunk${seq}.wav`), wav);
      if (frameJpg) writeFileSync(join(dir, `chunk${seq}.jpg`), frameJpg);
      appendFileSync(
        join(dir, 'manifest.jsonl'),
        JSON.stringify({
          seq,
          receivedAtMs: receiptTimeMs,
          hasWav: !!wav,
          hasJpg: !!frameJpg,
        }) + '\n',
      );
    } catch (e) {
      console.log(`[capture] chunk #${seq} save failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** 5s load line: OS load, process CPU, event-loop lag, ffmpeg, pool, sockets. */
  private logStats(): void {
    const cpu = process.cpuUsage(this.lastCpu);
    this.lastCpu = process.cpuUsage();
    const cpuPct = ((cpu.user + cpu.system) / (STATS_INTERVAL_MS * 1000)) * 100;
    const sockets = process
      .getActiveResourcesInfo()
      .filter((t) => t.toLowerCase().includes('socket')).length;
    const heapMb = Math.round(process.memoryUsage().heapUsed / 1048576);
    console.log(
      `[stats] load=${loadavg()[0].toFixed(2)} cpu=${cpuPct.toFixed(0)}% ` +
        `loopP50=${(this.loopDelay.mean / 1e6).toFixed(1)}ms ` +
        `loopP99=${(this.loopDelay.percentile(99) / 1e6).toFixed(1)}ms ` +
        `loopMax=${(this.loopDelay.max / 1e6).toFixed(0)}ms ` +
        `ffmpeg=${ffmpegActiveChildren()} pool=${this.pool.depth}/${this.poolMax} ` +
        `poolQueue=${this.pool.pending} buffer=${this.buffer.size} ` +
        `socks=${sockets} heap=${heapMb}MB`,
    );
    this.loopDelay.reset();
  }

  private recentTranscript(): string {
    const cutoff = Date.now() - 60_000;
    while (this.transcriptWindow.length > 0 && this.transcriptWindow[0].atMs < cutoff) {
      this.transcriptWindow.shift();
    }
    return this.transcriptWindow.map((t) => t.text).join(' ');
  }

  /**
   * Max hold: a chunk still unmoderated past delay + maxOverdue is released
   * blurred and bleeped in full instead of blocking the queue behind it.
   */
  private forceReleaseOverdue(nowMs: number): void {
    for (const chunk of this.buffer.snapshot()) {
      if (!this.pendingModeration.has(chunk.seq)) continue;
      if (nowMs - chunk.receiptTimeMs <= this.buffer.delay + this.maxOverdueMs) continue;
      this.pendingModeration.delete(chunk.seq);
      this.forceReleased.add(chunk.seq);
      const reason =
        `moderation unavailable: unmoderated ${this.maxOverdueMs}ms past the delay; ` +
        'released blurred and bleeped in full';
      this.decisions.set(chunk.seq, [
        { action: 'bleep', reason, startMs: 0, endMs: 2000 },
        {
          action: 'blur',
          reason,
          startMs: 0,
          endMs: 2000,
          box: { x: 0, y: 0, w: 1, h: 1 },
          label: 'full frame (max hold exceeded)',
        },
      ]);
      this.chunkDebug.set(chunk.seq, {
        transcript: '',
        language: 'unknown',
        matchedRule: null,
        timingsMs: { queueMs: nowMs - chunk.receiptTimeMs, voiceMs: 0, samMs: 0, judgeMs: 0 },
        judgeSkipped: false,
        errors: { sam: `max hold exceeded (${this.maxOverdueMs}ms past the delay)` },
      });
      this.pushLog({ seq: chunk.seq, at: new Date().toISOString(), action: 'bleep', reason });
      console.log(
        `[hold] chunk #${chunk.seq} force-released censored ` +
          `(unmoderated ${nowMs - chunk.receiptTimeMs - this.buffer.delay}ms past the delay)`,
      );
    }
  }

  private flush(): void {
    const nowMs = Date.now();
    this.forceReleaseOverdue(nowMs);
    const due = this.buffer.popDue(nowMs, (chunk) => !this.pendingModeration.has(chunk.seq));
    if (due.length === 0) return;
    for (const chunk of due) {
      const decisions = this.decisions.get(chunk.seq) ?? [];
      const debug = this.chunkDebug.get(chunk.seq);
      for (const ws of [...this.viewers]) {
        if (ws.readyState !== 1) {
          this.viewers.delete(ws);
          this.startedViewers.delete(ws);
          continue;
        }
        const init = !this.startedViewers.has(ws);
        this.sendChunk(ws, { seq: chunk.seq, data: chunk.data, init, decisions, debug });
        this.startedViewers.add(ws);
      }
    }
    const lags = due.map((c) => nowMs - c.receiptTimeMs);
    console.log(
      `[tx] released seqs=[${due.map((c) => c.seq).join(',')}] ` +
        `receipt-to-release=${Math.min(...lags)}..${Math.max(...lags)}ms`,
    );
  }

  private sendChunk(
    ws: WebSocket,
    args: { seq: number; data: Buffer; init: boolean; decisions: Decision[]; debug?: ChunkDebug },
  ): void {
    const meta: ChunkMetaMessage = {
      type: 'chunk',
      seq: args.seq,
      init: args.init,
      decisions: args.decisions,
      receiptTimeMs: Date.now(),
      ...(args.debug ? { debug: args.debug } : {}),
    };
    ws.send(JSON.stringify(meta));
    ws.send(args.data);
  }

  private pushLog(entry: ModerationLogEntry): void {
    this.log.push(entry);
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
    if (this.publisher && this.publisher.readyState === 1) {
      const msg: LogBroadcast = { type: 'log', entry };
      this.publisher.send(JSON.stringify(msg));
    }
  }
}
