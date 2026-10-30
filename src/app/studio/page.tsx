'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { ModerationLogEntry } from '@/moderation/types';

const DEFAULT_RULES = `bleep my ex's name\nblur phone screens\nmy jokes about my own family are fine`;

export default function StudioPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
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
      const mimeType =
        ['video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ??
        '';
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = rec;
      rec.ondataavailable = (ev: BlobEvent) => {
        if (ev.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          void ev.data.arrayBuffer().then((buf) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(buf);
          });
        }
      };
      rec.start(2000);
      setStatus('live');
    } catch {
      wsRef.current = null;
      setError('Could not reach the stream server. Is it running?');
    }
  }

  function stop(): void {
    recorderRef.current?.stop();
    recorderRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
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
