'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Decision } from '@/moderation/types';

interface ChunkMeta {
  seq: number;
  init: boolean;
  decisions: Decision[];
}

/** Day 1: delayed playback. Blur/bleep overlay lands on Day 3. */
export default function WatchPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState('Connecting… (stream runs ~10s behind live)');

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
    const queue: ArrayBuffer[] = [];

    function pump(): void {
      if (!sourceBuffer || sourceBuffer.updating || queue.length === 0) return;
      const next = queue.shift();
      if (!next) return;
      try {
        sourceBuffer.appendBuffer(next);
      } catch {
        queue.unshift(next);
      }
    }

    mediaSource = new MediaSource();
    video.src = URL.createObjectURL(mediaSource);
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
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === 'string') {
        try {
          pendingMeta = JSON.parse(ev.data) as ChunkMeta;
        } catch {
          pendingMeta = null;
        }
        return;
      }
      if (pendingMeta) {
        queue.push(ev.data as ArrayBuffer);
        pendingMeta = null;
        setStatus('Live (about 10s behind the stage)');
        pump();
      }
    };
    ws.onerror = () => setStatus('Connection lost. Is the comedian live?');

    return () => {
      cancelled = true;
      ws?.close();
    };
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← Back
      </Link>
      <div className="mt-2 flex items-center gap-3">
        <h1 className="font-serif text-3xl">Watch live</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Moderation active
        </span>
      </div>
      <p className="mt-2 text-sm text-neutral-400">{status}</p>
      {/* Blur/bleep overlay mounts here on Day 3. */}
      <video ref={videoRef} controls playsInline className="mt-4 aspect-video w-full rounded-md bg-black" />
    </main>
  );
}
