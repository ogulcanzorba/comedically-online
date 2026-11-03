import { useSyncExternalStore } from 'react';

/**
 * Device-local broadcast recording. The studio stashes every 2s MediaRecorder
 * blob it sends; the full broadcast (original and censored views) is a
 * byte-concatenation of those blobs, assembled lazily as an object URL.
 * Everything stays in this tab's memory; nothing is uploaded anywhere.
 */

export interface LocalChunk {
  seq: number;
  blob: Blob;
}

class LocalRecordingStore {
  private chunks: LocalChunk[] = [];
  private fullUrl: string | null = null;
  private listeners = new Set<() => void>();
  private _version = 0;
  status: 'idle' | 'recording' | 'ended' = 'idle';
  /** Bumped on every start(): panels watch it to wipe the previous broadcast. */
  generation = 0;

  get version(): number {
    return this._version;
  }

  get count(): number {
    return this.chunks.length;
  }

  get hasRecording(): boolean {
    return this.chunks.length > 0;
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  private emit(): void {
    this._version += 1;
    for (const cb of [...this.listeners]) cb();
  }

  private revokeAll(): void {
    if (this.fullUrl) URL.revokeObjectURL(this.fullUrl);
    this.fullUrl = null;
  }

  /** Fresh broadcast: drop the previous recording and its URLs. */
  start(): void {
    this.revokeAll();
    this.chunks = [];
    this.status = 'recording';
    this.generation += 1;
    this.emit();
  }

  /** Stash one emitted blob. Always appends (the final flush lands after end()). */
  push(seq: number, blob: Blob): void {
    if (this.chunks.some((c) => c.seq === seq)) return;
    this.chunks.push({ seq, blob });
    this.emit();
  }

  end(): void {
    if (this.status !== 'recording') return;
    this.status = 'ended';
    this.emit();
  }

  private sorted(): LocalChunk[] {
    return [...this.chunks].sort((a, b) => a.seq - b.seq);
  }

  /** Whole broadcast, in seq order, as one playable WebM. */
  full(): { url: string; seconds: number } | null {
    const sorted = this.sorted();
    if (sorted.length === 0) return null;
    if (!this.fullUrl) {
      this.fullUrl = URL.createObjectURL(
        new Blob(
          sorted.map((c) => c.blob),
          { type: 'video/webm' },
        ),
      );
    }
    return { url: this.fullUrl, seconds: (sorted[sorted.length - 1].seq + 1) * 2 };
  }
}

export const localRecording = new LocalRecordingStore();

/** Re-render token: subscribe, then read store fields during render. */
export function useLocalRecording(): number {
  return useSyncExternalStore(
    (cb) => localRecording.subscribe(cb),
    () => localRecording.version,
    () => 0,
  );
}
