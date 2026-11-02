export const DEFAULT_PLAYBACK_DELAY_MS = 10_000;

export interface BufferedChunk<T> {
  data: T;
  /** Server receipt time (Date.now()). Delay is measured from this, not capture time. */
  receiptTimeMs: number;
  seq: number;
}

/** FIFO ring that releases chunks only after `delayMs` past their receipt time. */
export class DelayBuffer<T> {
  private readonly delayMs: number;
  private queue: BufferedChunk<T>[] = [];

  constructor(delayMs: number = DEFAULT_PLAYBACK_DELAY_MS) {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new Error('delayMs must be a finite number >= 0');
    }
    this.delayMs = delayMs;
  }

  get delay(): number {
    return this.delayMs;
  }

  get size(): number {
    return this.queue.length;
  }

  push(data: T, receiptTimeMs: number, seq: number): void {
    this.queue.push({ data, receiptTimeMs, seq });
  }

  /**
   * Release every due chunk in receipt order. `canRelease` holds the head
   * (e.g. moderation still pending) without losing it or skipping ahead.
   */
  popDue(nowMs: number, canRelease?: (chunk: BufferedChunk<T>) => boolean): BufferedChunk<T>[] {
    const due: BufferedChunk<T>[] = [];
    while (this.queue.length > 0) {
      const head = this.queue[0];
      if (nowMs - head.receiptTimeMs < this.delayMs) break;
      if (canRelease && !canRelease(head)) break;
      const next = this.queue.shift();
      if (next) due.push(next);
    }
    return due;
  }

  /** Copy of the queued entries in release order (for overdue inspection). */
  snapshot(): BufferedChunk<T>[] {
    return [...this.queue];
  }

  clear(): void {
    this.queue = [];
  }
}
