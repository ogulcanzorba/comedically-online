import type { WebSocket } from 'ws';
import { DelayBuffer } from '../lib/delay-buffer';
import { moderateChunk, moderationMode } from '../moderation/index';
import { SpendTracker, maxSpendUsd, projectedHourlyUsd } from '../moderation/cost';
import type { Decision, ModerationLogEntry } from '../moderation/types';
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
}

interface PendingMedia {
  webm: { data: Buffer; receiptTimeMs: number } | null;
  wav: Buffer | null;
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
  private readonly pendingModeration = new Set<number>();
  private readonly viewers = new Set<WebSocket>();
  private readonly startedViewers = new Set<WebSocket>();
  private publisher: WebSocket | null = null;
  private rules: string[] = [];
  private readonly log: ModerationLogEntry[] = [];
  private readonly transcriptWindow: Array<{ atMs: number; text: string }> = [];
  private readonly tracker = new SpendTracker();
  private readonly streamStartMs = Date.now();
  private initSegment: Buffer | null = null;
  private nextSeq = 0;
  private pendingMeta: MediaMetaMessage | null = null;
  private readonly pendingMedia = new Map<number, PendingMedia>();
  private readonly audioWaitMs: number;
  private readonly timer: NodeJS.Timeout;

  constructor(opts: StreamHostOptions = {}) {
    this.buffer = new DelayBuffer<Buffer>(opts.delayMs);
    this.audioWaitMs = opts.audioWaitMs ?? 750;
    this.timer = setInterval(() => {
      this.flush();
    }, opts.tickMs ?? 250);
    if (typeof this.timer.unref === 'function') this.timer.unref();
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
    this.pendingModeration.clear();
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
    if (msg.type === 'rules' && Array.isArray((msg as RulesMessage).rules)) {
      const rules = (msg as RulesMessage).rules;
      this.rules = rules.filter((r): r is string => typeof r === 'string').slice(0, 20);
      this.pushLog({ seq: -1, at: new Date().toISOString(), action: 'allow', reason: `rules updated (${this.rules.length})` });
      return;
    }
    if (msg.type === 'media') {
      const meta = msg as MediaMetaMessage;
      if ((meta.kind === 'webm' || meta.kind === 'wav') && Number.isInteger(meta.seq)) {
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
      pending = { webm: null, wav: null, serverSeq: null, studioSeq, timer: null, started: false };
      this.pendingMedia.set(studioSeq, pending);
    }
    if (kind === 'wav') {
      pending.wav = data;
    } else {
      const serverSeq = this.nextSeq;
      this.nextSeq += 1;
      const receiptTimeMs = Date.now();
      if (serverSeq === 0) this.initSegment = Buffer.from(data);
      this.buffer.push(data, receiptTimeMs, serverSeq);
      pending.webm = { data, receiptTimeMs };
      pending.serverSeq = serverSeq;
      this.pendingModeration.add(serverSeq);
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
    const seq = pending.serverSeq;
    const video = pending.webm.data;
    const wav = pending.wav;
    moderateChunk({
      seq,
      video,
      wav,
      rules: this.rules,
      recentTranscript: this.recentTranscript(),
      tracker: this.tracker,
    })
      .then((res) => {
        this.decisions.set(seq, res.decisions);
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
      })
      .catch(() => {
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
      });
  }

  private recentTranscript(): string {
    const cutoff = Date.now() - 60_000;
    while (this.transcriptWindow.length > 0 && this.transcriptWindow[0].atMs < cutoff) {
      this.transcriptWindow.shift();
    }
    return this.transcriptWindow.map((t) => t.text).join(' ');
  }

  private flush(): void {
    const due = this.buffer.popDue(Date.now(), (chunk) => !this.pendingModeration.has(chunk.seq));
    if (due.length === 0) return;
    for (const chunk of due) {
      const decisions = this.decisions.get(chunk.seq) ?? [];
      for (const ws of [...this.viewers]) {
        if (ws.readyState !== 1) {
          this.viewers.delete(ws);
          this.startedViewers.delete(ws);
          continue;
        }
        const init = !this.startedViewers.has(ws);
        this.sendChunk(ws, { seq: chunk.seq, data: chunk.data, init, decisions });
        this.startedViewers.add(ws);
      }
    }
  }

  private sendChunk(
    ws: WebSocket,
    args: { seq: number; data: Buffer; init: boolean; decisions: Decision[] },
  ): void {
    const meta: ChunkMetaMessage = {
      type: 'chunk',
      seq: args.seq,
      init: args.init,
      decisions: args.decisions,
      receiptTimeMs: Date.now(),
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
