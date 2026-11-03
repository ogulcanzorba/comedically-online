'use client';

import { useEffect, useRef, useState } from 'react';
import type { Decision } from '@/moderation/types';
import { activeAt, pruneWindows, type DecisionWindow } from '@/lib/overlay-timing';
import { liveEdgeSeekMs, teardownPlayback, trimRangeMs, type BufferedRange } from '@/lib/playback';
import { blurPx } from '@/lib/blur';

interface ChunkMeta {
  seq: number;
  init: boolean;
  decisions: Decision[];
}

interface QueuedChunk {
  meta: ChunkMeta;
  bytes: ArrayBuffer;
}

/**
 * The live delayed player (Phase-1 watch logic, unchanged behavior).
 * Rendered by a show page once the show is live and the viewer holds a ticket.
 */
export function ShowPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const windowsRef = useRef<DecisionWindow[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const msRef = useRef<MediaSource | null>(null);
  const urlRef = useRef<string | null>(null);
  const tornDownRef = useRef(false);
  const resumeRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState('Connecting… (stream runs ~12s behind live)');
  const [active, setActive] = useState<Decision[]>([]);
  const [sceneAt, setSceneAt] = useState(0);
  const [startingMs, setStartingMs] = useState<number | null>(null);
  const [hasEnded, setHasEnded] = useState(false);
  const [showEnded, setShowEnded] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);

  function formatScene(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  useEffect(() => {
    const el = videoRef.current;
    if (!el || typeof MediaSource === 'undefined') {
      setStatus('This browser cannot play the demo stream (needs MediaSource + WebM/VP8). Try Chrome.');
      return;
    }
    const video: HTMLVideoElement = el;
    let ws: WebSocket | null = null;
    let mediaSource: MediaSource | null = null;
    let sourceBuffer: SourceBuffer | null = null;
    let cancelled = false;
    let pendingMeta: ChunkMeta | null = null;
    let streamEnded = false;
    let endSignalled = false;
    let raf = 0;
    let appendedChunks = 0;
    let lastStallCheckAt = 0;
    let lastStallTime = -1;
    const queue: QueuedChunk[] = [];

    function bufferedRanges(): BufferedRange[] {
      const out: BufferedRange[] = [];
      try {
        for (let i = 0; i < video.buffered.length; i++) {
          out.push([video.buffered.start(i), video.buffered.end(i)]);
        }
      } catch {
        // video detached mid-teardown
      }
      return out;
    }

    function fmtRanges(): string {
      return bufferedRanges()
        .map(([s, e]) => `${s.toFixed(1)}-${e.toFixed(1)}`)
        .join(',');
    }

    function signalEnd(): void {
      if (endSignalled || !mediaSource || !sourceBuffer || sourceBuffer.updating) return;
      if (mediaSource.readyState !== 'open') return;
      endSignalled = true;
      console.log(`[viewer] endOfStream (buffered ${fmtRanges()})`);
      try {
        mediaSource.endOfStream();
      } catch {
        // already ended or closing; status update below still applies
      }
      setStatus('The show has ended.');
      setHasEnded(true);
    }

    function tryPlay(reason: string): void {
      if (cancelled || tornDownRef.current || streamEnded) return;
      console.log(`[viewer] play attempt (${reason}) paused=${video.paused} t=${video.currentTime.toFixed(2)}`);
      void video
        .play()
        .then(() => {
          console.log(`[viewer] playing (t=${video.currentTime.toFixed(2)})`);
          setNeedsGesture(false);
        })
        .catch((e: unknown) => {
          console.warn('[viewer] play() rejected (autoplay gate):', e instanceof Error ? e.message : e);
          setNeedsGesture(true);
        });
    }

    /** Trim watched buffer so a long show cannot fill the append quota. */
    function maybeTrim(reason: string): void {
      if (!sourceBuffer || sourceBuffer.updating) return;
      const trim = trimRangeMs(video.currentTime, bufferedRanges());
      if (!trim) return;
      console.log(`[viewer] trim ${trim[0].toFixed(1)}-${trim[1].toFixed(1)} (${reason})`);
      try {
        sourceBuffer.remove(trim[0], trim[1]);
      } catch (e) {
        console.warn('[viewer] trim failed:', e instanceof Error ? e.message : e);
      }
    }

    function pump(): void {
      if (!sourceBuffer || sourceBuffer.updating || !video) return;
      if (queue.length === 0) {
        // Drained everything the server sent; end only after its end-of-stream.
        if (streamEnded) signalEnd();
        else maybeTrim('idle');
        return;
      }
      const next = queue.shift();
      if (!next) return;
      try {
        sourceBuffer.appendBuffer(next.bytes);
      } catch (e) {
        const name = e instanceof Error ? e.name : '';
        console.warn(
          `[viewer] append failed seq=${next.meta.seq} init=${next.meta.init} (${name}); queue=${queue.length}`,
        );
        queue.unshift(next);
        // Quota errors used to re-queue the same chunk forever (a silent
        // permanent stall): trim first, then retry on the next updateend.
        if (name === 'QuotaExceededError') maybeTrim('quota');
        return;
      }
      appendedChunks += 1;
      console.log(
        `[viewer] append seq=${next.meta.seq} init=${next.meta.init} bytes=${next.bytes.byteLength} ` +
          `decisions=${next.meta.decisions.length} buffered=${fmtRanges()} t=${video.currentTime.toFixed(2)}`,
      );
      if (appendedChunks === 1) tryPlay('first append');
      let t0 = video.currentTime;
      try {
        if (video.buffered.length > 0) t0 = video.buffered.end(video.buffered.length - 1);
      } catch {
        // fall back to currentTime
      }
      if (next.meta.decisions.length > 0) {
        windowsRef.current = pruneWindows(
          [...windowsRef.current, { t0, decisions: next.meta.decisions }],
          video.currentTime,
        );
      }
    }

    /** Stall watchdog: a playhead stuck across a gap jumps to live data. */
    function checkStall(): void {
      if (cancelled || tornDownRef.current || streamEnded) return;
      if (video.paused || video.ended || video.readyState < 2) {
        lastStallTime = video.currentTime;
        lastStallCheckAt = performance.now();
        return;
      }
      const now = performance.now();
      if (Math.abs(video.currentTime - lastStallTime) > 0.05) {
        lastStallTime = video.currentTime;
        lastStallCheckAt = now;
        return;
      }
      if (now - lastStallCheckAt < 1500) return;
      lastStallCheckAt = now;
      const target = liveEdgeSeekMs(video.currentTime, bufferedRanges());
      console.warn(
        `[viewer] stall t=${video.currentTime.toFixed(2)} buffered=${fmtRanges()} -> seek ${target === null ? 'none' : target.toFixed(2)}`,
      );
      if (target !== null) {
        try {
          video.currentTime = target;
        } catch (e) {
          console.warn('[viewer] gap seek failed:', e instanceof Error ? e.message : e);
        }
      }
    }

    function tick(): void {
      if (cancelled || !video) return;
      const now = activeAt(windowsRef.current, video.currentTime);
      video.muted = now.some((d) => d.action === 'bleep');
      setActive((prev) => {
        const same = prev.length === now.length && prev.every((d, i) => d === now[i]);
        return same ? prev : now;
      });
      if (now.length > 0) setSceneAt(video.currentTime);
      raf = requestAnimationFrame(tick);
    }

    mediaSource = new MediaSource();
    msRef.current = mediaSource;
    urlRef.current = URL.createObjectURL(mediaSource);
    video.src = urlRef.current;
    console.log('[viewer] player mounted');
    mediaSource.addEventListener('sourceopen', () => {
      if (cancelled || !mediaSource) return;
      console.log('[viewer] sourceopen');
      try {
        sourceBuffer = mediaSource.addSourceBuffer('video/webm; codecs="vp8,opus"');
      } catch (e) {
        console.error('[viewer] addSourceBuffer failed:', e instanceof Error ? e.message : e);
        setStatus('This browser cannot play the demo stream (needs WebM/VP8). Try Chrome.');
        return;
      }
      sourceBuffer.addEventListener('updateend', pump);
      sourceBuffer.addEventListener('error', () => {
        console.error('[viewer] sourcebuffer error event');
      });
      pump();
      tryPlay('sourceopen');
    });

    const onWaiting = (): void => {
      console.warn(
        `[viewer] waiting t=${video.currentTime.toFixed(2)} buffered=${fmtRanges()} queue=${queue.length}`,
      );
      const target = liveEdgeSeekMs(video.currentTime, bufferedRanges());
      if (target !== null && !video.paused) {
        console.warn(`[viewer] gap seek on waiting -> ${target.toFixed(2)}`);
        try {
          video.currentTime = target;
        } catch {
          // watchdog retries
        }
      }
    };
    const onPlaying = (): void => {
      console.log(`[viewer] playing event t=${video.currentTime.toFixed(2)}`);
      setNeedsGesture(false);
      setStartingMs((prev) => (prev !== null && prev > 0 ? 0 : prev));
    };
    const onPause = (): void => {
      if (!streamEnded && !tornDownRef.current) {
        console.warn(`[viewer] unexpected pause t=${video.currentTime.toFixed(2)}`);
        setNeedsGesture(true);
      }
    };
    const onVideoError = (): void => {
      const err = video.error;
      console.error(
        `[viewer] video error code=${err?.code ?? '?'} message=${err?.message ?? ''} t=${video.currentTime.toFixed(2)}`,
      );
    };
    const onVideoEnded = (): void => {
      console.log(`[viewer] video ended event t=${video.currentTime.toFixed(2)}`);
    };
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('stalled', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('pause', onPause);
    video.addEventListener('error', onVideoError);
    video.addEventListener('ended', onVideoEnded);
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        console.log(`[viewer] tab visible paused=${video.paused} t=${video.currentTime.toFixed(2)}`);
        if (!video.paused && !streamEnded) tryPlay('tab visible');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?role=viewer`);
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => console.log('[viewer] ws open');
    ws.onclose = (ev) => console.log(`[viewer] ws close code=${ev.code} reason=${ev.reason || '-'}`);
    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === 'string') {
        try {
          const msg = JSON.parse(ev.data) as ChunkMeta & { type?: string; startsInMs?: number };
          if (msg.type === 'end') {
            console.log('[viewer] end message; draining queue');
            streamEnded = true;
            pump();
            return;
          }
          if (msg.type === 'starting') {
            const ms = typeof msg.startsInMs === 'number' ? Math.max(0, msg.startsInMs) : 0;
            console.log(`[viewer] starting in ${ms}ms`);
            setStartingMs(ms);
            setStatus('The comedian has started the show.');
            return;
          }
          pendingMeta = msg.type === 'chunk' ? msg : null;
          if (pendingMeta) {
            console.log(
              `[viewer] chunk meta seq=${pendingMeta.seq} init=${pendingMeta.init} decisions=${pendingMeta.decisions.length}`,
            );
          }
        } catch {
          pendingMeta = null;
        }
        return;
      }
      if (pendingMeta) {
        queue.push({ meta: pendingMeta, bytes: ev.data as ArrayBuffer });
        pendingMeta = null;
        setStatus('Live (about 12s behind the stage)');
        pump();
      } else {
        console.warn('[viewer] binary without pending meta; dropped');
      }
    };
    ws.onerror = () => {
      console.error('[viewer] ws error');
      setStatus('Connection lost. Is the comedian live?');
    };
    raf = requestAnimationFrame(tick);
    const stallTimer = window.setInterval(checkStall, 500);
    resumeRef.current = () => tryPlay('tap');

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearInterval(stallTimer);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('stalled', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('error', onVideoError);
      video.removeEventListener('ended', onVideoEnded);
      document.removeEventListener('visibilitychange', onVisibility);
      ws?.close();
    };
  }, []);

  // Pre-show countdown ticker; lifts the waiting screen at zero.
  useEffect(() => {
    if (startingMs === null || startingMs <= 0) return;
    const timer = window.setInterval(() => {
      setStartingMs((prev) => (prev === null || prev <= 250 ? 0 : prev - 250));
    }, 250);
    return () => window.clearInterval(timer);
  }, [startingMs !== null && startingMs > 0]);

  // Countdown-lift marker (freeze diagnosis: chunks must follow shortly).
  useEffect(() => {
    if (startingMs === 0) console.log('[viewer] countdown lifted; waiting for first chunk');
  }, [startingMs === 0]);

  // Post-show teardown: once playback finishes, drop every handle on the
  // media (no replay, no seek-back into buffers) and close the socket.
  useEffect(() => {
    if (!hasEnded) return;
    const video = videoRef.current;
    if (!video) return;
    const teardown = (): void => {
      if (tornDownRef.current) return;
      tornDownRef.current = true;
      windowsRef.current = [];
      setActive([]);
      teardownPlayback({
        video,
        mediaSource: msRef.current,
        objectUrl: urlRef.current,
        revokeObjectUrl: (url) => URL.revokeObjectURL(url),
        sockets: wsRef.current ? [wsRef.current] : [],
      });
      setShowEnded(true);
    };
    if (video.ended) {
      teardown();
      return;
    }
    video.addEventListener('ended', teardown, { once: true });
    return () => video.removeEventListener('ended', teardown);
  }, [hasEnded]);

  const blurs = active.filter((d) => d.action === 'blur' && d.box);
  const bleeping = active.some((d) => d.action === 'bleep');
  const whys = [...new Set(active.map((d) => d.explanation ?? d.reason))].slice(0, 2);
  const resume = (): void => {
    console.log('[viewer] resume tapped');
    setNeedsGesture(false);
    resumeRef.current?.();
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Moderation active
        </span>
        {bleeping && (
          <span className="rounded-full bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-200">bleep</span>
        )}
      </div>
      <p className="mt-2 text-sm text-neutral-400">{status}</p>
      <div className="relative mt-4">
        <video ref={videoRef} playsInline disablePictureInPicture className="aspect-video w-full rounded-md bg-black" />
        {startingMs !== null && startingMs > 0 && !hasEnded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-md bg-black/85">
            <p className="text-lg font-semibold text-neutral-100">The comedian has started the show.</p>
            <p className="mt-2 text-5xl font-bold tabular-nums text-amber-300" aria-live="polite">
              {Math.ceil(startingMs / 1000)}
            </p>
            <p className="mt-2 text-sm text-neutral-400">The stream begins in a moment.</p>
          </div>
        )}
        {showEnded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-md bg-black/85">
            <p className="text-lg font-semibold text-neutral-100">The show has ended.</p>
            <p className="mt-2 text-sm text-neutral-400">Thanks for watching — this performance is no longer available.</p>
          </div>
        )}
        {needsGesture && !showEnded && (
          <button
            type="button"
            onClick={resume}
            className="absolute inset-x-0 bottom-3 mx-auto w-fit rounded-full bg-amber-400 px-5 py-2 text-sm font-bold text-neutral-950 shadow-lg hover:bg-amber-300"
          >
            Tap to watch live
          </button>
        )}
        {blurs.map((d, i) => (
          <div
            key={i}
            className="pointer-events-none absolute rounded-sm bg-black/60"
            style={{
              left: `${(d.box?.x ?? 0) * 100}%`,
              top: `${(d.box?.y ?? 0) * 100}%`,
              width: `${(d.box?.w ?? 0) * 100}%`,
              height: `${(d.box?.h ?? 0) * 100}%`,
              backdropFilter: `blur(${blurPx()}px)`,
              WebkitBackdropFilter: `blur(${blurPx()}px)`,
            }}
            title={d.label ?? 'blurred'}
          >
            {d.label && (
              <span className="absolute bottom-0.5 left-1 text-[10px] text-white/80">{d.label}</span>
            )}
          </div>
        ))}
      </div>
      {whys.length > 0 && (
        <p className="mt-2 rounded-md border border-neutral-800 bg-neutral-900/60 p-2 text-xs text-neutral-300" aria-live="polite">
          <span className="font-semibold">Why @{formatScene(sceneAt)}: </span>
          {whys.join(' · ')}
        </p>
      )}
      <p className="mt-2 text-xs text-neutral-500">
        The stream is never cut: problem words are muted in place and regions are blurred in place.
      </p>
    </div>
  );
}
