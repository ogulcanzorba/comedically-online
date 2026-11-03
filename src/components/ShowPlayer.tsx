'use client';

import { useEffect, useRef, useState } from 'react';
import type { Decision } from '@/moderation/types';
import { activeAt, pruneWindows, type DecisionWindow } from '@/lib/overlay-timing';
import { teardownPlayback } from '@/lib/playback';

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
  const [status, setStatus] = useState('Connecting… (stream runs ~12s behind live)');
  const [active, setActive] = useState<Decision[]>([]);
  const [sceneAt, setSceneAt] = useState(0);
  const [startingMs, setStartingMs] = useState<number | null>(null);
  const [hasEnded, setHasEnded] = useState(false);
  const [showEnded, setShowEnded] = useState(false);

  function formatScene(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video || typeof MediaSource === 'undefined') {
      setStatus('This browser cannot play the demo stream (needs MediaSource + WebM/VP8). Try Chrome.');
      return;
    }
    let ws: WebSocket | null = null;
    let mediaSource: MediaSource | null = null;
    let sourceBuffer: SourceBuffer | null = null;
    let cancelled = false;
    let pendingMeta: ChunkMeta | null = null;
    let streamEnded = false;
    let endSignalled = false;
    let raf = 0;
    const queue: QueuedChunk[] = [];

    function signalEnd(): void {
      if (endSignalled || !mediaSource || !sourceBuffer || sourceBuffer.updating) return;
      if (mediaSource.readyState !== 'open') return;
      endSignalled = true;
      try {
        mediaSource.endOfStream();
      } catch {
        // already ended or closing; status update below still applies
      }
      setStatus('The show has ended.');
      setHasEnded(true);
    }

    function pump(): void {
      if (!sourceBuffer || sourceBuffer.updating || !video) return;
      if (queue.length === 0) {
        // Drained everything the server sent; end only after its end-of-stream.
        if (streamEnded) signalEnd();
        return;
      }
      const next = queue.shift();
      if (!next) return;
      try {
        sourceBuffer.appendBuffer(next.bytes);
      } catch {
        queue.unshift(next);
        return;
      }
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
    mediaSource.addEventListener('sourceopen', () => {
      if (cancelled || !mediaSource) return;
      try {
        sourceBuffer = mediaSource.addSourceBuffer('video/webm; codecs="vp8,opus"');
      } catch {
        setStatus('This browser cannot play the demo stream (needs WebM/VP8). Try Chrome.');
        return;
      }
      sourceBuffer.addEventListener('updateend', pump);
      pump();
      void video.play().catch(() => {});
    });

    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?role=viewer`);
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === 'string') {
        try {
          const msg = JSON.parse(ev.data) as ChunkMeta & { type?: string; startsInMs?: number };
          if (msg.type === 'end') {
            streamEnded = true;
            pump();
            return;
          }
          if (msg.type === 'starting') {
            setStartingMs(typeof msg.startsInMs === 'number' ? Math.max(0, msg.startsInMs) : 0);
            setStatus('The comedian has started the show.');
            return;
          }
          pendingMeta = msg.type === 'chunk' ? msg : null;
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
      }
    };
    ws.onerror = () => setStatus('Connection lost. Is the comedian live?');
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
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
        {blurs.map((d, i) => (
          <div
            key={i}
            className="pointer-events-none absolute rounded-sm bg-black/40"
            style={{
              left: `${(d.box?.x ?? 0) * 100}%`,
              top: `${(d.box?.y ?? 0) * 100}%`,
              width: `${(d.box?.w ?? 0) * 100}%`,
              height: `${(d.box?.h ?? 0) * 100}%`,
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
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
