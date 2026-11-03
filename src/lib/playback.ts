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
