'use client';

import { useEffect, useRef, useState } from 'react';
import type { ModerationLogEntry } from '@/moderation/types';
import rulebookData from '@/moderation/rulebook.json';
import { localRecording } from '@/lib/local-recording';

const TITLES = new Map(
  (rulebookData.rules as Array<{ id: string; title: string }>).map((r) => [r.id, r.title]),
);

/** AudioWorklet processor: forwards mic samples to the main thread. */
const WORKLET_CODE = `
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const ch0 = inputs[0] && inputs[0][0];
    if (ch0) this.port.postMessage(ch0.slice(0));
    return true;
  }
}
registerProcessor('comedically-capture', Capture);
`;

/** Encode mono float samples as 16-bit PCM WAV. */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const writeAscii = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/** Linear resample to 16kHz mono (what Voice Transcribe wants). */
function resample16k(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === 16000) return input;
  const ratio = fromRate / 16000;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    out[i] = input[Math.floor(i * ratio)];
  }
  return out;
}

function formatElapsed(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatScene(seq: number): string {
  const s = seq * 2;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * In-place broadcast studio: camera/mic capture, relay publish, start/stop.
 * Lives on the pre-live page next to the moderation log. Violation toasts and
 * the timeline come from the relay's publisher log channel (near real time);
 * the log below shows the same moments as they air on the 12s delay.
 */
export function BroadcastStudio({ showId, accepted }: { showId: string; accepted: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(0);
  const liveSinceRef = useRef(0);
  const sendChainRef = useRef(Promise.resolve());
  const toastTimerRef = useRef<number | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  const audioRef = useRef<{ ctx: AudioContext; chunks: Float32Array[] } | null>(null);
  const finishTimerRef = useRef<number | null>(null);
  const [status, setStatus] = useState<'idle' | 'preview' | 'live' | 'finishing' | 'ended'>('idle');
  const [drainLeft, setDrainLeft] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [needsAcceptance, setNeedsAcceptance] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [violations, setViolations] = useState<ModerationLogEntry[]>([]);
  const [toast, setToast] = useState<ModerationLogEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function preview() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStatus('preview');
      } catch {
        if (!cancelled) setError('Camera/mic unavailable. Allow access to rehearse going live.');
      }
    }
    void preview();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      wsRef.current?.close();
      wsRef.current = null;
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
      if (frameTimerRef.current !== null) window.clearTimeout(frameTimerRef.current);
      if (finishTimerRef.current !== null) window.clearTimeout(finishTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (status !== 'live') return;
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - liveSinceRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [status]);

  /** Start parallel WAV capture for transcription. Failure is non-fatal (mock still works). */
  async function startAudioCapture(stream: MediaStream): Promise<void> {
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      await ctx.resume().catch(() => {});
      const url = URL.createObjectURL(new Blob([WORKLET_CODE], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'comedically-capture');
      const silent = ctx.createGain();
      silent.gain.value = 0;
      source.connect(node);
      node.connect(silent);
      silent.connect(ctx.destination);
      const capture = { ctx, chunks: [] as Float32Array[] };
      node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
        capture.chunks.push(ev.data);
      };
      audioRef.current = capture;
    } catch {
      audioRef.current = null;
    }
  }

  function stopAudioCapture(): void {
    if (audioRef.current) {
      void audioRef.current.ctx.close().catch(() => {});
      audioRef.current = null;
    }
  }

  /** Drain buffered mic audio as one 16kHz WAV for the current 2s window. */
  function drainWav(): ArrayBuffer | null {
    const capture = audioRef.current;
    if (!capture || capture.chunks.length === 0) return null;
    const total = capture.chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const c of capture.chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    capture.chunks = [];
    const mono16k = resample16k(merged, capture.ctx.sampleRate);
    // Keep the most recent 2s (32k samples); shorter clips are fine too.
    const windowed = mono16k.length > 32000 ? mono16k.slice(mono16k.length - 32000) : mono16k;
    return encodeWav(windowed, 16000);
  }

  /** Mid-chunk canvas grab (320px JPEG) so server ffmpeg stays out of the hot path. */
  function captureFrame(seq: number): void {
    frameTimerRef.current = null;
    const video = videoRef.current;
    const sock = wsRef.current;
    if (!video || !sock || sock.readyState !== WebSocket.OPEN) return;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;
    const width = 320;
    const height = Math.max(2, Math.round((video.videoHeight / video.videoWidth) * width));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(video, 0, 0, width, height);
    canvas.toBlob((blob) => {
      // Null blob: skip silently; the server falls back to ffmpeg extract.
      if (!blob) return;
      sendChainRef.current = sendChainRef.current
        .then(async () => {
          const s = wsRef.current;
          if (!s || s.readyState !== WebSocket.OPEN) return;
          s.send(JSON.stringify({ type: 'media', kind: 'jpg', seq }));
          s.send(await blob.arrayBuffer());
        })
        .catch((e: unknown) => {
          console.warn(`[studio] frame ${seq} send failed:`, e);
        });
    }, 'image/jpeg', 0.7);
  }

  function scheduleFrameCapture(seq: number): void {
    if (frameTimerRef.current !== null) window.clearTimeout(frameTimerRef.current);
    frameTimerRef.current = window.setTimeout(() => captureFrame(seq), 1000);
  }

  /** True finish: socket closed only after the server played out the drain. */
  function finishBroadcast(): void {
    if (finishTimerRef.current !== null) window.clearTimeout(finishTimerRef.current);
    finishTimerRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    stopAudioCapture();
    localRecording.end();
    setToast(null);
    setStatus('ended');
    document.getElementById('recap')?.scrollIntoView({ behavior: 'smooth' });
  }

  function handlePublisherMessage(ev: MessageEvent): void {
    if (typeof ev.data !== 'string') return;
    let msg: unknown;
    try {
      msg = JSON.parse(ev.data) as unknown;
    } catch {
      return;
    }
    const typed = msg as { type?: string; pending?: number };
    if (typed.type === 'drain' && typeof typed.pending === 'number') {
      setDrainLeft(typed.pending);
      return;
    }
    if (typed.type === 'ended') {
      finishBroadcast();
      return;
    }
    const entry = (msg as { type?: string; entry?: ModerationLogEntry }).entry;
    if ((msg as { type?: string }).type !== 'log' || !entry || typeof entry.seq !== 'number') return;
    if (entry.action !== 'bleep' && entry.action !== 'blur') return;
    setViolations((prev) => (prev.some((v) => v.seq === entry.seq) ? prev : [...prev, entry]));
    setToast(entry);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 8000);
  }

  async function goLive(): Promise<void> {
    const stream = streamRef.current;
    if (!stream || wsRef.current) return;
    setError('');
    setNeedsAcceptance(false);
    // Server-side gate: the go-live API refuses without a valid rulebook acceptance.
    try {
      const gate = await fetch('/api/studio/go-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showId }),
      });
      if (!gate.ok) {
        const data = (await gate.json().catch(() => ({}))) as { code?: string; error?: string };
        if (gate.status === 403 && data.code === 'rulebook-acceptance-required') {
          setNeedsAcceptance(true);
          return;
        }
        throw new Error(data.error ?? 'go-live refused');
      }
      const ws = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?role=publisher`,
      );
      wsRef.current = ws;
      ws.onmessage = handlePublisherMessage;
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('websocket'));
      });
      seqRef.current = 0;
      setViolations([]);
      setToast(null);
      localRecording.start();
      await startAudioCapture(stream);
      const mimeType =
        ['video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ??
        '';
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = rec;
      rec.ondataavailable = (ev: BlobEvent) => {
        if (ev.data.size === 0 || ws.readyState !== WebSocket.OPEN) return;
        const seq = seqRef.current;
        seqRef.current += 1;
        localRecording.push(seq, ev.data);
        // A boundary just passed: chunk seq+1 started, grab its middle frame.
        scheduleFrameCapture(seq + 1);
        // Serialized sends: chunk N+1 never overtakes chunk N, so server seqs
        // match studio seqs exactly (and the local recording stays aligned).
        sendChainRef.current = sendChainRef.current
          .then(async () => {
            const buf = await ev.data.arrayBuffer();
            const sock = wsRef.current;
            if (!sock || sock.readyState !== WebSocket.OPEN) return;
            sock.send(JSON.stringify({ type: 'media', kind: 'webm', seq }));
            sock.send(buf);
            const wav = drainWav();
            if (wav) {
              sock.send(JSON.stringify({ type: 'media', kind: 'wav', seq }));
              sock.send(wav);
            }
          })
          .catch((e: unknown) => {
            console.warn(`[studio] chunk ${seq} send failed:`, e);
          });
      };
      rec.start(2000);
      scheduleFrameCapture(0);
      liveSinceRef.current = Date.now();
      setElapsed(0);
      setStatus('live');
    } catch {
      wsRef.current = null;
      stopAudioCapture();
      setError('Could not reach the stream server. Is it running?');
    }
  }

  function endBroadcast(): void {
    recorderRef.current?.stop();
    recorderRef.current = null;
    if (frameTimerRef.current !== null) window.clearTimeout(frameTimerRef.current);
    frameTimerRef.current = null;
    // Keep the socket open: the server drains the delay buffer for viewers
    // (still watching behind us) and tells us when moderation is complete.
    const sock = wsRef.current;
    if (!sock || sock.readyState !== WebSocket.OPEN) {
      finishBroadcast();
      return;
    }
    try {
      sock.send(JSON.stringify({ type: 'end-broadcast' }));
    } catch {
      finishBroadcast();
      return;
    }
    setDrainLeft(null);
    setStatus('finishing');
    // Failsafe: a dead server must not hang the studio on this screen.
    if (finishTimerRef.current !== null) window.clearTimeout(finishTimerRef.current);
    finishTimerRef.current = window.setTimeout(() => finishBroadcast(), 30_000);
  }

  const full = status === 'ended' ? localRecording.full() : null;
  const span = Math.max(elapsed, ...violations.map((v) => v.seq * 2 + 2), 1);

  return (
    <div>
      <div className="flex items-center gap-3">
        {status === 'live' ? (
          <>
            <span className="rounded-full bg-red-500 px-3 py-1 text-xs font-bold text-white" aria-live="polite">
              ● LIVE
            </span>
            <span className="font-mono text-sm tabular-nums text-neutral-300" aria-label="Elapsed broadcast time">
              {formatElapsed(elapsed)}
            </span>
          </>
        ) : status === 'finishing' ? (
          <span
            className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-200"
            aria-live="polite"
          >
            Finishing moderation… {drainLeft === null ? '…' : `${drainLeft} chunks left`}
          </span>
        ) : status === 'ended' ? (
          <span className="rounded-full bg-neutral-800 px-3 py-1 text-xs text-neutral-400">
            broadcast ended — recap below
          </span>
        ) : (
          <span className="rounded-full bg-neutral-800 px-3 py-1 text-xs text-neutral-400">offline</span>
        )}
      </div>

      {error && <p className="mt-3 rounded-md bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
      {needsAcceptance && (
        <p className="mt-3 rounded-md border border-amber-200/40 bg-amber-100/10 p-3 text-sm text-amber-100">
          Accept the rulebook above before going live — scroll it, tick the box, then try again.
        </p>
      )}

      <div className="relative">
        <video
          ref={videoRef}
          muted
          playsInline
          className="mt-3 aspect-video w-full rounded-md bg-black"
          aria-label="Self-view camera preview"
        />
        {toast && (
          <div
            role="status"
            className="absolute left-3 top-6 max-w-[85%] rounded-md border border-amber-200/40 bg-neutral-950/90 p-3"
          >
            <p className="text-sm font-semibold text-amber-200">
              <span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-300" />
              {toast.ruleId ? (TITLES.get(toast.ruleId) ?? toast.ruleId) : 'Moderation'} ·{' '}
              {toast.action === 'bleep' ? 'word muted' : 'region blurred'}
            </p>
            <p className="mt-1 line-clamp-3 text-xs text-neutral-300" title={toast.reason}>
              {toast.reason}
            </p>
          </div>
        )}
      </div>

      {(status === 'live' || status === 'ended') && (
        <div className="mt-2" aria-label="Violation timeline">
          <div className="relative h-2 rounded bg-neutral-800" role="img" aria-label={`${violations.length} flagged moments`}>
            {violations.map((v) => (
              <span
                key={v.seq}
                title={`@${formatScene(v.seq)} ${v.action}: ${v.ruleId ? (TITLES.get(v.ruleId) ?? v.ruleId) : 'moderation'} — ${v.reason}`}
                className={`absolute top-0 h-2 w-2 -translate-x-1/2 rounded-full ${
                  v.action === 'bleep' ? 'bg-red-400' : 'bg-amber-300'
                }`}
                style={{ left: `${Math.min(100, ((v.seq * 2) / span) * 100)}%` }}
              />
            ))}
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            {violations.length === 0
              ? 'No violations — clean set so far.'
              : `${violations.length} flagged moment${violations.length === 1 ? '' : 's'} (recap below).`}
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {status === 'live' ? (
          <button
            onClick={endBroadcast}
            className="rounded-md bg-neutral-200 px-5 py-2 font-semibold text-neutral-950 hover:bg-white"
          >
            End broadcast
          </button>
        ) : status === 'finishing' ? null : (
          <button
            onClick={() => void goLive()}
            disabled={status !== 'preview' && status !== 'ended'}
            title={accepted ? undefined : 'Accept the rulebook above first'}
            className="rounded-md bg-red-500 px-5 py-2 font-semibold text-white hover:bg-red-400 disabled:opacity-40"
          >
            Go live now
          </button>
        )}
        {status === 'ended' && full && (
          <a
            href={full.url}
            download={`comedically-${showId}-full.webm`}
            className="rounded-md border border-neutral-600 px-4 py-2 text-sm hover:border-neutral-400"
          >
            Download full recording ({formatElapsed(full.seconds)})
          </a>
        )}
      </div>

      <p className="mt-4 text-sm text-neutral-500">
        Moderation follows the platform rulebook you accepted above — there is nothing to configure
        here. Recording stays on this device.
      </p>
    </div>
  );
}
