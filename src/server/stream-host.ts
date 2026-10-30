import type { WebSocket } from 'ws';
import { DelayBuffer } from '../lib/delay-buffer';
import { moderateChunk } from '../moderation/index';
import type { Decision, ModerationLogEntry } from '../moderation/types';
import type { ChunkMetaMessage, ClientRole, LogBroadcast, RulesMessage } from '../lib/ws-protocol';

export interface StreamHostOptions {
  delayMs?: number;
  tickMs?: number;
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
  private initSegment: Buffer | null = null;
  private nextSeq = 0;
  private readonly timer: NodeJS.Timeout;

  constructor(opts: StreamHostOptions = {}) {
    this.buffer = new DelayBuffer<Buffer>(opts.delayMs);
    this.timer = setInterval(() => {
      this.flush();
    }, opts.tickMs ?? 250);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  get delayMs(): number {
    return this.buffer.delay;
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
        this.onChunk(Buffer.from(data as Buffer));
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
    this.initSegment = null;
    this.nextSeq = 0;
    this.startedViewers.clear();
  }

  private onPublisherText(text: string): void {
    let msg: RulesMessage | null = null;
    try {
      msg = JSON.parse(text) as RulesMessage;
    } catch {
      return;
    }
    if (msg && msg.type === 'rules' && Array.isArray(msg.rules)) {
      this.rules = msg.rules.filter((r): r is string => typeof r === 'string').slice(0, 20);
      this.pushLog({ seq: -1, at: new Date().toISOString(), action: 'allow', reason: `rules updated (${this.rules.length})` });
    }
  }

  private onChunk(data: Buffer): void {
    const seq = this.nextSeq;
    this.nextSeq += 1;
    const receiptTimeMs = Date.now();
    if (seq === 0) this.initSegment = Buffer.from(data);
    this.buffer.push(data, receiptTimeMs, seq);
    this.pendingModeration.add(seq);
    moderateChunk({ seq, audio: data, rules: this.rules })
      .then((res) => {
        this.decisions.set(seq, res.decisions);
        this.pushLog(res.entry);
      })
      .catch(() => {
        // Fail open on transport, fail closed on visibility: hold the chunk
        // until the next tick retries, keep a log entry either way.
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
