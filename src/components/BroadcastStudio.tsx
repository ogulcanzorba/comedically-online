'use client';

import { useEffect, useRef, useState } from 'react';

const DEFAULT_RULES = `bleep my ex's name\nblur phone screens\nmy jokes about my own family are fine`;

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

/**
 * In-place broadcast studio: camera/mic capture, relay publish, start/stop.
 * Extracted from the old go-live page; the relay protocol is unchanged.
 * Lives on the pre-live page next to the delayed viewer view and live log.
 */
export function BroadcastStudio({ showId, accepted }: { showId: string; accepted: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(0);
  const liveSinceRef = useRef(0);
  const audioRef = useRef<{ ctx: AudioContext; chunks: Float32Array[] } | null>(null);
  const [status, setStatus] = useState<'idle' | 'preview' | 'live' | 'ended'>('idle');
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [error, setError] = useState('');
  const [needsAcceptance, setNeedsAcceptance] = useState(false);
  const [elapsed, setElapsed] = useState(0);

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
    };
  }, []);

  useEffect(() => {
    if (status !== 'live') return;
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - liveSinceRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [status]);

  function sendRules(ws: WebSocket, value: string): void {
    const lines = value
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'rules', rules: lines }));
    }
  }

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
      ws.onmessage = () => {
        // Publisher log entries arrive here; the page's live log panel renders them.
      };
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('websocket'));
      });
      sendRules(ws, rules);
      seqRef.current = 0;
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
        void ev.data.arrayBuffer().then((buf) => {
          const sock = wsRef.current;
          if (!sock || sock.readyState !== WebSocket.OPEN) return;
          sock.send(JSON.stringify({ type: 'media', kind: 'webm', seq }));
          sock.send(buf);
          const wav = drainWav();
          if (wav) {
            sock.send(JSON.stringify({ type: 'media', kind: 'wav', seq }));
            sock.send(wav);
          }
        });
      };
      rec.start(2000);
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
    wsRef.current?.close();
    wsRef.current = null;
    stopAudioCapture();
    setStatus('ended');
    document.getElementById('recap')?.scrollIntoView({ behavior: 'smooth' });
  }

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

      <video
        ref={videoRef}
        muted
        playsInline
        className="mt-3 aspect-video w-full rounded-md bg-black"
        aria-label="Self-view camera preview"
      />
      <div className="mt-3">
        {status === 'live' ? (
          <button
            onClick={endBroadcast}
            className="rounded-md bg-neutral-200 px-5 py-2 font-semibold text-neutral-950 hover:bg-white"
          >
            End broadcast
          </button>
        ) : (
          <button
            onClick={() => void goLive()}
            disabled={status !== 'preview' && status !== 'ended'}
            title={accepted ? undefined : 'Accept the rulebook above first'}
            className="rounded-md bg-red-500 px-5 py-2 font-semibold text-white hover:bg-red-400 disabled:opacity-40"
          >
            Go live now
          </button>
        )}
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-semibold text-neutral-300">
          House rules for the moderator (plain language)
        </h3>
        <textarea
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          rows={3}
          aria-label="House rules for the moderator"
          className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-900 p-3 text-sm"
        />
        <button
          onClick={() => wsRef.current && sendRules(wsRef.current, rules)}
          className="mt-2 rounded-md border border-neutral-600 px-4 py-1.5 text-sm hover:border-neutral-400"
        >
          Update rules
        </button>
      </div>
    </div>
  );
}
