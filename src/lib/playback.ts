/**
 * Post-show player teardown. After "The show has ended" the viewer must not
 * replay, seek, or reach buffered media: pause, detach the source, end the
 * MediaSource, revoke the blob URL, and close sockets. Each step is
 * best-effort so one failure cannot strand the rest. Real DOM objects
 * satisfy these minimal surfaces; tests pass stubs.
 */
export interface TeardownVideo {
  pause: () => void;
  removeAttribute: (name: string) => void;
  load?: () => void;
}

export interface TeardownMediaSource {
  readonly readyState: string;
  endOfStream?: () => void;
}

export interface TeardownSocket {
  close: () => void;
}

export interface PlaybackTargets {
  video: TeardownVideo;
  mediaSource: TeardownMediaSource | null;
  objectUrl: string | null;
  revokeObjectUrl: (url: string) => void;
  sockets: TeardownSocket[];
}

export function teardownPlayback(t: PlaybackTargets): void {
  const steps: Array<() => void> = [
    () => t.video.pause(),
    () => t.video.removeAttribute('src'),
    () => t.video.load?.(),
    () => {
      if (t.mediaSource && t.mediaSource.readyState === 'open') t.mediaSource.endOfStream?.();
    },
    () => {
      if (t.objectUrl) t.revokeObjectUrl(t.objectUrl);
    },
    ...t.sockets.map((s) => () => s.close()),
  ];
  for (const step of steps) {
    try {
      step();
    } catch {
      // best-effort: never let one failure strand the rest
    }
  }
}

/** One buffered time range [startS, endS]. */
export type BufferedRange = [number, number];

/**
 * Where a stalled playhead should jump, or null to leave it alone. Skips
 * forward over timeline gaps (a mid-show joiner buffers [0,2] + [10,12] and
 * would otherwise wait at 2s forever) and nudges a playhead that overran the
 * last buffered byte back into range. Call only when stalled: currentTime
 * unchanged while neither paused nor ended, or on the 'waiting' event.
 */
export function liveEdgeSeekMs(
  currentTimeS: number,
  ranges: BufferedRange[],
  toleranceS = 0.5,
): number | null {
  if (ranges.length === 0) return null;
  const ordered = [...ranges].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < ordered.length; i++) {
    const [start, end] = ordered[i];
    // Before this range: jump into it (covers gaps from mid-show joins).
    if (currentTimeS < start - toleranceS) return start + 0.05;
    if (currentTimeS <= end + toleranceS) {
      // Inside, or at/past the end while the next range waits: skip the gap.
      const next = ordered[i + 1];
      if (currentTimeS >= end - 0.02 && next && currentTimeS < next[0]) {
        return next[0] + 0.05;
      }
      return null;
    }
  }
  const last = ordered[ordered.length - 1];
  if (currentTimeS > last[1] + 1) return Math.max(last[0], last[1] - 0.2);
  return null;
}

/**
 * Old-buffer trim behind the playhead, or null when nothing is trimmable.
 * Without this a long show fills the SourceBuffer quota and appends start
 * throwing QuotaExceededError (a silent permanent stall).
 */
export function trimRangeMs(
  currentTimeS: number,
  ranges: BufferedRange[],
  keepBehindS = 45,
): BufferedRange | null {
  if (ranges.length === 0) return null;
  const start = Math.min(...ranges.map((r) => r[0]));
  const end = currentTimeS - keepBehindS;
  if (end - start < 5) return null;
  return [start, end];
}
