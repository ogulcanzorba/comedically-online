import { useSyncExternalStore } from 'react';

/**
 * Device-local broadcast recording. The studio stashes every 2s MediaRecorder
 * blob it sends; violation clips and the full download are byte-slices of
 * those blobs (init segment + clusters), assembled lazily as object URLs.
 * Everything stays in this tab's memory; nothing is uploaded anywhere.
 */

/** Chunks kept on each side of a flagged chunk: ±1 chunk ≈ ±2s ("about 3s"). */
const CLIP_RADIUS_CHUNKS = 1;

export interface LocalChunk {
  seq: number;
  blob: Blob;
}

export interface ClipRef {
  url: string;
  /** Clip span in scene seconds (2s per chunk). */
  startS: number;
  endS: number;
  centerSeq: number;
}

/** Pure: which stored seqs form the clip around centerSeq. Exported for tests. */
export function clipRange(centerSeq: number, seqs: number[]): number[] {
  const available = new Set(seqs);
  const out: number[] = [];
  for (let s = centerSeq - CLIP_RADIUS_CHUNKS; s <= centerSeq + CLIP_RADIUS_CHUNKS; s++) {
    if (s >= 0 && available.has(s)) out.push(s);
  }
  return out;
}

class LocalRecordingStore {
  private chunks: LocalChunk[] = [];
  private clipUrls = new Map<string, string>();
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
    for (const url of this.clipUrls.values()) URL.revokeObjectURL(url);
    this.clipUrls.clear();
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

  /**
   * Clip around a flagged chunk: the flagged 2s chunk ± one chunk, i.e.
   * ~2s before its start to ~2s after its end. Null until its first blob lands.
   * Server and studio seqs agree (the studio sends strictly in order), so the
   * moderation entry's seq indexes this store directly.
   */
  clipFor(centerSeq: number): ClipRef | null {
    const sorted = this.sorted();
    const range = clipRange(
      centerSeq,
      sorted.map((c) => c.seq),
    );
    if (range.length === 0) return null;
    const key = range.join(',');
    let url = this.clipUrls.get(key);
    if (!url) {
      const parts: Blob[] = [];
      for (const s of range) {
        const found = sorted.find((c) => c.seq === s);
        if (found) parts.push(found.blob);
      }
      if (parts.length === 0) return null;
      url = URL.createObjectURL(new Blob(parts, { type: 'video/webm' }));
      this.clipUrls.set(key, url);
    }
    return { url, startS: range[0] * 2, endS: range[range.length - 1] * 2 + 2, centerSeq };
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
