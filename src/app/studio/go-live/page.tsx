'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { ModerationLogEntry } from '@/moderation/types';

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

export default function StudioPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(0);
  const audioRef = useRef<{ ctx: AudioContext; chunks: Float32Array[] } | null>(null);
  const [status, setStatus] = useState<'idle' | 'preview' | 'live'>('idle');
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [log, setLog] = useState<ModerationLogEntry[]>([]);
  const [error, setError] = useState('');

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
    };
  }, []);

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
    try {
      const ws = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?role=publisher`,
      );
      wsRef.current = ws;
      ws.onmessage = (ev: MessageEvent) => {
        if (typeof ev.data !== 'string') return;
        try {
          const msg = JSON.parse(ev.data) as { type: string; entry?: ModerationLogEntry };
          if (msg.type === 'log' && msg.entry) {
            const entry = msg.entry;
            setLog((prev) => [entry, ...prev].slice(0, 50));
          }
        } catch {
          // ignore malformed frames
        }
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
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(JSON.stringify({ type: 'media', kind: 'webm', seq }));
          ws.send(buf);
          const wav = drainWav();
          if (wav) {
            ws.send(JSON.stringify({ type: 'media', kind: 'wav', seq }));
            ws.send(wav);
          }
        });
      };
      rec.start(2000);
      setStatus('live');
    } catch {
      wsRef.current = null;
      stopAudioCapture();
      setError('Could not reach the stream server. Is it running?');
    }
  }

  function stop(): void {
    recorderRef.current?.stop();
    recorderRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    stopAudioCapture();
    setStatus('preview');
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← Back
      </Link>
      <div className="mt-2 flex items-center gap-3">
        <h1 className="font-serif text-3xl">Studio</h1>
        {status === 'live' ? (
          <span className="rounded-full bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-300">
            ● LIVE
          </span>
        ) : (
          <span className="rounded-full bg-neutral-800 px-3 py-1 text-xs text-neutral-400">
            offline
          </span>
        )}
      </div>

      {error && <p className="mt-4 rounded-md bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section>
          <video ref={videoRef} muted playsInline className="aspect-video w-full rounded-md bg-black" />
          <div className="mt-3">
            {status === 'live' ? (
              <button
                onClick={stop}
                className="rounded-md bg-neutral-200 px-5 py-2 font-semibold text-neutral-950 hover:bg-white"
              >
                End stream
              </button>
            ) : (
              <button
                onClick={() => void goLive()}
                disabled={status !== 'preview'}
                className="rounded-md bg-red-500 px-5 py-2 font-semibold text-white hover:bg-red-400 disabled:opacity-40"
              >
                Go live
              </button>
            )}
          </div>
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-neutral-300">
              House rules for the moderator (plain language)
            </h2>
            <textarea
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              rows={4}
              className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-900 p-3 text-sm"
            />
            <button
              onClick={() => wsRef.current && sendRules(wsRef.current, rules)}
              className="mt-2 rounded-md border border-neutral-600 px-4 py-1.5 text-sm hover:border-neutral-400"
            >
              Update rules
            </button>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-neutral-300">Moderation log</h2>
          <ul className="mt-2 max-h-[32rem] space-y-2 overflow-y-auto rounded-md border border-neutral-800 bg-neutral-900/50 p-3 text-sm">
            {log.length === 0 && <li className="text-neutral-500">No decisions yet. Go live.</li>}
            {log.map((entry, i) => (
              <li key={`${entry.seq}-${i}`} className="border-b border-neutral-800 pb-2 last:border-0">
                <span className="font-mono text-xs text-neutral-500">#{entry.seq}</span>{' '}
                <span className="font-semibold text-amber-200">{entry.action}</span>
                <span className="text-neutral-400"> — {entry.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
